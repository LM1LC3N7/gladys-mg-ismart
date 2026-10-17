// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake SAIC gateway behind the transport. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MgApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { sha1Hex, sha256Hex } from '../src/crypto.js';
import { registerHandlers } from '../src/handlers.js';
import { readVehicle } from '../src/model.js';
import {
  EMAIL,
  HOUR,
  MINUTE,
  NOW,
  PASSWORD,
  VIN,
  VIN2,
  chargingData,
  vehicleInfo,
  vehicleStatus,
} from './fixtures/saic.js';
import { fakeSaic, memoryStore, settle } from './helpers/fakeSaic.js';

const CONFIG = { email: EMAIL, password: PASSWORD };
const ID = readVehicle(vehicleInfo()).id;
const DEVICE = `ext:test-integration:vehicle:${ID}`;
const feature = (role) => `${DEVICE}:${role}`;

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  { config = CONFIG, store = memoryStore(), server, now = NOW, create = true, logs = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  const saic = server ?? fakeSaic();
  const gladys = createFakeGladys({ config });
  const app = new MgApp({
    gladys,
    logger: recorder(logs),
    transport: saic.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  const advance = async (ms, step = 1_000) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  const connecting = gladys.connect();
  await settle();
  await advance(40_000);
  await connecting;
  t.after(() => app.stop());
  if (create && gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
  }
  return { gladys, app, server: saic, store, advance, logs };
}

const last = (gladys, role) => gladys.fake.lastState(feature(role));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const deviceOf = (gladys) => gladys.fake.discoveredDevices[0];
const featureOf = (gladys, role) =>
  deviceOf(gladys).features.find((f) => f.external_id === feature(role));
const press = (gladys, role, value = 1) =>
  gladys.fake.setValue(deviceOf(gladys), featureOf(gladys, role), value);

function assertNoLeak(logs, server, store) {
  const text = logs.join('\n');
  for (const secret of [
    PASSWORD,
    sha1Hex(PASSWORD),
    VIN,
    sha256Hex(VIN),
    EMAIL,
    ...server.secrets,
  ]) {
    assert.ok(!text.includes(secret), 'a secret or a VIN reached the logs');
  }
  assert.ok(!/45\.48|9\.16/.test(text), 'the position reached the logs');
  const saved = JSON.stringify(store.data ?? {});
  for (const secret of [PASSWORD, sha1Hex(PASSWORD), VIN, EMAIL]) {
    assert.ok(!saved.includes(secret), 'a secret or the VIN reached /data');
  }
  assert.ok(!/45\.48|9\.16/.test(saved), 'the position reached /data');
}

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { email: EMAIL } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /compte secondaire/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /e-mail and the password/);
  assert.equal(server.requests.length, 0);
});

test('sign-in, list, one status and one charging read; device, states, badge; nothing leaks', async (t) => {
  const logs = [];
  const { gladys, server, store } = await setup(t, { logs });
  const [login] = server.logins();
  assert.ok(login.signed, 'the verification string is right');
  assert.equal(login.headers.Authorization, 'Basic c3dvcmQ6c3dvcmRfc2VjcmV0');
  assert.equal(login.form.username, EMAIL);
  assert.equal(login.form.password, sha1Hex(PASSWORD), 'the password goes as its SHA-1');
  assert.match(login.form.deviceId, /^simulator\*{45}\d{10}###com\.saicmotor\.europecar$/);
  assert.equal(login.content.includes(PASSWORD), false);
  assert.deepEqual(
    server.requests.map((r) => `${r.method} ${r.path} ${r.eventId ?? ''}`.trim()),
    [
      'POST oauth/token',
      'GET vehicle/list',
      'GET vehicle/status 0',
      'GET vehicle/status evt-status-' + VIN,
      'GET vehicle/charging/mgmtData 0',
      'GET vehicle/charging/mgmtData evt-charging-' + VIN,
    ],
  );
  assert.ok(server.requests.every((r) => r.signed));
  assert.equal(
    server.of('vehicle/status')[0].query.vin,
    sha256Hex(VIN),
    'the VIN goes as its SHA-256',
  );
  assert.equal(server.of('vehicle/status')[0].query.vehStatusReqType, '2');

  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).fr, /1 véhicule/);
  const device = deviceOf(gladys);
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'My MG4');
  assert.equal(last(gladys, 'battery-level'), 79);
  assert.equal(last(gladys, 'range'), 324);
  assert.equal(last(gladys, 'odometer'), 13369);
  assert.equal(last(gladys, 'lock-state'), 1);
  assert.equal(last(gladys, 'boot'), 0);
  assert.equal(last(gladys, 'indoor-temperature'), 17);
  assert.equal(last(gladys, 'plugged'), 0);
  assert.equal(last(gladys, 'charging'), 0);
  assert.equal(last(gladys, 'charge-power'), 0);
  assert.equal(last(gladys, 'charge-status'), 'Débranchée');
  assert.equal(last(gladys, 'latitude'), 45.485072);
  assert.equal(last(gladys, 'longitude'), 9.160267);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.CLOUD);

  assert.equal(store.data.session.account, accountKey(EMAIL));
  assert.ok(store.data.reads[ID].next > NOW);
  assertNoLeak(logs, server, store);
});

test('each car is read once per interval (3 h), every 30 min while charging, never sooner', async (t) => {
  const { server, advance } = await setup(t);
  assert.equal(server.wakes().length, 2, 'status + charging');
  await advance(179 * MINUTE, 60_000);
  assert.equal(server.wakes().length, 2, 'nothing before 3 h');
  server.chargings[VIN] = chargingData({ charging: true });
  await advance(2 * MINUTE, 10_000);
  assert.equal(server.wakes().length, 4);
  await advance(28 * MINUTE, 60_000);
  assert.equal(server.wakes().length, 4);
  await advance(2 * MINUTE, 10_000);
  assert.equal(server.wakes().length, 6, 'charging: 30 min');
  assert.equal(server.logins().length, 1, 'the token is kept: no sign-in per read');
});

test('a car that does not answer: 30 s of polling, then 3 h, 6 h, 12 h; never in a loop', async (t) => {
  const server = fakeSaic();
  server.asleep.add(VIN);
  const logs = [];
  const { gladys, advance } = await setup(t, { server, logs });
  const polls = server.of('vehicle/status').length;
  assert.ok(polls >= 9 && polls <= 11, `${polls} polls in 30 s, every 3 s`);
  assert.equal(server.wakes().length, 1, 'no charging read after a car that did not answer');
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the account is fine');
  assert.ok(logs.some((l) => /did not answer/.test(l)));
  await advance(3 * HOUR + MINUTE, 60_000);
  assert.equal(server.wakes().length, 2);
  await advance(6 * HOUR - 2 * MINUTE, 60_000);
  assert.equal(server.wakes().length, 2, 'twice the interval after a second silence');
  await advance(3 * MINUTE, 60_000);
  assert.equal(server.wakes().length, 3);
  server.asleep.delete(VIN);
  await advance(12 * HOUR + MINUTE, 60_000);
  await advance(20_000);
  assert.equal(server.wakes().length, 5, 'it answers: status and charging');
  assert.equal(last(gladys, 'battery-level'), 79);
});

test('a refused password stops: one new try after 6 h, then every 24 h; kept across a restart', async (t) => {
  const server = fakeSaic();
  server.password = 'another one';
  const store = memoryStore();
  const { gladys, app, advance } = await setup(t, { server, store });
  assert.equal(server.logins().length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /refused the e-mail or the password \(code 2\)/);
  assert.equal(store.data.block.kind, 'refused');
  await advance(5 * HOUR, 60_000);
  assert.equal(server.logins().length, 1);
  // A restart keeps the stop.
  await app.start(CONFIG);
  await settle();
  assert.equal(server.logins().length, 1, 'no sign-in at a restart before its time');
  await advance(HOUR + MINUTE, 60_000);
  assert.equal(server.logins().length, 2);
  await advance(23 * HOUR, 60_000);
  assert.equal(server.logins().length, 2, 'then 24 h');
  // The button tries at once.
  server.password = PASSWORD;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.logins().length, 3);
  assert.match(ack.data.message.fr, /My MG4/);
  assert.match(ack.data.message.fr, /n'ont pas été réveillées/);
});

test('the session taken by the app: one new sign-in, then a stop instead of a fight', async (t) => {
  const store = memoryStore();
  const { gladys, server, advance } = await setup(t, { store });
  server.takeSession();
  await advance(3 * HOUR + MINUTE, 60_000);
  assert.equal(server.logins().length, 2, 'signed in again once');
  assert.equal(last(gladys, 'battery-level'), 79);
  server.takeSession();
  await advance(3 * HOUR + MINUTE, 60_000);
  assert.equal(server.logins().length, 2, 'not twice within 24 h');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /SAIC n'accepte qu'une session/);
  assert.equal(store.data.block.kind, 'session_taken');
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  await advance(6 * HOUR, 60_000);
  assert.equal(server.logins().length, 3, 'a new try after 6 h');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('429: a bounded pause for every path, kept in /data', async (t) => {
  const store = memoryStore();
  const { gladys, server, advance } = await setup(t, { store });
  server.queue.push({
    match: (r) => r.path === 'vehicle/status',
    status: 429,
    headers: { 'retry-after': '999999' },
  });
  await advance(3 * HOUR + MINUTE, 60_000);
  assert.equal(store.data.pause.kind, 'rate');
  assert.ok(store.data.pause.until - Date.now() <= TIMINGS.rateLimitMax);
  assert.match(message(gladys).en, /slow down/);
  await assert.rejects(async () => {
    const ack = await press(gladys, 'refresh');
    if (!ack.success) {
      throw new Error(ack.error);
    }
  }, /slow down|ralentir/);
});

test('every command is off by default: refused at once, nothing sent', async (t) => {
  const { gladys, server } = await setup(t);
  for (const role of [
    'lock',
    'unlock',
    'open-boot',
    'climate-start',
    'climate-stop',
    'charge-start',
    'charge-stop',
  ]) {
    const ack = await press(gladys, role);
    assert.equal(ack.success, false, role);
    assert.match(ack.error, /désactivée|Autoriser/);
  }
  const readOnly = await gladys.fake.setValue(deviceOf(gladys), featureOf(gladys, 'lock-state'), 0);
  assert.equal(readOnly.success, false);
  assert.equal(server.commands().length, 0);
});

test('lock: answered at once, then a fresh read, one command, the result and a read after', async (t) => {
  const server = fakeSaic();
  server.statuses[VIN] = vehicleStatus({ lockStatus: 0 });
  const { gladys, advance } = await setup(t, { server, config: { ...CONFIG, allow_lock: true } });
  assert.equal(last(gladys, 'lock-state'), 0);
  for (const bad of [0, '', null, true, 'on', 2]) {
    const ack = await press(gladys, 'lock', bad);
    assert.equal(ack.success, false, `value ${JSON.stringify(bad)}`);
  }
  const wakes = server.wakes().length;
  const ack = await press(gladys, 'lock');
  assert.equal(ack.success, true);
  assert.match(String(last(gladys, 'command-status')), /relecture/);
  const busy = await press(gladys, 'lock');
  assert.equal(busy.success, false, 'one at a time');
  await advance(15_000);
  assert.equal(server.wakes().length, wakes + 1, 'a fresh read first');
  const commands = server.commands();
  assert.equal(commands.filter((c) => c.eventId === '0').length, 1, 'sent once');
  assert.deepEqual(commands[0].json, { rvcParams: null, rvcReqType: '1', vin: sha256Hex(VIN) });
  assert.match(String(last(gladys, 'command-status')), /Verrouillage envoyé, confirmé par MG/);
  assert.equal(last(gladys, 'lock-state'), 1, 'from the answer of the command');
  await advance(TIMINGS.refreshAfterCommand + 30_000, 10_000);
  assert.equal(server.wakes().length, wakes + 3, 'one read after (status and charging)');
  // Already locked: nothing sent.
  await press(gladys, 'lock');
  await advance(15_000);
  assert.equal(server.commands().filter((c) => c.eventId === '0').length, 1);
  assert.match(String(last(gladys, 'command-status')), /non envoyé : déjà verrouillée/);
});

test('unlock and boot: only behind their own option; decided on the read, never on memory', async (t) => {
  const server = fakeSaic();
  const { gladys, advance } = await setup(t, {
    server,
    config: { ...CONFIG, allow_unlock: true, allow_lock: true },
  });
  const boot = await press(gladys, 'open-boot');
  assert.equal(boot.success, false, 'allow_unlock does not open the boot');
  // In memory: locked. On the car now: lock state unknown -> not sent.
  server.statuses[VIN] = vehicleStatus({ lockStatus: 9 });
  await press(gladys, 'unlock');
  await advance(15_000);
  assert.equal(server.commands().length, 0);
  assert.match(String(last(gladys, 'command-status')), /état de la voiture est inconnu/);
  // A read that fails: not sent either.
  server.statuses[VIN] = vehicleStatus({ lockStatus: 1 });
  server.asleep.add(VIN);
  await press(gladys, 'unlock');
  await advance(40_000);
  assert.equal(server.commands().length, 0);
  assert.match(String(last(gladys, 'command-status')), /pas pu être relue/);
  server.asleep.delete(VIN);
  await press(gladys, 'unlock');
  await advance(15_000);
  const [unlock] = server.commands();
  assert.equal(unlock.json.rvcReqType, '2');
  assert.equal(Buffer.from(unlock.json.rvcParams[3].paramValue, 'base64')[0], 3, 'the doors');
  assert.equal(last(gladys, 'lock-state'), 0);
});

test('climate and charge: off by default, then sent on the state read; not plugged refused', async (t) => {
  const { gladys, server, advance } = await setup(t, {
    config: { ...CONFIG, allow_climate: true, allow_charging: true },
  });
  await press(gladys, 'climate-start');
  await advance(15_000);
  assert.equal(server.commands().filter((c) => c.eventId === '0').length, 1);
  assert.equal(last(gladys, 'climate-on'), 1);
  await press(gladys, 'charge-start');
  await advance(20_000);
  assert.equal(
    server.commands().filter((c) => c.eventId === '0').length,
    1,
    'not plugged: not sent',
  );
  assert.match(String(last(gladys, 'command-status')), /pas branchée/);
  server.chargings[VIN] = chargingData({ charging: false, gun: 1 });
  await advance(TIMINGS.refreshAfterCommand, 10_000);
  await press(gladys, 'charge-start');
  await advance(20_000);
  const sent = server.commands().filter((c) => c.eventId === '0');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].path, 'vehicle/charging/control');
  assert.equal(sent[1].json.chrgCtrlReq, 1);
});

test('a command that may have left is never said "not sent"', async (t) => {
  const { gladys, server, advance } = await setup(t, {
    config: { ...CONFIG, allow_climate: true },
  });
  server.queue.push({
    match: (r) => r.path === 'vehicle/control',
    error: Object.assign(new Error('x'), { kind: 'timeout', notSent: false }),
  });
  await press(gladys, 'climate-start');
  await advance(20_000);
  assert.match(String(last(gladys, 'command-status')), /envoyé, sans confirmation/);
});

test('the refresh button wakes the car at most every 10 minutes; the test button never', async (t) => {
  const { gladys, server, advance } = await setup(t);
  const wakes = server.wakes().length;
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /were not woken up/);
  assert.equal(server.wakes().length, wakes, 'the test button reads the list only');
  assert.equal((await press(gladys, 'refresh')).success, true);
  await advance(10_000);
  assert.equal(server.wakes().length, wakes + 2);
  assert.match(String(last(gladys, 'command-status')), /Actualisé/);
  const again = await press(gladys, 'refresh');
  assert.equal(again.success, false);
  assert.match(again.error, /réveille la voiture/);
});

test('a restart does not wake the car again before its time, and keeps the token', async (t) => {
  const store = memoryStore();
  const { app, server, advance } = await setup(t, { store });
  assert.equal(server.wakes().length, 2);
  await advance(10 * MINUTE, 60_000);
  await app.start(CONFIG);
  await advance(40_000);
  assert.equal(server.wakes().length, 2, 'no read at the restart');
  assert.equal(server.logins().length, 1, 'no sign-in at the restart');
  assert.equal(server.of('vehicle/list').length, 2, 'the list (no wake-up) is read again');
});

test('two cars: one device each; one silent car does not stop the other', async (t) => {
  const server = fakeSaic();
  server.vehicles.push(vehicleInfo({ vin: VIN2, name: 'ZS' }));
  server.statuses[VIN2] = vehicleStatus({ mileage: 5000 });
  server.chargings[VIN2] = chargingData();
  server.asleep.add(VIN);
  const { gladys } = await setup(t, { server, create: false });
  await settle();
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const zs = gladys.fake.discoveredDevices.find((d) => d.name === 'ZS');
  await gladys.fake.deviceCreated(zs);
  await settle();
  assert.equal(gladys.fake.lastState(`${zs.external_id}:odometer`), 500);
});

test('a reconnection to Gladys resends the status, the device and the badge', async (t) => {
  const { gladys, app } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const transports = gladys.fake.transports.length;
  await app.connected(CONFIG);
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.transports.length, transports + 1);
});
