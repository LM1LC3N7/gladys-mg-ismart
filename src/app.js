// -----------------------------------------------------------------------------
// The integration: the MG iSMART account (e-mail and password), the vehicle
// list, one read per car and per interval (each read WAKES the car: 3 h by
// default, 30 min while it charges with power flowing (12 h at most), spaced
// twice as much each time it does not answer; clicks within a budget of 6
// per hour, 2 min apart), the Gladys devices and their states, the badges,
// the "Test the connection" button, and the device buttons (refresh, lock,
// unlock, boot, climate, charge), refused unless their option is on.
//
// Every SAIC call goes through one queue: the gateway keeps one session per
// account and is slow, so two calls never overlap. A button answers Gladys at
// once (its 5 s ack); the command then reads the car again, decides on that
// fresh state only, sends at most once, and writes its outcome in the "Last
// command" feature. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { SaicClient } from './client.js';
import { normalizeConfig } from './config.js';
import { BUTTONS, FEATURES, HOUR, LIMITS, MINUTE, TIMINGS } from './constants.js';
import { buildDevice, clock, parseFeatureId, statesOf, vehicleIds } from './devices.js';
import {
  ALREADY,
  COMMAND_NAMES,
  ERRORS,
  OPTION_NAMES,
  RESULTS,
  T,
  WHY,
  age,
  word,
} from './i18n.js';
import { readSnapshot, readVehicle } from './model.js';
import { StatePublisher } from './publisher.js';
import { SaicError, errorReason } from './saic.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors that stop the polling, with the spaced new tries of each. */
const STOPS = {
  refused: TIMINGS.refusedRetry,
  session_taken: TIMINGS.takenRetry,
};
/** Errors that hold every path (the whole cycle, the buttons, the commands). */
const HOLDS = new Set(['rate_limited', 'no_credentials', ...Object.keys(STOPS)]);
/** Errors of one car only: the others are still read. */
const CAR_ONLY = new Set(['no_answer', 'api', 'bad_response']);
/** Errors meaning the gateway did not answer usefully. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** Errors before the gateway took a command: it was not sent. */
const NOT_SENT = new Set([
  'rate_limited',
  'refused',
  'no_credentials',
  'session_taken',
  'cancelled',
]);
/** The status a command answer must carry to be "confirmed". */
const CONFIRMS = {
  [FEATURES.LOCK]: (s) => s.locked === 1,
  [FEATURES.UNLOCK]: (s) => s.locked === 0,
  [FEATURES.CLIMATE_START]: (s) => s.climate === 2,
  [FEATURES.CLIMATE_STOP]: (s) => s.climate === 0,
};

export class MgApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'mg-ismart' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new SaicClient({ transport, now, timers, onChange: () => this.persist() });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    /** id -> { vin, id, name, model, year, series } */
    this.vehicles = new Map();
    this.vehiclesAt = -Infinity;
    /** id -> the last snapshot (readSnapshot) */
    this.snapshots = new Map();
    /** id -> the last command result { en, fr } */
    this.results = new Map();
    /** ids with a command or a refresh waiting or running. */
    this.active = new Set();
    /** id -> the wake-ups asked by a click in the last hour (refresh, commands). */
    this.wakes = new Map();
    this.published = undefined;
    this.badges = new Map();
    this.timer = undefined;
    this.running = undefined;
    /** The SAIC queue: every call to the gateway runs one after the other. */
    this.queue = Promise.resolve();
    this.queued = 0;
    this.generation = 0;
    /** A stop after a refusal: { kind, retryAt, retries, code }, else undefined. */
    this.block = undefined;
    this.retrying = undefined;
    this.offline = false;
    this.pausedUntil = 0;
    /** 'rate' (a 429: every path waits) or 'backoff' (the gateway failed). */
    this.pauseKind = undefined;
    this.lastTestAt = -Infinity;
    this.started = false;
    this.lastStatus = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}, { clearBlock = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    const { email, password, account } = this.config;
    if (clearBlock) {
      this.memory.block = null;
      this.memory.session = null;
      this.memory.taken = null;
      await this.saveMemory();
    }
    // A 429 pause survives a restart and a change of account.
    const pause = this.memory.pause;
    if (pause && pause.until > Math.max(this.now(), this.pausedUntil)) {
      this.pausedUntil = pause.until;
      this.pauseKind = 'rate';
    }
    const session = this.memory.session?.account === account ? this.memory.session : null;
    const taken = this.memory.taken?.account === account ? this.memory.taken : null;
    this.client.configure({ email, password, session, taken });
    // A command that was running when the container stopped: say so, its
    // outcome is unknown.
    for (const id of Object.keys(this.memory.pending)) {
      this.results.set(id, RESULTS.interrupted);
    }
    if (Object.keys(this.memory.pending).length > 0) {
      this.memory.pending = {};
      await this.saveMemory();
    }
    const block = this.memory.block?.account === account ? this.memory.block : null;
    this.block = block
      ? { kind: block.kind, retryAt: block.retryAt, retries: block.retries, code: block.code }
      : undefined;
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    if (this.block) {
      // Stopped before the restart: the next try keeps its time.
      await this.setStatus(false, this.blockMessage());
      this.scheduleNext();
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Forgets the account and the failures: a new account, or a restart. A 429 pause stays. */
  reset() {
    this.vehicles = new Map();
    this.vehiclesAt = -Infinity;
    this.snapshots = new Map();
    this.published = undefined;
    this.badges = new Map();
    this.block = undefined;
    this.retrying = undefined;
    this.offline = false;
    if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The pauses, the stops and the session
   * stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges = new Map();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    for (const id of this.vehicles.keys()) {
      this.queueStates(id);
    }
    await this.flush();
    await this.publishBadges();
  }

  /** New credentials restart (and lift a stop); a new language or timezone renames. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.email !== previous.email || next.password !== previous.password) {
      return this.start(raw, { clearBlock: true });
    }
    this.config = next;
    if (next.language !== previous.language || next.timezone !== previous.timezone) {
      await this.publishDevices();
      for (const id of this.vehicles.keys()) {
        this.queueStates(id);
      }
      await this.flush();
    }
    if (next.intervalMinutes !== previous.intervalMinutes) {
      this.scheduleNext();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The token of the client and the time it was last refused, with their account. */
  async persist() {
    const { session, taken } = this.client;
    const account = this.config.account;
    this.memory.session = session ? { account, ...session } : null;
    this.memory.taken = { account, ...taken };
    await this.saveMemory();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** Runs `fn` after every SAIC call queued before it. */
  enqueue(fn) {
    this.queued += 1;
    const run = this.queue.then(fn).finally(() => {
      this.queued -= 1;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  // --- Polling ---------------------------------------------------------------

  get intervalMs() {
    return this.config.intervalMinutes * MINUTE;
  }

  /**
   * The next read of a car after a successful read. The short cadence only
   * while it charges with power flowing (charging, not unplugged, > 0 kW),
   * and for 12 h at most: then back to the normal interval.
   */
  readEntry(id, snapshot) {
    const now = this.now();
    const flowing =
      snapshot?.charging === true && snapshot.plugged !== false && snapshot.chargePower > 0;
    const since = flowing ? (this.memory.reads[id]?.chargingSince ?? now) : undefined;
    const short = flowing && now - since < TIMINGS.chargingMax;
    const wait = short ? Math.min(TIMINGS.chargingInterval, this.intervalMs) : this.intervalMs;
    return { next: now + wait, asleep: 0, ...(flowing ? { chargingSince: since } : {}) };
  }

  /** M1: the next read reserved in /data BEFORE a read wakes the car (a crash keeps it). */
  async reserve(id) {
    const entry = this.memory.reads[id] ?? { asleep: 0 };
    // asleep 0 while the read runs (a click then is not told "left asleep");
    // the returned entry keeps the count for asleepAfter.
    this.memory.reads[id] = { ...entry, asleep: 0, next: this.now() + this.intervalMs };
    await this.saveMemory();
    return entry;
  }

  /** After a car did not answer: twice the interval per silence in a row, 24 h at most. */
  async asleepAfter(id, entry, err) {
    const asleep = (entry.asleep ?? 0) + (err.kind === 'no_answer' ? 1 : 0);
    const wait =
      err.kind === 'no_answer'
        ? Math.min(TIMINGS.asleepMax, this.intervalMs * 2 ** (asleep - 1))
        : this.intervalMs;
    this.memory.reads[id] = { next: this.now() + wait, asleep };
    await this.saveMemory();
    return wait;
  }

  /** The next run: the stop's next try, the end of a pause, else the first car due. */
  scheduleNext() {
    this.clearTimer();
    if (!this.client.hasCredentials) {
      return;
    }
    const now = this.now();
    let at;
    if (this.block) {
      at = this.block.retryAt;
    } else if (now < this.pausedUntil) {
      at = this.pausedUntil;
    } else {
      at = this.vehiclesAt + TIMINGS.vehicleListInterval;
      for (const id of this.vehicles.keys()) {
        at = Math.min(at, this.memory.reads[id]?.next ?? now);
      }
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch(() => this.logger.error('MG iSMART refresh failed'));
        }
      },
      // Never sooner than 30 s: no path can loop on the gateway or the car.
      Math.max(30_000, at - now),
    );
  }

  /** One run at a time: a tick during a run joins it. */
  tick() {
    if (!this.running) {
      this.running = this.enqueue(() => this.run()).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  noteVehicles(list) {
    const vehicles = new Map();
    for (const info of list ?? []) {
      const vehicle = readVehicle(info);
      if (vehicle && !vehicles.has(vehicle.id) && vehicles.size < LIMITS.vehicles) {
        vehicles.set(vehicle.id, vehicle);
      }
    }
    if (vehicles.size === 0) {
      // An empty or malformed list: the cars known so far stay, and the list
      // is read again after the normal interval (not 24 h).
      this.logger.warn('MG iSMART: the vehicle list is empty or malformed; kept the last one');
      this.vehiclesAt = this.now() - TIMINGS.vehicleListInterval + this.intervalMs;
      return;
    }
    this.vehicles = vehicles;
    this.vehiclesAt = this.now();
  }

  async run() {
    const generation = this.generation;
    if (!this.client.hasCredentials) {
      return;
    }
    if (this.block && this.now() >= this.block.retryAt) {
      this.logger.info('MG iSMART: trying again after a stop');
      this.retrying = this.block;
      this.block = undefined;
    }
    if (this.block || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    try {
      // The list (it never wakes a car) is also how a stop is tried again and
      // how a missing token is renewed: nothing is called "connected" before
      // the gateway answered.
      if (
        this.retrying ||
        !this.client.session ||
        this.now() - this.vehiclesAt >= TIMINGS.vehicleListInterval
      ) {
        if (this.retrying?.kind === 'session_taken' && !this.client.session) {
          // The new try of a session_taken stop signs in: it uses the
          // budget of one sign-in per 24 h.
          await this.client.countReconnect();
        }
        this.noteVehicles(await this.client.vehicles());
        if (generation !== this.generation) {
          return;
        }
      }
      await this.succeeded();
      await this.publishDevices();
      for (const vehicle of this.vehicles.values()) {
        const next = this.memory.reads[vehicle.id]?.next ?? 0;
        if (this.now() >= next && !this.active.has(vehicle.id)) {
          await this.readCar(vehicle);
          if (generation !== this.generation) {
            return;
          }
        }
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * Reads one car (status, then charging data: its failure never hides the
   * status). An error of this car only spaces its next read; any other error
   * is thrown (the cycle stops). Either way the car is never read again
   * sooner than the interval.
   */
  async readCar(vehicle) {
    const entry = await this.reserve(vehicle.id);
    let status;
    try {
      status = await this.client.status(vehicle.vin);
    } catch (err) {
      const wait = await this.asleepAfter(vehicle.id, entry, err);
      if (!CAR_ONLY.has(err.kind)) {
        throw err;
      }
      this.logger.warn(
        `MG iSMART: ${vehicle.name} not read (${errorReason(err)}); next read in ${Math.round(wait / MINUTE)} min`,
      );
      return { error: err };
    }
    let charging;
    let held;
    try {
      charging = await this.client.charging(vehicle.vin);
    } catch (err) {
      // A hold (429, a stop) still keeps the status just read; it is thrown after.
      if (HOLDS.has(err.kind)) {
        held = err;
      }
      this.logger.info(
        `MG iSMART: charging data of ${vehicle.name} not read (${errorReason(err)})`,
      );
    }
    const snapshot = readSnapshot({ status, charging }, this.now());
    this.memory.reads[vehicle.id] = this.readEntry(vehicle.id, snapshot);
    await this.saveMemory();
    this.apply(vehicle.id, snapshot);
    if (held) {
      throw held;
    }
    return { snapshot };
  }

  async succeeded() {
    this.offline = false;
    this.retrying = undefined;
    if (this.pauseKind === 'backoff') {
      this.pauseKind = undefined;
    }
    if (this.memory.block) {
      this.memory.block = null;
      await this.saveMemory();
    }
    await this.setStatus(
      true,
      this.vehicles.size === 0 ? T.noVehicle : T.connected(this.vehicles.size),
    );
  }

  blockMessage() {
    const wait = age(Math.max(0, this.block.retryAt - this.now()));
    return this.block.kind === 'refused'
      ? T.refused(this.block.code === undefined ? 'HTTP' : `code ${this.block.code}`, wait)
      : T.sessionTaken(wait);
  }

  async failed(err) {
    const reason = errorReason(err);
    const schedule = STOPS[err.kind];
    if (schedule) {
      // Never signed in again in a loop: one new try after 6 h, then every 24 h.
      // session_taken counts its stops in a row in /data (reset only after
      // 24 h without a refused token), and its new try never comes sooner
      // than 24 h after the last automatic sign-in: one per 24 h.
      const taken = err.kind === 'session_taken';
      const retries = taken ? this.client.taken.streak : (this.retrying?.retries ?? 0);
      const wait = schedule[Math.min(retries, schedule.length - 1)];
      const retryAt = taken
        ? Math.max(this.now() + wait, this.client.taken.at + TIMINGS.takenWindow)
        : this.now() + wait;
      if (taken) {
        this.client.taken.streak = retries + 1;
        await this.persist();
      }
      this.block = {
        kind: err.kind,
        retryAt,
        retries: retries + 1,
        code: Number.isInteger(err.code) ? err.code : undefined,
      };
      this.retrying = undefined;
      this.memory.block = { account: this.config.account, ...this.block };
      await this.saveMemory();
      this.logger.warn(
        `MG iSMART stopped: ${reason}; one new try in ${Math.round((retryAt - this.now()) / MINUTE)} min`,
      );
      await this.setStatus(false, this.blockMessage());
      return;
    }
    if (err.kind === 'no_credentials') {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    let wait;
    let message;
    if (err.kind === 'rate_limited') {
      wait = Math.min(
        TIMINGS.rateLimitMax,
        Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
      );
      this.pauseKind = 'rate';
      message = T.rateLimited(age(wait));
    } else {
      // Never read again sooner than the interval.
      wait = this.intervalMs;
      if (this.pauseKind !== 'rate') {
        this.pauseKind = 'backoff';
      }
      this.offline = OFFLINE.has(err.kind) || this.offline;
      message = T.unreachable(reason, age(wait));
    }
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    if (this.pauseKind === 'rate') {
      this.memory.pause = { kind: 'rate', until: this.pausedUntil };
      await this.saveMemory();
    }
    await this.setStatus(err.kind === 'rate_limited' && this.vehicles.size > 0, message);
    this.logger.warn(`MG iSMART: ${reason}; next try in ${Math.round(wait / MINUTE)} min`);
  }

  apply(id, snapshot) {
    this.snapshots.set(id, snapshot);
    this.queueStates(id);
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices() {
    if (this.vehicles.size === 0) {
      return;
    }
    const devices = [...this.vehicles.values()].map((v) =>
      buildDevice(this.gladys, v, this.config),
    );
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(id, created = this.createdFeatures()) {
    const states = [];
    const snapshot = this.snapshots.get(id);
    if (snapshot) {
      states.push(...statesOf(snapshot, this.config));
    }
    const result = this.results.get(id);
    if (result) {
      states.push({ role: FEATURES.COMMAND_STATUS, text: word(result, this.config.language) });
    }
    this.pushStates(id, states, created);
  }

  /** `[{ role, state | text }]` of one car -> the publisher (created features only). */
  pushStates(id, states, created = this.createdFeatures()) {
    const ids = vehicleIds(this.gladys, id);
    for (const { role, ...value } of states) {
      const externalId = ids.feature(role);
      if (created.has(externalId)) {
        this.publisher.push(externalId, value);
      }
    }
  }

  async publishBadges() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    for (const id of this.vehicles.keys()) {
      const externalId = vehicleIds(this.gladys, id).device;
      if (!created.has(externalId)) {
        continue;
      }
      const transport =
        this.block || this.offline ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
      if (this.badges.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.badges.set(entry.external_id, entry.transport);
      }
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badges = new Map();
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    for (const id of this.vehicles.keys()) {
      this.queueStates(id, created);
    }
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badges = new Map();
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the cars of the last list (no request). */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button --------------------------------------------------

  pauseMessage() {
    const left = this.pausedUntil - this.now();
    return left > 0 && this.pauseKind === 'rate' ? T.rateLimited(age(left)) : undefined;
  }

  /** Signs in if needed and reads the vehicle list: never wakes a car. */
  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last
        ? { en: `${T.test.cooldown.en} ${last.en}`, fr: `${T.test.cooldown.fr} ${last.fr}` }
        : T.test.cooldown;
    }
    if (this.queued > 0) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // One try per click: the button is how a stopped account is tried again.
    if (this.block) {
      this.retrying = this.block;
      this.block = undefined;
    }
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    const generation = this.generation;
    await this.enqueue(async () => {
      this.client.timeout = TIMINGS.quickTimeout;
      try {
        if (!this.client.session) {
          // The sign-in of the test counts in the budget of one per 24 h.
          await this.client.countReconnect();
        }
        this.noteVehicles(
          await this.client.vehicles({ deadline: this.now() + TIMINGS.quickBudget }),
        );
        await this.succeeded();
        await this.publishDevices();
      } catch (err) {
        if (generation === this.generation) {
          await this.failed(err);
        }
      } finally {
        this.client.timeout = undefined;
      }
    });
    await this.publishBadges();
    if (generation === this.generation) {
      this.scheduleNext();
    }
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected || this.vehicles.size === 0) {
      return message ?? T.noCredentials;
    }
    return T.test.summary([...this.vehicles.values()].map((v) => v.name));
  }

  // --- Buttons ---------------------------------------------------------------

  error(text) {
    return new Error(word(text, this.config.language));
  }

  /** Writes the outcome of a command in the "Last command" feature. */
  async result(id, text) {
    this.results.set(id, text);
    this.queueStates(id);
    await this.flush();
  }

  time(ms = this.now()) {
    return clock(ms, this.config.timezone);
  }

  /**
   * The wake-up budget of a car for clicks (refresh, and the read before each
   * command): 2 minutes apart, 6 per hour; none while a silent car is left
   * asleep. The error text, else undefined.
   */
  wakeRefusal(id) {
    const now = this.now();
    const entry = this.memory.reads[id];
    if (entry?.asleep > 0 && now < entry.next) {
      return ERRORS.asleep(this.time(entry.next));
    }
    const wakes = (this.wakes.get(id) ?? []).filter((t) => now - t < HOUR);
    this.wakes.set(id, wakes);
    const last = wakes.at(-1);
    if (last !== undefined && now - last < TIMINGS.manualGap) {
      return ERRORS.tooSoon(age(last + TIMINGS.manualGap - now));
    }
    if (wakes.length >= TIMINGS.manualPerHour) {
      return ERRORS.tooMany(age(wakes[0] + HOUR - now));
    }
    return undefined;
  }

  /**
   * A button of a car. Checked now (role, value, option, connection, one at a
   * time, wake-up budget), answered at once; the work runs in the SAIC queue
   * (see command()).
   */
  async setValue(device, feature, value) {
    const parsed = parseFeatureId(feature?.external_id);
    if (!parsed || !(parsed.role in BUTTONS)) {
      throw this.error(ERRORS.readOnly);
    }
    const vehicle = this.vehicles.get(parsed.id);
    if (
      !vehicle ||
      vehicleIds(this.gladys, vehicle.id).feature(parsed.role) !== feature.external_id
    ) {
      throw this.error(ERRORS.unknownVehicle);
    }
    // Only a press: null, '', 0, true or 'on' never pass.
    if (value !== 1 && value !== '1') {
      throw this.error(ERRORS.invalidValue);
    }
    const option = BUTTONS[parsed.role];
    if (option && !this.config[option]) {
      throw this.error(ERRORS.disabled(OPTION_NAMES[option]));
    }
    if (!this.client.hasCredentials || this.block) {
      throw this.error(ERRORS.notConnected);
    }
    const paused = this.pauseMessage();
    if (paused) {
      throw this.error(paused);
    }
    if (this.active.has(vehicle.id)) {
      throw this.error(ERRORS.stillRunning);
    }
    // Every press reads the car, so every press wakes it up.
    const refusal = this.wakeRefusal(vehicle.id);
    if (refusal) {
      throw this.error(refusal);
    }
    this.wakes.get(vehicle.id).push(this.now());
    this.active.add(vehicle.id);
    const name = COMMAND_NAMES[parsed.role];
    this.logger.info(`MG iSMART: ${name.en} asked for ${vehicle.name}`);
    if (parsed.role !== FEATURES.REFRESH) {
      this.memory.pending[vehicle.id] = parsed.role;
      await this.saveMemory();
      // Never makes the ack wait for Gladys: the flush runs on its own.
      this.results.set(vehicle.id, RESULTS.reading(name));
      this.queueStates(vehicle.id);
      this.flush();
    }
    const generation = this.generation;
    this.background = this.enqueue(() => this.command(vehicle, parsed.role, generation))
      .catch(() => this.logger.error('MG iSMART command failed'))
      .finally(() => {
        this.active.delete(vehicle.id);
      });
  }

  /** A command error that holds every path (429, a stop) is applied like a polling one. */
  async hold(err) {
    if (HOLDS.has(err.kind)) {
      await this.failed(err);
      await this.publishBadges();
      this.scheduleNext();
    }
  }

  /**
   * What a command must do on the state just read: { send } | { already } |
   * { why }. A missing value refuses. The climate counts as on only for
   * remoteClimateStatus 2, as off only for 0 (fan only or defrost: sent).
   */
  plan(role, s) {
    const decide = (known, already) =>
      !known ? { why: WHY.unknownState } : already ? { already: true } : { send: true };
    switch (role) {
      case FEATURES.LOCK:
        return decide(s.locked !== undefined, s.locked === 1);
      case FEATURES.UNLOCK:
        return decide(s.locked !== undefined, s.locked === 0);
      case FEATURES.OPEN_BOOT:
        return decide(s.boot !== undefined, s.boot === 1);
      case FEATURES.CLIMATE_START:
        return decide(s.climate !== undefined, s.climate === 2);
      case FEATURES.CLIMATE_STOP:
        return decide(s.climate !== undefined, s.climate === 0);
      case FEATURES.CHARGE_START:
        if (s.charging === undefined || s.plugged === undefined) {
          return { why: WHY.unknownState };
        }
        if (s.charging) {
          return { already: true };
        }
        return s.plugged ? { send: true } : { why: WHY.notPlugged };
      case FEATURES.CHARGE_STOP:
        return decide(s.charging !== undefined, s.charging === false);
      default:
        return { why: WHY.unknownState };
    }
  }

  async command(vehicle, role, generation) {
    try {
      await this.commandNow(vehicle, role, generation);
    } finally {
      if (this.memory.pending[vehicle.id]) {
        delete this.memory.pending[vehicle.id];
        await this.saveMemory();
      }
    }
  }

  async commandNow(vehicle, role, generation) {
    const name = COMMAND_NAMES[role];
    const id = vehicle.id;
    const option = BUTTONS[role];
    const stale = () =>
      generation !== this.generation ||
      Boolean(this.block) ||
      (this.now() < this.pausedUntil && this.pauseKind === 'rate');
    const notSent = async (why) => {
      await this.saveMemory();
      await this.result(id, RESULTS.notSent(name, why, this.time()));
    };
    if (stale()) {
      await notSent(WHY.notConnected);
      return;
    }
    if (role === FEATURES.REFRESH) {
      try {
        const { error } = await this.readCar(vehicle);
        await this.result(
          id,
          error
            ? RESULTS.refreshFailed(errorReason(error), this.time())
            : RESULTS.refreshed(this.time()),
        );
      } catch (err) {
        await this.hold(err);
        await this.result(id, RESULTS.refreshFailed(errorReason(err), this.time()));
      }
      await this.flush();
      this.scheduleNext();
      return;
    }
    // A fresh read: the command decides on it only, never on what is in memory.
    const entry = await this.reserve(id);
    let current;
    try {
      const status = await this.client.status(vehicle.vin);
      const charging =
        role === FEATURES.CHARGE_START || role === FEATURES.CHARGE_STOP
          ? await this.client.charging(vehicle.vin)
          : undefined;
      current = readSnapshot({ status, charging }, this.now());
      if (!current.hasStatus) {
        throw new SaicError('bad_response', 'the vehicle status is empty');
      }
    } catch (err) {
      // A silent car is left asleep (the same spacing as the polling).
      await this.asleepAfter(id, entry, err);
      await this.hold(err);
      await notSent(WHY.readFailed(errorReason(err)));
      this.scheduleNext();
      return;
    }
    this.apply(id, current);
    this.memory.reads[id] = this.readEntry(id, current);
    if (option && !this.config[option]) {
      await notSent(WHY.disabled);
      return;
    }
    if (stale()) {
      await notSent(WHY.notConnected);
      return;
    }
    // A state the car reported long ago is no state to act on.
    if (current.statusTime !== undefined && this.now() - current.statusTime > TIMINGS.staleState) {
      await notSent(WHY.stale(this.time(current.statusTime)));
      return;
    }
    let plan = this.plan(role, current);
    if (plan.already && current.statusTime === undefined) {
      // "Already done" is never concluded on an undated state: the command
      // (idempotent) is sent instead.
      plan = { send: true };
    }
    if (!plan.send) {
      await notSent(plan.why ?? ALREADY[role]);
      return;
    }
    this.logger.info(`MG iSMART: sending ${name.en} to ${vehicle.name}`);
    let accepted = false;
    try {
      const data = await this.client.command(vehicle.vin, role, {
        onAccepted: () => {
          accepted = true;
        },
        // Checked again right before the first request leaves.
        guard: () => !stale() && (!option || Boolean(this.config[option])),
      });
      const { text, after } = this.outcome(role, name, data);
      await this.result(id, text);
      if (after) {
        // The status after the command: its lock, doors and climate are shown
        // at once, after the result (the snapshot kept stays the last full read).
        this.pushStates(id, statesOf(after, this.config));
      }
    } catch (err) {
      await this.hold(err);
      const reason = errorReason(err);
      this.logger.warn(`MG iSMART: ${name.en} for ${vehicle.name} failed: ${reason}`);
      if (accepted) {
        // Taken by the gateway: it may have been executed, whatever came next.
        await this.result(id, RESULTS.unconfirmed(name, reason, this.time()));
      } else if (err.kind === 'cancelled') {
        await notSent(WHY.disabled);
      } else if (err.kind === 'api' || err.kind === 'logged_out') {
        await this.result(id, RESULTS.refusedByMg(name, reason, this.time()));
      } else if (err.notSent || NOT_SENT.has(err.kind)) {
        await notSent({ en: reason, fr: reason });
      } else {
        await this.result(id, RESULTS.unconfirmed(name, reason, this.time()));
      }
    }
    // One read of the car shortly after, to show the effect.
    this.memory.reads[id] = { next: this.now() + TIMINGS.refreshAfterCommand, asleep: 0 };
    await this.saveMemory();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * The outcome of an answered command: a failure the car reported
   * (`failureType` non-zero), else "confirmed" only when the status it sends
   * back matches (lock, unlock, climate), else "state not confirmed".
   */
  outcome(role, name, data) {
    const time = this.time();
    const after = data?.basicVehicleStatus ? readSnapshot({ status: data }, this.now()) : undefined;
    if (Number.isInteger(data?.failureType) && data.failureType !== 0) {
      return { text: RESULTS.carFailure(name, data.failureType, time), after };
    }
    const check = CONFIRMS[role];
    if (!check || (after && check(after))) {
      return { text: RESULTS.done(name, time), after };
    }
    return { text: RESULTS.notConfirmed(name, time), after };
  }
}
