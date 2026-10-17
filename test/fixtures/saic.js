// -----------------------------------------------------------------------------
// Answers of the SAIC gateway, shaped like the test answers of
// saic-ismart-client-ng (tests/test_vehicle_control_resp.py and
// tests/test_charge_info_resp.py), with made-up identities.
// -----------------------------------------------------------------------------

export const EMAIL = 'driver@example.com';
export const PASSWORD = 'correct horse battery staple';
export const VIN = 'LSJW74U10NZ123456';
export const VIN2 = 'LSJA24U92PZ654321';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const NOW = Date.UTC(2026, 9, 18, 10, 0, 0);

export const vehicleInfo = (overrides = {}) => ({
  vin: VIN,
  name: 'My MG4',
  brandName: 'MG',
  modelName: 'MG4 Electric',
  modelYear: '2023',
  series: 'EH32 S',
  isActivate: true,
  isSubaccount: true,
  subAccountList: [],
  vehicleModelConfiguration: [],
  ...overrides,
});

export const basicStatus = (overrides = {}) => ({
  frontRightSeatHeatLevel: 0,
  rearRightDoor: 0,
  sideLightStatus: 0,
  driverWindow: 0,
  canBusActive: 1,
  driverDoor: 0,
  lockStatus: 1,
  powerMode: 0,
  engineStatus: 0,
  exteriorTemperature: 7,
  fuelRange: 3240,
  extendedData2: 0,
  extendedData1: 79,
  mileage: 133690,
  interiorTemperature: 17,
  batteryVoltage: 142,
  passengerDoor: 0,
  remoteClimateStatus: 0,
  bootStatus: 0,
  fuelRangeElec: 3240,
  rearLeftDoor: 0,
  vehicleAlarmStatus: 2,
  ...overrides,
});

export const gpsPosition = (latitude = 45485072, longitude = 9160267, gpsStatus = 2) => ({
  timeStamp: Math.floor(NOW / 1000),
  gpsStatus,
  wayPoint: {
    satellites: 10,
    heading: 0,
    position: { altitude: 115, latitude, longitude },
    hdop: 7,
    speed: 0,
  },
});

export const vehicleStatus = (basic = {}, extra = {}) => ({
  basicVehicleStatus: basicStatus(basic),
  gpsPosition: gpsPosition(),
  statusTime: Math.floor(NOW / 1000) - 60,
  ...extra,
});

/** Charging data: `charging` true reproduces the answer of the reference test. */
export const chargingData = ({ charging = false, gun = charging ? 1 : 0, soc = 786 } = {}) => ({
  chrgMgmtData: {
    bmsChrgSts: charging ? 1 : gun === 1 ? 7 : 0,
    bmsPackVol: 1649,
    bmsPackCrnt: charging ? 19915 : 20000,
    bmsPackSOCDsp: soc,
    bmsEstdElecRng: 358,
    ccuOnbdChrgrPlugOn: 4,
    ccuOffBdChrgrPlugOn: 1,
    bmsOnBdChrgTrgtSOCDspCmd: 5,
  },
  rvsChargeStatus: {
    mileage: 161410,
    fuelRangeElec: 3300,
    realtimePower: 570,
    chargingGunState: gun,
    totalBatteryCapacity: 725,
  },
});
