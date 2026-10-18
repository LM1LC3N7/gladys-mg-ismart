// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the e-mail, the password, a VIN nor a position:
//   - the SAIC token and its expiry, with the account it belongs to (a hash of
//     the e-mail), so a restart does not sign in again (a sign-in signs the
//     MG app out);
//   - the budget of the sign-ins after a refused token (last automatic
//     sign-in, last refusal, session_taken stops in a row);
//   - the command in progress of each car (a restart says it was interrupted);
//   - the end of a 429 pause (kept across restarts and account changes);
//   - a stop after a refusal and its next try (per account);
//   - the next read of each car (by the hash of its VIN), so a container that
//     restarts in a loop never wakes the car in a loop.
// Every time read back is bounded: nothing holds more than 24 h after a
// restart. The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { LIMITS, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/mg-ismart-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const handle = await open(temporary, 'w', 0o600);
        try {
          await handle.writeFile(text, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

const time = (value) => (Number.isFinite(value) ? value : undefined);
const string = (value, max) =>
  typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;

/** A time read back from /data: in the future, at most 24 h away, else undefined. */
export const bounded = (value, now) => {
  const t = time(value);
  return t !== undefined && t > now ? Math.min(t, now + TIMINGS.persistedMax) : undefined;
};

const STOPS = new Set(['refused', 'session_taken']);

/** The persisted state, repaired and bounded. */
export function normalizeMemory(raw, now) {
  const s = raw?.session;
  const session =
    string(s?.account, 64) && string(s?.token, 8192) && time(s?.expiresAt) > now
      ? {
          account: s.account,
          token: s.token,
          expiresAt: s.expiresAt,
          ...(time(s.issuedAt) !== undefined && s.issuedAt <= now ? { issuedAt: s.issuedAt } : {}),
        }
      : null;
  const past = (value) => (time(value) !== undefined && value <= now ? value : 0);
  const t = raw?.taken;
  const taken = string(t?.account, 64)
    ? {
        account: t.account,
        at: past(t.at),
        refusedAt: past(t.refusedAt),
        streak: Number.isInteger(t.streak) ? Math.min(Math.max(t.streak, 0), 10) : 0,
      }
    : null;
  const pending = {};
  for (const [id, role] of Object.entries(raw?.pending ?? {}).slice(0, LIMITS.vehicles)) {
    if (/^[0-9a-f]{16}$/.test(id) && typeof role === 'string' && /^[a-z-]{1,32}$/.test(role)) {
      pending[id] = role;
    }
  }
  const b = raw?.block;
  const retryAt = bounded(b?.retryAt, now);
  const block =
    string(b?.account, 64) && STOPS.has(b?.kind) && retryAt !== undefined
      ? {
          account: b.account,
          kind: b.kind,
          retryAt,
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          code: Number.isInteger(b.code) ? b.code : undefined,
        }
      : null;
  const pause = raw?.pause;
  const until = bounded(pause?.until, now);
  const reads = {};
  for (const [id, entry] of Object.entries(raw?.reads ?? {}).slice(0, LIMITS.vehicles)) {
    const next = bounded(entry?.next, now);
    if (/^[0-9a-f]{16}$/.test(id) && next !== undefined) {
      reads[id] = {
        next,
        asleep: Number.isInteger(entry.asleep) ? Math.min(Math.max(entry.asleep, 0), 10) : 0,
        ...(past(entry.chargingSince) ? { chargingSince: entry.chargingSince } : {}),
      };
    }
  }
  return {
    session,
    taken,
    pause: until !== undefined && pause.kind === 'rate' ? { kind: 'rate', until } : null,
    block,
    reads,
    pending,
  };
}
