// -----------------------------------------------------------------------------
// The request and answer encoding of the SAIC gateway, ported from
// saic-ismart-client-ng 0.10.0 (MIT): `net/crypto.py` and `crypto_utils.py`.
//
// Every body is sent AES-128-CBC encoded (PKCS#7 padding, hex), with a key
// and an IV made of MD5 digests of the path, the tenant, the user token and
// the timestamp, and every request carries an HMAC-SHA256 "verification
// string". These keys are derived from public values: the encoding is how
// the app talks to its gateway, not a protection of the user's secrets
// (those are protected by HTTPS). Answers come back encoded the same way.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';

export const md5Hex = (text) => createHash('md5').update(text, 'utf8').digest('hex');
export const sha1Hex = (text) => createHash('sha1').update(text, 'utf8').digest('hex');
export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** AES-128-CBC with PKCS#7 padding: utf-8 text -> lower-case hex. */
export function encryptAes(text, keyHex, ivHex) {
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex'),
  );
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex');
}

/** The reverse: hex -> utf-8 text. Throws on a bad padding or a bad hex. */
export function decryptAes(hex, keyHex, ivHex) {
  if (!/^(?:[0-9a-fA-F]{32})+$/.test(hex)) {
    throw new Error('not an encoded body');
  }
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex'),
  );
  return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

/** net/utils.py normalize_content_type. */
export function normalizeContentType(contentType) {
  if (contentType) {
    if (contentType.includes('multipart')) {
      return 'multipart/form-data';
    }
    if (contentType.includes('x-www-form-urlencoded')) {
      return 'application/x-www-form-urlencoded';
    }
  }
  return 'application/json';
}

/** get_app_verification_string of the reference. */
export function verificationString({ path, ts, tenantId, contentType, content, token = '' }) {
  const keyPartOne = md5Hex(`${path}${tenantId}${token}app`);
  const key = md5Hex(`${keyPartOne}${ts}1${contentType}`);
  const iv = md5Hex(ts);
  const encoded = content.length > 0 ? encryptAes(content, key, iv) : '';
  const message = `${path}${tenantId}${token}app${ts}1${contentType}${encoded}`;
  const hmacKey = md5Hex(`${key}${ts}`);
  return createHmac('sha256', Buffer.from(hmacKey, 'utf8')).update(message, 'utf8').digest('hex');
}

/**
 * encrypt_request of the reference: the body to send and the app headers.
 * `path` is the URL without the gateway base, with a leading slash and the
 * query string (as the reference signs it). `ts`: milliseconds, as a string.
 */
export function encryptRequest({ path, body = '', contentType, ts, tenantId, region, token = '' }) {
  let type = contentType || 'application/json';
  let content = '';
  let sent = body;
  if (body && !type.includes('multipart')) {
    type = normalizeContentType(contentType);
    content = body.trim();
    if (content) {
      const key = md5Hex(`${md5Hex(`${path}${tenantId}${token}app`)}${ts}1${type}`);
      sent = encryptAes(content, key, md5Hex(ts));
    }
  }
  const headers = {
    'Content-Type': `${type};charset=utf-8`,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    REGION: region,
    'APP-SEND-DATE': ts,
    'APP-CONTENT-ENCRYPTED': '1',
    'tenant-id': tenantId,
    'User-Type': 'app',
    'APP-LANGUAGE-TYPE': 'en',
  };
  if (token) {
    headers['blade-auth'] = token;
  }
  headers['APP-VERIFICATION-STRING'] = verificationString({
    path,
    ts,
    tenantId,
    contentType: type,
    content,
    token,
  });
  headers['ORIGINAL-CONTENT-TYPE'] = type;
  return { body: sent, headers };
}

/**
 * decrypt_response of the reference: the decoded body of a successful answer
 * (headers in lower case, as Node gives them). An answer without the two
 * headers is returned as is.
 */
export function decryptResponse(body, headers = {}) {
  const content = String(body ?? '').trim();
  const date = headers['app-send-date'];
  const type = headers['original-content-type'];
  if (!content || !date || !type) {
    return content;
  }
  return decryptAes(content, md5Hex(`${date}1${type}`), md5Hex(String(date)));
}

/**
 * The reverse of encryptRequest and of decryptResponse, for the fake gateway
 * of the tests (decrypt_request and encrypt_response of the reference).
 */
export function decryptRequest(body, { path, token = '', ts, tenantId, contentType }) {
  const key = md5Hex(`${md5Hex(`${path}${tenantId}${token}app`)}${ts}1${contentType}`);
  return decryptAes(String(body).trim(), key, md5Hex(ts));
}

export function encryptResponse(text, { ts, contentType = 'application/json' }) {
  return encryptAes(text, md5Hex(`${ts}1${contentType}`), md5Hex(ts));
}

/**
 * Form encoding as Python's urlencode (httpx `data=`): spaces as "+", and
 * every character but letters, digits and `_.-~` escaped.
 */
export function formEncode(fields) {
  const escape = (value) =>
    encodeURIComponent(String(value))
      .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
      .replace(/%20/g, '+');
  return Object.entries(fields)
    .map(([key, value]) => `${escape(key)}=${escape(value)}`)
    .join('&');
}
