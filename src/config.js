// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { TIMINGS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  interval_minutes: TIMINGS.intervalDefault,
  allow_lock: false,
  allow_unlock: false,
  allow_tailgate: false,
  allow_climate: false,
  allow_charging: false,
  timezone: 'Europe/Paris',
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A short hash of the e-mail: the account a session belongs to, without the e-mail itself. */
export const accountKey = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

/** A boolean field: only `true` (or the strings Gladys may send) turns it on. */
const flag = (value) => value === true || value === 'true' || value === 1 || value === '1';

export function validTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone === '' || timezone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The interval in minutes, bounded to 60..1440 (each read wakes the car). */
export function intervalOf(value) {
  const minutes = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(minutes)) {
    return TIMINGS.intervalDefault;
  }
  return Math.min(TIMINGS.intervalMax, Math.max(TIMINGS.intervalMin, Math.round(minutes)));
}

export function normalizeConfig(raw = {}) {
  const email = String(raw?.email ?? '').trim();
  const password = String(raw?.password ?? '');
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const timezone = String(raw?.timezone ?? '').trim();
  return {
    email,
    password,
    /** The hash of the e-mail: the session and the stops in /data belong to it. */
    account: email === '' ? '' : accountKey(email),
    intervalMinutes: intervalOf(raw?.interval_minutes),
    allowLock: flag(raw?.allow_lock),
    allowUnlock: flag(raw?.allow_unlock),
    allowTailgate: flag(raw?.allow_tailgate),
    allowClimate: flag(raw?.allow_climate),
    allowCharging: flag(raw?.allow_charging),
    timezone: validTimezone(timezone) ? timezone : DEFAULTS.timezone,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
