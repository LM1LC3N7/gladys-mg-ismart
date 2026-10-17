// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, BUTTONS, TIMINGS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, and the version set by hand to 0.1.0 everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-mg-ismart:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.match(manifest.gladys_version, /^>=4\.86\.0$/, 'categories need 4.86');
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not[\s>]+affiliated[\s>]+with[\s>]+MG|sans[\s>]+lien[\s>]+avec[\s>]+MG/i);
    assert.match(
      docs,
      /never[\s>]+tested[\s>]+with[\s>]+a[\s>]+real|jamais[\s>]+testée?[\s>]+avec[\s>]+un[\s>]+vrai/i,
    );
    assert.match(docs, /unofficial|non[\s>]+officielle/i);
    assert.match(docs, /second(ary)? account|compte secondaire/i, 'the one-session warning');
    assert.match(docs, /12 V/, 'the 12 V battery warning');
    assert.doesNotMatch(docs, /chiffr|encrypt/i, 'a secret field is not encrypted by Gladys');
  }
  assert.doesNotMatch(JSON.stringify(manifest), /chiffr|encrypt/i);
});

test('the licenses ship in the image, without any personal name', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'no name of a person');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Copyright \(c\) 2024 The SAIC-iSmart-API project/);
  assert.match(notices, /version 0\.10\.0/);
  assert.ok(existsSync(new URL('../cover.png', import.meta.url)));
});

test('the cover is a PNG of 800×534', () => {
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code; every command off by default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  const options = new Set(Object.values(BUTTONS).filter(Boolean));
  assert.equal(options.size, 5);
  for (const key of [
    'allow_lock',
    'allow_unlock',
    'allow_tailgate',
    'allow_climate',
    'allow_charging',
  ]) {
    assert.equal(fields[key].type, 'boolean');
    assert.equal(fields[key].default, false, `${key} must be off by default`);
  }
  assert.equal(fields.interval_minutes.min, TIMINGS.intervalMin);
  assert.equal(fields.interval_minutes.max, TIMINGS.intervalMax);
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret', 'the password is never sent back to the browser');
  assert.ok(fields.email.required && fields.password.required);
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /one session|une session/);
  }
  assert.ok(intro.links.every((l) => l.url.startsWith('https://')));
});

test('the actions are those of the code, within their timeout', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});
