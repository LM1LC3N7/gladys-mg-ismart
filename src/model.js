// -----------------------------------------------------------------------------
// Answers of the gateway -> plain values (pure). Every value is checked: a
// value out of its range (the gateway sends -128, 1023 or 0 for "unknown")
// is undefined, never published. Scales follow saic-ismart-client-ng
// (MIT) and its test answers: mileage and electric range in 0.1 km, the
// state of charge in 0.1 %, the position in micro-degrees, the pack current
// as `raw × 0.05 − 1000` A and the pack voltage as `raw × 0.25` V.
// -----------------------------------------------------------------------------

import { BMS_STATUS, CHARGING_CODES, CLIMATE_STATUS, LIMITS } from './constants.js';
import { sha256Hex } from './crypto.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An integer within [min, max], else undefined. */
export const int = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : undefined;

const round = (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

const text = (value) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim().replace(/\s+/g, ' ').slice(0, LIMITS.textLength)
    : undefined;

/**
 * One vehicle of /vehicle/list. The id kept is a hash of the VIN (16 hex):
 * stable and pseudonymised (computable from the VIN, not anonymous); the VIN
 * itself is not written to Gladys nor to the logs.
 */
export function readVehicle(info) {
  if (!isObject(info) || typeof info.vin !== 'string' || !/^[A-Za-z0-9]{6,32}$/.test(info.vin)) {
    return undefined;
  }
  const brand = text(info.brandName);
  const model = text(info.modelName);
  const fallback = [brand, model].filter(Boolean).join(' ') || 'MG';
  return {
    vin: info.vin,
    id: sha256Hex(info.vin.toUpperCase()).slice(0, 16),
    name: text(info.name) ?? fallback,
    model: [brand, model].filter(Boolean).join(' ') || undefined,
    year: text(info.modelYear),
    series: text(info.series),
  };
}

/** statusTime (seconds or milliseconds) -> milliseconds, when plausible. */
export function statusTimeOf(value, now) {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const ms = value > 1e12 ? value : value * 1000;
  return ms >= Date.UTC(2015, 0, 1) && ms <= now + 86_400_000 ? ms : undefined;
}

/** The position of a gpsPosition, in degrees, when the car has a fix. */
export function positionOf(gps) {
  const status = gps?.gpsStatus;
  // GpsStatus: 0 no signal, 1 time only, 2 and 3 a 2D or 3D fix.
  if (status !== undefined && status !== null && status !== 2 && status !== 3) {
    return undefined;
  }
  const position = gps?.wayPoint?.position;
  const lat = int(position?.latitude, -90_000_000, 90_000_000);
  const lon = int(position?.longitude, -180_000_000, 180_000_000);
  if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) {
    return undefined;
  }
  return { latitude: round(lat / 1e6, 6), longitude: round(lon / 1e6, 6) };
}

/** A door, the boot: 1 open, 0 closed. */
const openOf = (value) => (value === 0 || value === 1 ? value : undefined);

/** The charging part: from /vehicle/charging/mgmtData (`charging` may be undefined). */
export function readCharging(data) {
  const mgmt = isObject(data?.chrgMgmtData) ? data.chrgMgmtData : {};
  const rvs = isObject(data?.rvsChargeStatus) ? data.rvsChargeStatus : {};
  const code = int(mgmt.bmsChrgSts, 0, 63);
  const charging = code === undefined ? undefined : CHARGING_CODES.has(code);
  let plugged;
  if (rvs.chargingGunState === 1 || rvs.chargingGunState === 0) {
    plugged = rvs.chargingGunState === 1;
  } else if (code === 0) {
    plugged = false;
  } else if (code !== undefined && code !== 4 && code !== 13 && BMS_STATUS[code]) {
    plugged = true;
  }
  let power;
  if (charging === false) {
    power = 0;
  } else if (charging === true) {
    const rawCurrent = int(mgmt.bmsPackCrnt, 0, 65_535);
    const rawVoltage = int(mgmt.bmsPackVol, 1, 4_000);
    if (rawCurrent !== undefined && rawVoltage !== undefined) {
      const kw = Math.abs(((rawCurrent * 0.05 - 1000) * rawVoltage * 0.25) / 1000);
      power = kw <= 400 ? round(kw, 2) : undefined;
    }
  }
  const soc = int(mgmt.bmsPackSOCDsp, 0, 1000);
  return {
    code,
    status: code === undefined ? undefined : (BMS_STATUS[code] ?? 'unknown'),
    charging,
    plugged,
    power,
    battery: soc === undefined ? undefined : Math.round(soc / 10),
    range: int(mgmt.bmsEstdElecRng, 1, 2_000),
  };
}

/**
 * A snapshot of one car: the status answer (/vehicle/status, or the
 * basicVehicleStatus of a command answer) and the charging answer (optional).
 */
export function readSnapshot({ status, charging }, now) {
  const basic = isObject(status?.basicVehicleStatus) ? status.basicVehicleStatus : {};
  const charge = readCharging(charging);
  const mileage = int(basic.mileage, 1, 100_000_000);
  const range = int(basic.fuelRangeElec, 1, 20_000);
  const extendedSoc = int(basic.extendedData1, 1, 100);
  const climate = int(basic.remoteClimateStatus, 0, 15);
  const locked = basic.lockStatus === 0 || basic.lockStatus === 1 ? basic.lockStatus : undefined;
  return {
    hasStatus: Object.keys(basic).length > 0,
    battery: charge.battery ?? extendedSoc,
    range: range !== undefined ? Math.round(range / 10) : charge.range,
    odometer: mileage === undefined ? undefined : Math.round(mileage / 10),
    locked,
    doors: {
      driver: openOf(basic.driverDoor),
      passenger: openOf(basic.passengerDoor),
      rearLeft: openOf(basic.rearLeftDoor),
      rearRight: openOf(basic.rearRightDoor),
    },
    boot: openOf(basic.bootStatus),
    indoor: int(basic.interiorTemperature, -40, 80),
    climate,
    climateName: climate === undefined ? undefined : (CLIMATE_STATUS[climate] ?? 'on'),
    climateOn: climate === undefined ? undefined : climate > 0,
    engineRunning: basic.engineStatus === 1,
    position: positionOf(status?.gpsPosition),
    statusTime: statusTimeOf(status?.statusTime, now),
    charging: charge.charging,
    plugged: charge.plugged,
    chargePower: charge.power,
    chargeStatus: charge.status,
    hasCharging: charge.code !== undefined,
    readAt: now,
  };
}
