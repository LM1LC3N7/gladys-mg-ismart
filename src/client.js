// -----------------------------------------------------------------------------
// The SAIC account: the sign-in (e-mail and SHA-1 of the password, as the
// app), the token kept until shortly before it expires, the event-id polling
// of the reads and commands, and the calls the integration makes. Ported from
// saic-ismart-client-ng 0.10.0 (MIT): api/base.py, api/vehicle,
// api/vehicle/locks, api/vehicle/climate, api/vehicle_charging.
//
// SAIC keeps ONE session per account: signing in here signs the MG app out
// (and the reverse). So a refused token signs in again at most once per 24 h;
// refused again within that window, the integration stops (session_taken)
// with spaced new tries, instead of fighting the app in a loop.
// -----------------------------------------------------------------------------

import { LOCK_ID, PATHS, RVC_PARAM, RVC_REQ, SAIC, TIMINGS } from './constants.js';
import { decryptResponse, encryptRequest, formEncode, sha1Hex, sha256Hex } from './crypto.js';
import { SaicError, httpRequest, parseRetryAfter } from './saic.js';

const FORM = 'application/x-www-form-urlencoded';
const JSON_TYPE = 'application/json';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Codes the reference never retries (api/base.py). */
const FINAL_CODES = new Set([2, 3, 7]);

/** An rvcParams entry: the id and its bytes in base64 (RvcParams of the reference). */
const param = (id, bytes) => ({ paramId: id, paramValue: Buffer.from(bytes).toString('base64') });
const END = param(RVC_PARAM.PARAMS_MAX, [0, 0, 0, 0]);

/** The body of a lock command (control_vehicle_locks). */
export function lockBody({ lock, lockId }) {
  if (lock) {
    return { rvcParams: null, rvcReqType: RVC_REQ.CLOSE_LOCKS };
  }
  return {
    rvcParams: [
      param(RVC_PARAM.UNK_4, [0]),
      param(RVC_PARAM.UNK_5, [0]),
      param(RVC_PARAM.UNK_6, [0]),
      param(RVC_PARAM.LOCK_ID, [lockId]),
      END,
    ],
    rvcReqType: RVC_REQ.OPEN_LOCKS,
  };
}

/** The body of a climate command (start_ac: fan 2, temperature index 8; stop_ac). */
export function climateBody({ start }) {
  if (!start) {
    // control_climate(fan_speed=0): ac_on False, temperature 8 not sent.
    return {
      rvcParams: [param(RVC_PARAM.FAN_SPEED, [0]), param(RVC_PARAM.AC_ON_OFF, [0]), END],
      rvcReqType: RVC_REQ.CLIMATE,
    };
  }
  return {
    rvcParams: [param(RVC_PARAM.FAN_SPEED, [2]), param(RVC_PARAM.TEMPERATURE, [8]), END],
    rvcReqType: RVC_REQ.CLIMATE,
  };
}

/** The body of a charging command (control_charging). */
export const chargingBody = ({ start }) => ({
  chrgCtrlReq: start ? 1 : 2,
  tboxEleccLckCtrlReq: 0,
  tboxV2XReq: 0,
});

export class SaicClient {
  constructor({
    transport = httpRequest,
    now = Date.now,
    timers = globalThis,
    onChange,
    base = SAIC.baseUri,
  } = {}) {
    this.transport = transport;
    this.now = now;
    this.timers = timers;
    /** Called after the session changed (persist it; never throws). */
    this.onChange = onChange;
    this.base = base;
    this.email = '';
    this.password = '';
    /** { token, expiresAt, issuedAt } | null */
    this.session = null;
    /**
     * The budget of the sign-ins after a refused token (SAIC keeps one
     * session per account): `at` the last automatic sign-in after a refusal
     * or a stop (one per 24 h), `refusedAt` the last refused token, `streak`
     * the session_taken stops in a row (reset after 24 h without a refusal).
     */
    this.taken = { at: 0, refusedAt: 0, streak: 0 };
    /** One sign-in at a time. */
    this.authenticating = undefined;
    /** Per-request timeout; undefined = the default (shorter for the test button). */
    this.timeout = undefined;
  }

  configure({ email, password, session = null, taken = null }) {
    this.email = email;
    this.password = password;
    this.session =
      session && typeof session.token === 'string' && session.token !== '' ? session : null;
    const number = (value) => (Number.isFinite(value) ? value : 0);
    this.taken = {
      at: number(taken?.at),
      refusedAt: number(taken?.refusedAt),
      streak: Number.isInteger(taken?.streak) ? taken.streak : 0,
    };
  }

  /** A sign-in about to be made for a stop's new try or the test button: it counts. */
  async countReconnect() {
    this.taken.at = this.now();
    await this.changed();
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  async changed() {
    try {
      await this.onChange?.();
    } catch {
      // Persisting is best effort: the session still works in memory.
    }
  }

  sleep(ms) {
    return new Promise((resolve) => this.timers.setTimeout(resolve, ms));
  }

  /** The timeout of a request that must be answered before `deadline` (if any). */
  timeoutFor(deadline) {
    const base = this.timeout ?? TIMINGS.requestTimeout;
    if (deadline === undefined) {
      return base;
    }
    const left = deadline - this.now();
    if (left < 500) {
      throw new SaicError('timeout', 'no time left to send the request', { notSent: true });
    }
    return Math.min(base, left);
  }

  /**
   * One request to the gateway, encoded as the app does. Resolves the raw
   * answer `{ status, headers, body }` (body decoded when it was encoded).
   */
  async send(method, path, { query, form, json, headers = {}, token = '', deadline } = {}) {
    const search = query ? `?${formEncode(query)}` : '';
    const signed = `/${path}${search}`;
    let body = '';
    let contentType;
    if (form) {
      body = formEncode(form);
      contentType = FORM;
    } else if (json) {
      body = JSON.stringify(json);
      contentType = JSON_TYPE;
    }
    const encoded = encryptRequest({
      path: signed,
      body,
      contentType,
      ts: String(this.now()),
      tenantId: SAIC.tenantId,
      region: SAIC.region,
      token,
    });
    const sent = encoded.body;
    const answer = await this.transport(`${this.base}${path}${search}`, {
      method,
      headers: {
        ...headers,
        ...encoded.headers,
        'User-Agent': SAIC.userAgent,
        'Content-Length': Buffer.byteLength(sent),
      },
      body: method === 'GET' && sent === '' ? undefined : sent,
      timeout: this.timeoutFor(deadline),
    });
    return answer;
  }

  /**
   * The JSON envelope of an answer, `{ code, json, eventId }`, or the error
   * it means (api/base.py __deserialize, before the code is judged).
   */
  envelope({ status, headers = {}, body }) {
    if (status === 429) {
      throw new SaicError('rate_limited', 'too many requests', {
        status,
        retryAfter: parseRetryAfter(headers['retry-after'], this.now()),
      });
    }
    if (status >= 500) {
      throw new SaicError('unavailable', 'the MG gateway is unavailable', { status });
    }
    const ok = status >= 200 && status < 300;
    let text = String(body ?? '');
    if (ok) {
      try {
        text = decryptResponse(text, headers);
      } catch {
        throw new SaicError('bad_response', 'an answer that does not decode', { status });
      }
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // Only an HTTP 401 means a refused token here: a 403 without the JSON
      // envelope comes from a WAF or a CDN, a passing error.
      if (status === 401) {
        throw new SaicError('logged_out', 'token refused', { status });
      }
      throw ok
        ? new SaicError('bad_response', 'an answer that is not JSON', { status })
        : new SaicError('http', 'request failed', { status });
    }
    if (!isObject(json)) {
      throw new SaicError('bad_response', 'an answer that is not an object', { status });
    }
    const code = Number.isInteger(json.code) ? json.code : -1;
    if (code === 401 || code === 403 || status === 401) {
      throw new SaicError('logged_out', 'token refused', { status, code });
    }
    if (status === 403) {
      throw new SaicError('http', 'request refused', { status });
    }
    const raw = headers['event-id'];
    const eventId = typeof raw === 'string' && /^[\w-]{1,64}$/.test(raw) ? raw : undefined;
    if (!ok && code === 0) {
      throw new SaicError('http', 'request failed', { status });
    }
    return { code, json, eventId, status };
  }

  // --- Sign-in ----------------------------------------------------------------

  /** One sign-in at a time: a second caller joins the running one. */
  login(options) {
    if (!this.authenticating) {
      this.authenticating = this.loginNow(options).finally(() => {
        this.authenticating = undefined;
      });
    }
    return this.authenticating;
  }

  /** AbstractSaicApi.login: e-mail, SHA-1 of the password, a simulator device id. */
  async loginNow({ deadline } = {}) {
    if (!this.hasCredentials) {
      throw new SaicError('no_credentials', 'no e-mail or password');
    }
    const email = this.email;
    const deviceId = `simulator${'*'.repeat(45)}${Math.floor(this.now() / 1000)}###${SAIC.appId}`;
    let result;
    try {
      const answer = await this.send('POST', PATHS.login, {
        form: {
          grant_type: 'password',
          username: email,
          password: sha1Hex(this.password),
          scope: 'all',
          deviceId,
          deviceType: '0',
          language: 'EN',
          loginType: '2',
        },
        headers: { Accept: 'application/json', Authorization: SAIC.basicAuth },
        deadline,
      });
      result = this.envelope(answer);
    } catch (err) {
      if (err.kind === 'logged_out') {
        throw new SaicError('refused', 'sign-in refused', { status: err.status, code: err.code });
      }
      throw err;
    }
    if (result.code !== 0) {
      throw new SaicError('refused', 'sign-in refused', {
        status: result.status,
        code: result.code,
      });
    }
    const data = result.json.data;
    const token = isObject(data) ? data.access_token : undefined;
    const seconds = isObject(data) ? Number(data.expires_in) : NaN;
    if (typeof token !== 'string' || token === '' || token.length > 8192) {
      throw new SaicError('bad_response', 'the sign-in sent no token');
    }
    if (this.email !== email) {
      throw new SaicError('network', 'the account changed during the sign-in');
    }
    const lifetime =
      Number.isFinite(seconds) && seconds > 60 ? seconds * 1000 : TIMINGS.tokenDefaultLifetime;
    this.session = { token, expiresAt: this.now() + lifetime, issuedAt: this.now() };
    await this.changed();
    return this.session;
  }

  /** Drops the token (refused by the gateway). */
  async logout() {
    if (this.session) {
      this.session = null;
      await this.changed();
    }
  }

  /**
   * A token valid for min(10 minutes, half its lifetime) more, else a new
   * sign-in (which signs the MG app out too, when it uses the same account).
   */
  async ensureToken(options) {
    if (this.authenticating) {
      await this.authenticating;
    }
    const s = this.session;
    if (s) {
      const lifetime = Number.isFinite(s.issuedAt) ? s.expiresAt - s.issuedAt : Infinity;
      const margin = Math.min(TIMINGS.tokenMargin, lifetime / 2);
      if (this.now() < s.expiresAt - margin) {
        return;
      }
    }
    await this.login(options);
  }

  /**
   * An authenticated call. A refused token signs in again once, unless it was
   * already refused within 24 h: then `session_taken` (the app holds the
   * session; signing in again would sign it out once more).
   */
  async authed(fn, options = {}) {
    await this.ensureToken(options);
    try {
      return await fn(this.session.token);
    } catch (err) {
      if (err.kind !== 'logged_out' || options.noRelogin) {
        throw err;
      }
      await this.logout();
      const now = this.now();
      const taken = this.taken;
      if (now - taken.refusedAt >= TIMINGS.takenWindow) {
        taken.streak = 0;
      }
      taken.refusedAt = now;
      if (now - taken.at < TIMINGS.takenWindow) {
        await this.changed();
        throw new SaicError('session_taken', 'the session is used by another sign-in', {
          status: err.status,
          code: err.code,
        });
      }
      taken.at = now;
      await this.changed();
    }
    await this.login(options);
    return fn(this.session.token);
  }

  // --- Calls ------------------------------------------------------------------

  /** A plain read (no event id): the `data` of the answer. */
  async read(path, options = {}) {
    return this.authed(async (token) => {
      const result = this.envelope(await this.send('GET', path, { ...options, token }));
      if (result.code !== 0) {
        throw new SaicError('api', 'the MG gateway refused the request', { code: result.code });
      }
      return result.json.data;
    }, options);
  }

  /**
   * A call answered through an event id (execute_api_call_with_event_id): sent
   * with `event-id: 0`, then again with the event id the gateway gives while
   * it waits for the car, every `delay`, for `budget` at most. Past it:
   * `no_answer`. `onAccepted`: called once the gateway took the request (its
   * first answer gave an event id or the data, without a refusal code): a
   * command may then have been executed, whatever comes next. `guard`:
   * checked right before the first request; false cancels it unsent.
   */
  async eventCall(
    method,
    path,
    { delay, budget = TIMINGS.eventBudget, onAccepted, guard, ...options } = {},
  ) {
    return this.authed(async (token) => {
      const start = this.now();
      let eventId = '0';
      if (guard && !guard()) {
        throw new SaicError('cancelled', 'cancelled before sending', { notSent: true });
      }
      for (;;) {
        const answer = await this.send(method, path, {
          ...options,
          token,
          headers: { 'event-id': eventId },
        });
        const result = this.envelope(answer);
        if (
          eventId === '0' &&
          !FINAL_CODES.has(result.code) &&
          (result.eventId || (result.code === 0 && 'data' in result.json))
        ) {
          onAccepted?.();
        }
        if (FINAL_CODES.has(result.code)) {
          throw new SaicError('api', 'the MG gateway refused the request', { code: result.code });
        }
        if (result.eventId && !('data' in result.json)) {
          eventId = result.eventId;
        } else if (result.code !== 0) {
          if (eventId === '0') {
            throw new SaicError('api', 'the MG gateway refused the request', {
              code: result.code,
            });
          }
        } else {
          return result.json.data;
        }
        if (this.now() - start + delay > budget) {
          throw new SaicError('no_answer', 'the car did not answer');
        }
        await this.sleep(delay);
      }
    }, options);
  }

  /** The vehicles of the account (does not wake the cars); null when malformed. */
  async vehicles(options) {
    const data = await this.read(PATHS.vehicles, options);
    return isObject(data) && Array.isArray(data.vinList) ? data.vinList : null;
  }

  /** The vehicle status (wakes the car): vehStatusReqType 2, as the reference. */
  async status(vin, options) {
    const data = await this.eventCall('GET', PATHS.status, {
      ...options,
      query: { vin: sha256Hex(vin), vehStatusReqType: '2' },
      delay: TIMINGS.eventDelayRead,
    });
    if (!isObject(data)) {
      throw new SaicError('bad_response', 'the MG gateway sent no vehicle status');
    }
    return data;
  }

  /** The charging data of the car (bms*, rvsChargeStatus). */
  async charging(vin, options) {
    const data = await this.eventCall('GET', PATHS.charging, {
      ...options,
      query: { vin: sha256Hex(vin) },
      delay: TIMINGS.eventDelayRead,
    });
    if (!isObject(data)) {
      throw new SaicError('bad_response', 'the MG gateway sent no charging data');
    }
    return data;
  }

  /**
   * A command: never sent again after a failure (only polled with its event
   * id, as the app does), never signed in again on a refused token (nothing
   * was executed: the command is refused).
   */
  command(vin, kind, options = {}) {
    const hashed = sha256Hex(vin);
    const call = (path, json) =>
      this.eventCall('POST', path, {
        ...options,
        noRelogin: true,
        json,
        // The charging control is polled every 3 s, the others every second.
        delay: path === PATHS.chargingControl ? TIMINGS.eventDelayRead : TIMINGS.eventDelayCommand,
      });
    switch (kind) {
      case 'lock':
        return call(PATHS.control, { ...lockBody({ lock: true }), vin: hashed });
      case 'unlock':
        return call(PATHS.control, {
          ...lockBody({ lock: false, lockId: LOCK_ID.DOORS }),
          vin: hashed,
        });
      case 'open-boot':
        return call(PATHS.control, {
          ...lockBody({ lock: false, lockId: LOCK_ID.TAILGATE }),
          vin: hashed,
        });
      case 'climate-start':
        return call(PATHS.control, { ...climateBody({ start: true }), vin: hashed });
      case 'climate-stop':
        return call(PATHS.control, { ...climateBody({ start: false }), vin: hashed });
      case 'charge-start':
        return call(PATHS.chargingControl, { ...chargingBody({ start: true }), vin: hashed });
      case 'charge-stop':
        return call(PATHS.chargingControl, { ...chargingBody({ start: false }), vin: hashed });
      default:
        throw new SaicError('api', 'unknown command');
    }
  }
}
