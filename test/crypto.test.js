// -----------------------------------------------------------------------------
// The gateway encoding, against the test vectors of saic-ismart-client-ng
// (tests/security_test.py), and the request bodies of the commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargingBody, climateBody, lockBody } from '../src/client.js';
import {
  decryptAes,
  decryptRequest,
  decryptResponse,
  encryptAes,
  encryptRequest,
  encryptResponse,
  formEncode,
  md5Hex,
  normalizeContentType,
  verificationString,
} from '../src/crypto.js';

const VECTOR = {
  path: '/api/v1/data',
  ts: '20230514123000',
  tenantId: '1234',
  contentType: 'application/json',
  content: '{"key": "value"}',
  token: 'dummy_token',
};

test('the verification string matches the vectors of the reference', () => {
  assert.equal(
    verificationString(VECTOR),
    'afd4eaf98af2d964f8ea840fc144ee7bae95dbeeeb251d5e3a01371442f92eeb',
  );
  assert.equal(
    verificationString({ ...VECTOR, path: '' }),
    'ff8cb13ebcce5958e7fbfe602716c653fd72ce78842be87b6d50dccede198735',
  );
  assert.equal(
    verificationString({ ...VECTOR, content: '' }),
    '332c85836aa9afc864282436a740eb2cc778fafd1fea74dd887c1f8de5056de0',
  );
});

test('AES-128-CBC round trip, hex, PKCS#7; a bad body throws', () => {
  const key = md5Hex('key');
  const iv = md5Hex('iv');
  const hex = encryptAes('{"a":"é"}', key, iv);
  assert.match(hex, /^[0-9a-f]{32}$/);
  assert.equal(decryptAes(hex, key, iv), '{"a":"é"}');
  assert.throws(() => decryptAes('zz', key, iv));
  assert.throws(() => decryptAes(hex, md5Hex('other'), iv));
});

test('a request is encoded as the reference does, and decodes back', () => {
  const ts = '1760781600000';
  const { body, headers } = encryptRequest({
    path: '/with/path?vin=zevin',
    body: '{"change":"me"}',
    contentType: 'application/json',
    ts,
    tenantId: '2559',
    region: 'EU',
  });
  assert.equal(headers.REGION, 'EU');
  assert.equal(headers['tenant-id'], '2559');
  assert.equal(headers['User-Type'], 'app');
  assert.equal(headers['APP-SEND-DATE'], ts);
  assert.equal(headers['APP-CONTENT-ENCRYPTED'], '1');
  assert.equal(headers['Content-Type'], 'application/json;charset=utf-8');
  assert.equal(headers['ORIGINAL-CONTENT-TYPE'], 'application/json');
  assert.equal(headers['blade-auth'], undefined, 'no token, no blade-auth');
  assert.equal(
    headers['APP-VERIFICATION-STRING'],
    verificationString({
      path: '/with/path?vin=zevin',
      ts,
      tenantId: '2559',
      contentType: 'application/json',
      content: '{"change":"me"}',
    }),
  );
  assert.deepEqual(
    JSON.parse(
      decryptRequest(body, {
        path: '/with/path?vin=zevin',
        ts,
        tenantId: '2559',
        contentType: 'application/json',
      }),
    ),
    { change: 'me' },
  );
  const get = encryptRequest({ path: '/a', ts, tenantId: '1', region: 'eu', token: 't' });
  assert.equal(get.body, '');
  assert.equal(get.headers['blade-auth'], 't');
  assert.equal(get.headers['ORIGINAL-CONTENT-TYPE'], 'application/json');
});

test('answers decode with the date and type headers; plain ones pass as is', () => {
  const ts = '1760781600123';
  const body = encryptResponse('{"code":0}', { ts });
  assert.equal(
    decryptResponse(body, { 'app-send-date': ts, 'original-content-type': 'application/json' }),
    '{"code":0}',
  );
  assert.equal(decryptResponse(' {"code":0} ', {}), '{"code":0}');
});

test('content types and form encoding follow Python', () => {
  assert.equal(normalizeContentType(undefined), 'application/json');
  assert.equal(
    normalizeContentType('application/x-www-form-urlencoded; x'),
    'application/x-www-form-urlencoded',
  );
  assert.equal(normalizeContentType('multipart/form-data; b=1'), 'multipart/form-data');
  assert.equal(
    formEncode({ deviceId: 'simulator**1###com.app', name: "a b!'()~._-" }),
    'deviceId=simulator%2A%2A1%23%23%23com.app&name=a+b%21%27%28%29~._-',
  );
});

test('command bodies are those of the reference', () => {
  assert.deepEqual(lockBody({ lock: true }), { rvcParams: null, rvcReqType: '1' });
  const unlock = lockBody({ lock: false, lockId: 3 });
  assert.equal(unlock.rvcReqType, '2');
  assert.deepEqual(
    unlock.rvcParams.map((p) => [p.paramId, p.paramValue]),
    [
      [4, 'AA=='],
      [5, 'AA=='],
      [6, 'AA=='],
      [7, 'Aw=='],
      [255, 'AAAAAA=='],
    ],
  );
  assert.equal(lockBody({ lock: false, lockId: 2 }).rvcParams[3].paramValue, 'Ag==');
  assert.deepEqual(
    climateBody({ start: true }).rvcParams.map((p) => [p.paramId, p.paramValue]),
    [
      [19, 'Ag=='],
      [20, 'CA=='],
      [255, 'AAAAAA=='],
    ],
  );
  assert.deepEqual(
    climateBody({ start: false }).rvcParams.map((p) => [p.paramId, p.paramValue]),
    [
      [19, 'AA=='],
      [22, 'AA=='],
      [255, 'AAAAAA=='],
    ],
  );
  assert.equal(climateBody({ start: true }).rvcReqType, '6');
  assert.deepEqual(chargingBody({ start: true }), {
    chrgCtrlReq: 1,
    tboxEleccLckCtrlReq: 0,
    tboxV2XReq: 0,
  });
  assert.equal(chargingBody({ start: false }).chrgCtrlReq, 2);
});
