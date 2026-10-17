// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the SAIC gateway, and the errors
// they end with. The answer read is bounded (compressed and decompressed).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed call. `kind`:
 * - `no_credentials`: no e-mail or password (never sent);
 * - `refused`: the sign-in was refused (e-mail or password);
 * - `logged_out`: the gateway refused the token (401/403, or code 401/403):
 *   another sign-in took the session (SAIC keeps one session per account), or
 *   the token ended early;
 * - `session_taken`: refused again within 24 h of the last time: a stop;
 * - `rate_limited`: 429, `retryAfter` in ms;
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer; `notSent` tells the request never left;
 * - `no_answer`: the gateway kept answering "wait" (an event id without data)
 *   for 30 s: the car did not answer;
 * - `api`: a non-zero `code` in the answer (`code` holds it);
 * - `bad_response`, `size`: an answer that is not the expected JSON;
 * - `http`: any other status.
 * The message never holds a secret, a VIN, a position nor any free text of
 * the answer: only numbers (status, code).
 */
export class SaicError extends Error {
  constructor(kind, message, { status, retryAfter, code, notSent } = {}) {
    super(message);
    this.name = 'SaicError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
    this.notSent = Boolean(notSent);
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> SaicError (never the request: the sign-in carries the password). */
export function networkError(err, notSent = false) {
  if (err instanceof SaicError) {
    return err;
  }
  const code = typeof err?.code === 'string' && /^[A-Z_]{1,32}$/.test(err.code) ? err.code : '';
  return new SaicError('network', NETWORK_REASONS[code] ?? (code || 'network error'), {
    notSent,
  });
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof SaicError) {
    const details = [
      Number.isInteger(err.code) ? `code ${err.code}` : undefined,
      err.status ? `HTTP ${err.status}` : undefined,
    ].filter(Boolean);
    return details.length > 0 ? `${err.message} (${details.join(', ')})` : err.message;
  }
  return 'internal error';
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status. The
 * promise settles once; the body read is bounded, a gzip body is inflated
 * within the same bound. `onSent` is called once the request has fully left.
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
    onSent,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    let sent = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new SaicError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let raw = Buffer.concat(chunks);
        if (String(res.headers['content-encoding'] ?? '').toLowerCase() === 'gzip') {
          try {
            raw = gunzipSync(raw, { maxOutputLength: maxBytes });
          } catch {
            settle(
              reject,
              new SaicError('bad_response', 'a compressed answer that does not inflate'),
            );
            return;
          }
        }
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: raw.toString('utf8'),
        });
      });
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    req.on('finish', () => {
      sent = true;
      onSent?.();
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new SaicError('timeout', `no answer within ${Math.round(timeout / 1000)} s`, {
          notSent: !sent,
        }),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err, !sent)));
    req.end(body);
  });
}
