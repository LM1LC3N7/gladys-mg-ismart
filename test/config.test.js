// -----------------------------------------------------------------------------
// The configuration and the state kept in /data, normalized and bounded.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { normalizeConfig } from '../src/config.js';
import { HOUR, TIMINGS } from '../src/constants.js';
import { httpRequest } from '../src/saic.js';
import { normalizeMemory } from '../src/store.js';

const NOW = Date.UTC(2026, 9, 18, 10);

test('defaults: every command off, 3 h, Paris, French', () => {
  const c = normalizeConfig({ email: ' a@b.c ', password: 'p' });
  assert.equal(c.email, 'a@b.c');
  assert.match(c.account, /^[0-9a-f]{16}$/);
  assert.equal(c.intervalMinutes, 180);
  for (const key of [
    'allowLock',
    'allowUnlock',
    'allowTailgate',
    'allowClimate',
    'allowCharging',
  ]) {
    assert.equal(c[key], false, key);
  }
  assert.equal(c.timezone, 'Europe/Paris');
  assert.equal(c.language, 'fr');
  assert.equal(
    normalizeConfig({ allow_unlock: 'yes' }).allowUnlock,
    false,
    'only true turns it on',
  );
  assert.equal(normalizeConfig({ allow_unlock: 'true' }).allowUnlock, true);
  assert.equal(normalizeConfig({ timezone: 'Mars/Olympus' }).timezone, 'Europe/Paris');
});

test('the interval is bounded to 60..1440 minutes', () => {
  assert.equal(normalizeConfig({ interval_minutes: 5 }).intervalMinutes, 60);
  assert.equal(normalizeConfig({ interval_minutes: '99999' }).intervalMinutes, 1440);
  assert.equal(normalizeConfig({ interval_minutes: 'x' }).intervalMinutes, 180);
  assert.equal(normalizeConfig({ interval_minutes: '' }).intervalMinutes, 180);
});

test('what /data gives back is repaired and bounded to 24 h', () => {
  const m = normalizeMemory(
    {
      session: { account: 'abc', token: 't', expiresAt: NOW + HOUR },
      pause: { kind: 'rate', until: NOW + 100 * HOUR },
      block: { account: 'abc', kind: 'refused', retryAt: NOW + 100 * HOUR, retries: 99 },
      reads: { '0123456789abcdef': { next: NOW + 100 * HOUR, asleep: 50 }, bad: { next: NOW + 1 } },
      taken: { account: 'abc', at: NOW - HOUR },
    },
    NOW,
  );
  assert.equal(m.pause.until, NOW + TIMINGS.persistedMax);
  assert.equal(m.block.retryAt, NOW + TIMINGS.persistedMax);
  assert.equal(m.block.retries, 10);
  assert.deepEqual(Object.keys(m.reads), ['0123456789abcdef']);
  assert.equal(m.reads['0123456789abcdef'].asleep, 10);
  assert.equal(m.taken.at, NOW - HOUR);
  assert.equal(
    normalizeMemory({ session: { account: 'a', token: 't', expiresAt: NOW - 1 } }, NOW).session,
    null,
  );
  assert.deepEqual(normalizeMemory('garbage', NOW), {
    session: null,
    taken: null,
    pause: null,
    block: null,
    reads: {},
  });
});

test('the transport inflates gzip answers and bounds the size', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/gzip') {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(gzipSync('{"code":0}'));
    } else {
      res.writeHead(200);
      res.end('x'.repeat(2048));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const answer = await httpRequest(`${base}/gzip`);
  assert.equal(answer.body, '{"code":0}');
  await assert.rejects(httpRequest(`${base}/big`, { maxBytes: 1024 }), { kind: 'size' });
  await assert.rejects(httpRequest('http://127.0.0.1:1/'), { kind: 'network' });
});
