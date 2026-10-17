// -----------------------------------------------------------------------------
// SAIC iSMART constants (MG cars, Europe), manifest keys, limits and timings.
//
// The API is the one of the MG iSMART app, undocumented. The gateway, the
// tenant, the region, the app headers, the OAuth client of the sign-in and the
// paths are those of saic-ismart-client-ng 0.10.0 (MIT, SAIC-iSmart-API).
// -----------------------------------------------------------------------------

/** The European gateway of the MG iSMART app (SaicApiConfiguration defaults). */
export const SAIC = {
  baseUri: 'https://gateway-mg-eu.soimt.com/api.app/v1/',
  tenantId: '459771',
  region: 'eu',
  /**
   * The OAuth client of the app ("sword:sword_secret", base64), sent as the
   * reference does: a public constant of the app, not a secret of the user.
   */
  basicAuth: 'Basic c3dvcmQ6c3dvcmRfc2VjcmV0',
  userAgent: 'Europe/2.1.0 (iPad; iOS 18.5; Scale/2.00)',
  /** The app id appended to the device id of the sign-in. */
  appId: 'com.saicmotor.europecar',
};

/** API paths, relative to SAIC.baseUri (no leading slash). */
export const PATHS = {
  login: 'oauth/token',
  vehicles: 'vehicle/list',
  status: 'vehicle/status',
  charging: 'vehicle/charging/mgmtData',
  control: 'vehicle/control',
  chargingControl: 'vehicle/charging/control',
};

/** rvcReqType of /vehicle/control (RvcReqType of the reference). */
export const RVC_REQ = {
  CLOSE_LOCKS: '1',
  OPEN_LOCKS: '2',
  CLIMATE: '6',
};

/** rvcParams ids (RvcParamsId of the reference). */
export const RVC_PARAM = {
  UNK_4: 4,
  UNK_5: 5,
  UNK_6: 6,
  LOCK_ID: 7,
  FAN_SPEED: 19,
  TEMPERATURE: 20,
  AC_ON_OFF: 22,
  PARAMS_MAX: 0xff,
};

/** VehicleLockId of the reference. */
export const LOCK_ID = { TAILGATE: 2, DOORS: 3 };

/** bmsChrgSts values meaning "charging" (ChrgMgmtData.is_bms_charging). */
export const CHARGING_CODES = new Set([1, 3, 10, 12]);

/** BmsChargingStatusCode of the reference -> the word shown. */
export const BMS_STATUS = {
  0: 'unplugged',
  1: 'charging',
  2: 'done',
  3: 'charging',
  4: 'fault',
  5: 'connecting',
  6: 'plugged',
  7: 'plugged',
  8: 'stopped',
  9: 'scheduled',
  10: 'charging',
  11: 'charging',
  12: 'charging',
  13: 'discharging',
};

/** remoteClimateStatus -> the word shown (0 off, 1 fan only, 2 on, 5 front defrost). */
export const CLIMATE_STATUS = {
  0: 'off',
  1: 'fan',
  2: 'on',
  5: 'defrost',
};

/** Feature roles (the last part of the feature external ids): frozen forever. */
export const FEATURES = {
  BATTERY: 'battery-level',
  RANGE: 'range',
  CHARGE_STATUS: 'charge-status',
  CHARGING: 'charging',
  PLUGGED: 'plugged',
  CHARGE_POWER: 'charge-power',
  ODOMETER: 'odometer',
  LOCK_STATE: 'lock-state',
  DOOR_DRIVER: 'door-driver',
  DOOR_PASSENGER: 'door-passenger',
  DOOR_REAR_LEFT: 'door-rear-left',
  DOOR_REAR_RIGHT: 'door-rear-right',
  BOOT: 'boot',
  LATITUDE: 'latitude',
  LONGITUDE: 'longitude',
  INDOOR_TEMPERATURE: 'indoor-temperature',
  CLIMATE_ON: 'climate-on',
  CLIMATE_STATUS: 'climate-status',
  LAST_UPDATE: 'last-update',
  COMMAND_STATUS: 'command-status',
  REFRESH: 'refresh',
  LOCK: 'lock',
  UNLOCK: 'unlock',
  OPEN_BOOT: 'open-boot',
  CLIMATE_START: 'climate-start',
  CLIMATE_STOP: 'climate-stop',
  CHARGE_START: 'charge-start',
  CHARGE_STOP: 'charge-stop',
};

/** The buttons, and the configuration option each one needs (null: always allowed). */
export const BUTTONS = {
  [FEATURES.REFRESH]: null,
  [FEATURES.LOCK]: 'allowLock',
  [FEATURES.UNLOCK]: 'allowUnlock',
  [FEATURES.OPEN_BOOT]: 'allowTailgate',
  [FEATURES.CLIMATE_START]: 'allowClimate',
  [FEATURES.CLIMATE_STOP]: 'allowClimate',
  [FEATURES.CHARGE_START]: 'allowCharging',
  [FEATURES.CHARGE_STOP]: 'allowCharging',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** Largest answer read (compressed or not): a vehicle status is a few KB. */
  responseBytes: 512 * 1024,
  /** Longest text kept from an answer (vehicle and model names). */
  textLength: 60,
  /** Vehicles shown at most (an account has one or two). */
  vehicles: 10,
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  requestTimeout: 15_000,
  /** The test button (60 s for Gladys): shorter requests. */
  quickTimeout: 10_000,
  quickBudget: 45_000,
  /**
   * A status or charging read is answered with an event id first, while the
   * cloud wakes the car: the same request is sent again with that event id
   * every 3 s (1 s for a command), for 30 s at most (the reference's tenacity
   * policy). Past 30 s the car did not answer: the read fails, and is never
   * tried again sooner than the interval.
   */
  eventDelayRead: 3_000,
  eventDelayCommand: 1_000,
  eventBudget: 30_000,
  /** Interval of the vehicle reads (configuration, minutes): each read wakes the car. */
  intervalDefault: 180,
  intervalMin: 60,
  intervalMax: 1440,
  /** While the last read said "charging" (the car is awake and on the grid). */
  chargingInterval: 30 * MINUTE,
  /** A car that did not answer: its next reads are spaced twice as much each time, up to 24 h. */
  asleepMax: 24 * HOUR,
  /** The vehicle list (does not wake the car): at start, then every 24 h. */
  vehicleListInterval: 24 * HOUR,
  /** A token is renewed by a new sign-in when it expires within 10 minutes. */
  tokenMargin: 10 * MINUTE,
  /** A token without a lifetime is kept 12 hours. */
  tokenDefaultLifetime: 12 * HOUR,
  /** Refused e-mail/password: one new try after 6 h, then every 24 h. */
  refusedRetry: [6 * HOUR, 24 * HOUR],
  /** The session taken again by another sign-in within 24 h: 6 h, then every 24 h. */
  takenRetry: [6 * HOUR, 24 * HOUR],
  takenWindow: 24 * HOUR,
  /** 429: Retry-After bounded to 1 minute .. 6 hours, 15 minutes without it. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 15 * MINUTE,
  /** Longest a persisted pause or stop may still hold at a restart. */
  persistedMax: 24 * HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: 1_000,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button signs in at most this often. */
  testCooldown: 30_000,
  /** The "Refresh" button of a vehicle wakes it at most this often. */
  refreshCooldown: 10 * MINUTE,
  /** One read of the vehicle after a command, to show its effect. */
  refreshAfterCommand: 90_000,
};
