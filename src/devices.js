// -----------------------------------------------------------------------------
// A car -> one Gladys device and its states (pure).
//
// `ext:<selector>:vehicle:<id>`, the id being the first 16 hex of the SHA-256
// of the VIN: stable, and the VIN never reaches Gladys. The features are keyed
// by their role (the last part of their external id): published forever,
// never rename them. Every vehicle gets the same full list, so a device
// published again never loses a feature.
//
// Readings are read only. The commands are BUTTON/PUSH features only: never a
// switch nor a binary command (a "turn everything off", Google Home, Alexa,
// HomeKit or a `switch.*` scene action must not reach them); the lock, the
// boot and the climate are read-only states. Categories and units are those
// the core lists (DEVICE_FEATURE_UNITS_BY_CATEGORY): % and km on
// `electrical-vehicle-battery`, kW on `electrical-vehicle-charge`, km on
// `electrical-vehicle-state`, °C on `electrical-vehicle-climate`. No energy
// index: the gateway gives no reliable cumulative meter.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { BUTTONS, FEATURES } from './constants.js';
import { CHARGE_NAMES, CLIMATE_NAMES, FEATURE_NAMES, word } from './i18n.js';

/** LOCK.STATE of the core: 0 unlocked, 1 locked. */
export const LOCK_STATE = { UNLOCKED: 0, LOCKED: 1 };

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const binary = (category, type) => sensor({ category, type, min: 0, max: 1 });
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};
const door = binary(C.ELECTRICAL_VEHICLE_STATE, T.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED);

/** The features, by role, in display order. */
export const DEFINITIONS = {
  [FEATURES.BATTERY]: sensor({
    category: C.ELECTRICAL_VEHICLE_BATTERY,
    type: T.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.RANGE]: sensor({
    category: C.ELECTRICAL_VEHICLE_BATTERY,
    type: T.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
    unit: U.KM,
    min: 0,
    max: 2000,
  }),
  [FEATURES.CHARGE_STATUS]: text,
  [FEATURES.CHARGING]: binary(C.BATTERY, T.BATTERY.CHARGING),
  [FEATURES.PLUGGED]: binary(C.ELECTRICAL_VEHICLE_CHARGE, T.ELECTRICAL_VEHICLE_CHARGE.PLUGGED),
  [FEATURES.CHARGE_POWER]: sensor({
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
    unit: U.KILOWATT,
    min: 0,
    max: 400,
  }),
  [FEATURES.ODOMETER]: sensor({
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.ODOMETER,
    unit: U.KM,
    min: 0,
    max: 10_000_000,
  }),
  [FEATURES.LOCK_STATE]: sensor({ category: C.LOCK, type: T.LOCK.STATE, min: 0, max: 3 }),
  [FEATURES.DOOR_DRIVER]: door,
  [FEATURES.DOOR_PASSENGER]: door,
  [FEATURES.DOOR_REAR_LEFT]: door,
  [FEATURES.DOOR_REAR_RIGHT]: door,
  [FEATURES.BOOT]: door,
  // The position: plain numbers (the core has no position type), never in
  // the history nor in the logs.
  [FEATURES.LATITUDE]: sensor({
    category: C.UNKNOWN,
    type: T.UNKNOWN.UNKNOWN,
    min: -90,
    max: 90,
    keep_history: false,
  }),
  [FEATURES.LONGITUDE]: sensor({
    category: C.UNKNOWN,
    type: T.UNKNOWN.UNKNOWN,
    min: -180,
    max: 180,
    keep_history: false,
  }),
  [FEATURES.INDOOR_TEMPERATURE]: sensor({
    category: C.ELECTRICAL_VEHICLE_CLIMATE,
    type: T.ELECTRICAL_VEHICLE_CLIMATE.INDOOR_TEMPERATURE,
    unit: U.CELSIUS,
    min: -40,
    max: 80,
  }),
  // Read only: never the core's climate-on (a command type).
  [FEATURES.CLIMATE_ON]: binary(C.UNKNOWN, T.SENSOR.BINARY),
  [FEATURES.CLIMATE_STATUS]: text,
  [FEATURES.LAST_UPDATE]: text,
  [FEATURES.COMMAND_STATUS]: text,
  ...Object.fromEntries(Object.keys(BUTTONS).map((role) => [role, button])),
};

export const ROLES = Object.keys(DEFINITIONS);

export const vehicleIds = (gladys, id) => gladys.externalIds('vehicle', id);

/** The vehicle id and the role of a feature external id, else undefined. */
export function parseFeatureId(externalId) {
  const match = /:vehicle:([0-9a-f]{16}):([a-z-]+)$/.exec(String(externalId ?? ''));
  return match && ROLES.includes(match[2]) ? { id: match[1], role: match[2] } : undefined;
}

const params = (entries) =>
  entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));

export function buildDevice(gladys, vehicle, { language }) {
  const ids = vehicleIds(gladys, vehicle.id);
  return {
    name: vehicle.name,
    external_id: ids.device,
    ...(vehicle.model ? { model: vehicle.model } : {}),
    should_poll: false,
    features: ROLES.map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
    })),
    params: params([
      ['model_year', vehicle.year],
      ['series', vehicle.series],
    ]),
  };
}

/** "2026-10-18 14:02" in the timezone of the configuration. */
export function wallClock(ms, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** "14:02" in the timezone of the configuration. */
export const clock = (ms, timezone) => wallClock(ms, timezone).slice(11);

const bit = (value) => (value === undefined ? undefined : value ? 1 : 0);

/**
 * The states of one car: `[{ role, state }]` or `[{ role, text }]`. A value
 * the read did not give is left out: Gladys keeps its last value.
 */
export function statesOf(snapshot, { language, timezone }) {
  const states = [];
  const add = (role, state) => {
    if (state !== undefined) {
      states.push({ role, state });
    }
  };
  add(FEATURES.BATTERY, snapshot.battery);
  add(FEATURES.RANGE, snapshot.range);
  if (snapshot.chargeStatus !== undefined) {
    states.push({
      role: FEATURES.CHARGE_STATUS,
      text: word(CHARGE_NAMES[snapshot.chargeStatus] ?? CHARGE_NAMES.unknown, language),
    });
  }
  add(FEATURES.CHARGING, bit(snapshot.charging));
  add(FEATURES.PLUGGED, bit(snapshot.plugged));
  add(FEATURES.CHARGE_POWER, snapshot.chargePower);
  add(FEATURES.ODOMETER, snapshot.odometer);
  add(
    FEATURES.LOCK_STATE,
    snapshot.locked === undefined
      ? undefined
      : snapshot.locked
        ? LOCK_STATE.LOCKED
        : LOCK_STATE.UNLOCKED,
  );
  add(FEATURES.DOOR_DRIVER, snapshot.doors?.driver);
  add(FEATURES.DOOR_PASSENGER, snapshot.doors?.passenger);
  add(FEATURES.DOOR_REAR_LEFT, snapshot.doors?.rearLeft);
  add(FEATURES.DOOR_REAR_RIGHT, snapshot.doors?.rearRight);
  add(FEATURES.BOOT, snapshot.boot);
  add(FEATURES.LATITUDE, snapshot.position?.latitude);
  add(FEATURES.LONGITUDE, snapshot.position?.longitude);
  add(FEATURES.INDOOR_TEMPERATURE, snapshot.indoor);
  add(FEATURES.CLIMATE_ON, bit(snapshot.climateOn));
  if (snapshot.climateName !== undefined) {
    states.push({
      role: FEATURES.CLIMATE_STATUS,
      text: word(CLIMATE_NAMES[snapshot.climateName], language),
    });
  }
  const at = snapshot.statusTime ?? (snapshot.hasStatus ? snapshot.readAt : undefined);
  if (at !== undefined) {
    states.push({ role: FEATURES.LAST_UPDATE, text: wallClock(at, timezone) });
  }
  return states;
}
