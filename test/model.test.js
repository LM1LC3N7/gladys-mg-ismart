// -----------------------------------------------------------------------------
// Answers -> values, and values -> Gladys states (pure).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FEATURES } from '../src/constants.js';
import { DEFINITIONS, buildDevice, parseFeatureId, statesOf, wallClock } from '../src/devices.js';
import { positionOf, readCharging, readSnapshot, readVehicle, statusTimeOf } from '../src/model.js';
import {
  NOW,
  VIN,
  chargingData,
  gpsPosition,
  vehicleInfo,
  vehicleStatus,
} from './fixtures/saic.js';

const CONFIG = { language: 'fr', timezone: 'Europe/Paris' };

test('a vehicle: a hash of the VIN as id, names trimmed, a bad VIN dropped', () => {
  const vehicle = readVehicle(vehicleInfo());
  assert.match(vehicle.id, /^[0-9a-f]{16}$/);
  assert.equal(readVehicle(vehicleInfo({ vin: VIN.toLowerCase() })).id, vehicle.id);
  assert.equal(vehicle.name, 'My MG4');
  assert.equal(vehicle.model, 'MG MG4 Electric');
  assert.equal(readVehicle(vehicleInfo({ name: '  ' })).name, 'MG MG4 Electric');
  assert.equal(readVehicle(vehicleInfo({ vin: 'bad vin!' })), undefined);
  assert.equal(readVehicle(null), undefined);
});

test('the status of the reference test answer, with its scales', () => {
  const s = readSnapshot({ status: vehicleStatus({ remoteClimateStatus: 2 }) }, NOW);
  assert.equal(s.odometer, 13369, 'mileage in 0.1 km');
  assert.equal(s.range, 324, 'electric range in 0.1 km');
  assert.equal(s.battery, 79, 'extendedData1 without charging data');
  assert.equal(s.locked, 1);
  assert.deepEqual(s.doors, { driver: 0, passenger: 0, rearLeft: 0, rearRight: 0 });
  assert.equal(s.boot, 0);
  assert.equal(s.indoor, 17);
  assert.equal(s.climateOn, true);
  assert.equal(s.climateName, 'on');
  assert.deepEqual(s.position, { latitude: 45.485072, longitude: 9.160267 });
  assert.equal(s.statusTime, NOW - 60_000);
  assert.equal(s.charging, undefined, 'no charging data, no charging state');
});

test('out of range values are dropped, never published', () => {
  const s = readSnapshot(
    {
      status: vehicleStatus({
        interiorTemperature: -128,
        mileage: 0,
        fuelRangeElec: 0,
        lockStatus: 2,
        driverDoor: null,
        extendedData1: 0,
        remoteClimateStatus: -1,
      }),
    },
    NOW,
  );
  for (const key of ['indoor', 'odometer', 'range', 'locked', 'battery', 'climateOn']) {
    assert.equal(s[key], undefined, key);
  }
  assert.equal(s.doors.driver, undefined);
  assert.equal(readSnapshot({}, NOW).hasStatus, false);
});

test('the position needs a fix and a plausible value; west and south are kept', () => {
  assert.equal(positionOf(gpsPosition(45485072, 9160267, 0)), undefined, 'no signal');
  assert.equal(positionOf(gpsPosition(45485072, 9160267, 1)), undefined, 'time only');
  assert.equal(positionOf(gpsPosition(0, 0, 3)), undefined, '0,0 is no position');
  assert.equal(positionOf(gpsPosition(95_000_000, 0, 3)), undefined);
  assert.deepEqual(positionOf(gpsPosition(-33868820, -151209290, 3)), {
    latitude: -33.86882,
    longitude: -151.20929,
  });
  assert.equal(positionOf(gpsPosition(-33868820, -181_000_000, 3)), undefined);
  assert.deepEqual(positionOf(gpsPosition(-33868820, -70209290, 3)), {
    latitude: -33.86882,
    longitude: -70.20929,
  });
});

test('the charging answer of the reference test: charging, plugged, 1.75 kW, 79 %', () => {
  const c = readCharging(chargingData({ charging: true }));
  assert.equal(c.charging, true);
  assert.equal(c.plugged, true);
  assert.equal(c.power, 1.75, '(19915 × 0.05 − 1000) A × 1649 × 0.25 V');
  assert.equal(c.battery, 79, '786 in 0.1 %');
  assert.equal(c.status, 'charging');
  const idle = readCharging(chargingData({ charging: false, gun: 1 }));
  assert.deepEqual(
    [idle.charging, idle.plugged, idle.power, idle.status],
    [false, true, 0, 'plugged'],
  );
  const out = readCharging(chargingData({ charging: false, gun: 0 }));
  assert.deepEqual([out.charging, out.plugged, out.status], [false, false, 'unplugged']);
  assert.deepEqual(readCharging(undefined).charging, undefined);
  const silly = chargingData({ charging: true });
  silly.chrgMgmtData.bmsPackVol = 0;
  assert.equal(readCharging(silly).power, undefined, 'no voltage, no power');
});

test('statusTime in seconds or milliseconds, never absurd', () => {
  assert.equal(statusTimeOf(NOW / 1000, NOW), NOW);
  assert.equal(statusTimeOf(NOW, NOW), NOW);
  assert.equal(statusTimeOf(1000, NOW), undefined);
  assert.equal(statusTimeOf(NOW + 7 * 86_400_000, NOW), undefined);
});

test('the device: stable ids, units of the core only, buttons and read-only states', () => {
  const gladys = createFakeGladys();
  const vehicle = readVehicle(vehicleInfo());
  const device = buildDevice(gladys, vehicle, CONFIG);
  assert.equal(device.external_id, `ext:test-integration:vehicle:${vehicle.id}`);
  assert.ok(!JSON.stringify(device).includes(VIN), 'the VIN never reaches Gladys');
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core (server/utils/constants.js).
  const allowed = {
    'electrical-vehicle-battery': [
      'celsius',
      'fahrenheit',
      'kilowatt',
      'kilowatt-hour',
      'km',
      'mile',
      'percent',
      'volt',
    ],
    'electrical-vehicle-charge': [
      'ampere',
      'kilowatt',
      'kilowatt-hour',
      'megawatt-hour',
      'percent',
      'volt',
    ],
    'electrical-vehicle-state': ['km', 'mile', 'bar', 'psi', 'kilo-pascal'],
    'electrical-vehicle-climate': ['celsius', 'fahrenheit'],
  };
  for (const feature of device.features) {
    const { id, role } = parseFeatureId(feature.external_id);
    assert.equal(id, vehicle.id);
    assert.ok(role in DEFINITIONS);
    if (feature.unit) {
      assert.ok(allowed[feature.category]?.includes(feature.unit), `${role}: ${feature.unit}`);
    }
    if (feature.category === 'button') {
      assert.equal(feature.type, 'push');
      assert.equal(feature.read_only, false);
    } else {
      assert.equal(feature.read_only, true, `${role} is read only`);
      assert.notEqual(feature.category, 'switch');
    }
  }
  for (const role of [FEATURES.LATITUDE, FEATURES.LONGITUDE]) {
    const f = device.features.find((x) => x.external_id.endsWith(`:${role}`));
    assert.equal(f.category, 'unknown');
    assert.equal(f.keep_history, false, 'no history of the position');
  }
  assert.equal(
    device.features.find((x) => x.external_id.endsWith(':lock-state')).type,
    'state',
    'the lock is a read-only LOCK.STATE, never a lock/binary command',
  );
  assert.equal(parseFeatureId('ext:x:vehicle:0123456789abcdef:nope'), undefined);
});

test('states: only the known values, texts in the language, the time in the timezone', () => {
  const snapshot = readSnapshot(
    { status: vehicleStatus(), charging: chargingData({ charging: true }) },
    NOW,
  );
  const states = Object.fromEntries(
    statesOf(snapshot, CONFIG).map((s) => [s.role, s.state ?? s.text]),
  );
  assert.equal(states['battery-level'], 79);
  assert.equal(states.range, 324);
  assert.equal(states.charging, 1);
  assert.equal(states.plugged, 1);
  assert.equal(states['charge-power'], 1.75);
  assert.equal(states['charge-status'], 'En charge');
  assert.equal(states['lock-state'], 1);
  assert.equal(states['climate-status'], 'Arrêtée');
  assert.equal(states['climate-on'], 0);
  assert.equal(states.latitude, 45.485072);
  assert.equal(states['last-update'], '2026-10-18 11:59');
  const empty = statesOf(readSnapshot({}, NOW), CONFIG);
  assert.deepEqual(empty, []);
  // Around midnight, west and east of Paris, on both sides of the end of summer time.
  assert.equal(wallClock(Date.UTC(2026, 9, 24, 23, 30), 'Europe/Lisbon'), '2026-10-25 00:30');
  assert.equal(wallClock(Date.UTC(2026, 9, 25, 23, 30), 'Europe/Lisbon'), '2026-10-25 23:30');
  assert.equal(wallClock(Date.UTC(2026, 9, 25, 21, 30), 'Europe/Helsinki'), '2026-10-25 23:30');
});
