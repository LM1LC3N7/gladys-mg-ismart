// -----------------------------------------------------------------------------
// A fake SAIC gateway behind the transport the integration is given. It does
// what the real one is expected to do, after saic-ismart-client-ng: checks the
// verification string, decodes the request body, answers encoded bodies, asks
// to wait with an event id before the car answers, and keeps one session per
// account. Records every request. No network.
// -----------------------------------------------------------------------------

import { SAIC } from '../../src/constants.js';
import {
  decryptRequest,
  encryptResponse,
  sha1Hex,
  sha256Hex,
  verificationString,
} from '../../src/crypto.js';
import { SaicError } from '../../src/saic.js';
import {
  EMAIL,
  PASSWORD,
  VIN,
  chargingData,
  vehicleInfo,
  vehicleStatus,
} from '../fixtures/saic.js';

const BASE = new URL(SAIC.baseUri);

export function fakeSaic({ now = () => Date.now() } = {}) {
  const server = {
    email: EMAIL,
    password: PASSWORD,
    vehicles: [vehicleInfo()],
    /** vin -> status answer (`data` of vehicle/status) */
    statuses: { [VIN]: vehicleStatus() },
    /** vin -> charging answer */
    chargings: { [VIN]: chargingData() },
    /** vin -> how many "wait" answers before the data (event-id polling). */
    waits: {},
    /** vins that never answer (always an event id, never data). */
    asleep: new Set(),
    /** The valid token: one session per account. */
    token: undefined,
    issued: 0,
    secrets: [],
    down: false,
    requests: [],
    /** One-shot answers: { match(request), status, json, headers, error, wait } */
    queue: [],
    /** Signs the integration out, as a sign-in from the MG app would. */
    takeSession() {
      this.token = undefined;
    },
    of(path) {
      return this.requests.filter((r) => r.path === path);
    },
    logins() {
      return this.of('oauth/token');
    },
    commands() {
      return this.requests.filter((r) => r.method === 'POST' && r.path !== 'oauth/token');
    },
    /** Status reads that started a wake-up (event id 0). */
    wakes() {
      return this.requests.filter(
        (r) =>
          (r.path === 'vehicle/status' || r.path === 'vehicle/charging/mgmtData') &&
          r.eventId === '0',
      );
    },
  };

  const answer = (status, json, headers = {}) => {
    const ts = String(now());
    const text = json === undefined ? '' : JSON.stringify(json);
    const ok = status >= 200 && status < 300;
    return {
      status,
      headers:
        ok && text
          ? { 'app-send-date': ts, 'original-content-type': 'application/json', ...headers }
          : headers,
      body: ok && text ? encryptResponse(text, { ts }) : text,
    };
  };
  const success = (data) => answer(200, { code: 0, message: 'success', data });
  const wait = (eventId) =>
    answer(200, { code: 0, message: 'waiting for the car' }, { 'event-id': eventId });

  /** event-id polling: `waits[key]` "wait" answers, then the data. */
  const polls = {};
  const eventAnswer = (key, request, data, waits) => {
    if (request.eventId === '0') {
      polls[key] = waits;
    }
    if (polls[key] === Infinity || polls[key] > 0) {
      polls[key] -= 1;
      return wait(`evt-${key}`);
    }
    return success(data);
  };

  server.transport = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const target = new URL(url);
    const path = target.pathname.slice(BASE.pathname.length);
    const signed = `/${path}${target.search}`;
    const token = headers['blade-auth'] ?? '';
    const ts = headers['APP-SEND-DATE'];
    const contentType = headers['ORIGINAL-CONTENT-TYPE'];
    let content = '';
    if (body) {
      content = decryptRequest(body, {
        path: signed,
        token,
        ts,
        tenantId: SAIC.tenantId,
        contentType,
      });
    }
    const request = {
      method,
      path,
      query: Object.fromEntries(target.searchParams),
      headers,
      token,
      eventId: headers['event-id'],
      content,
      form:
        contentType === 'application/x-www-form-urlencoded'
          ? Object.fromEntries(new URLSearchParams(content))
          : undefined,
      json: contentType === 'application/json' && content ? JSON.parse(content) : undefined,
    };
    request.signed =
      verificationString({
        path: signed,
        ts,
        tenantId: SAIC.tenantId,
        contentType,
        content,
        token,
      }) === headers['APP-VERIFICATION-STRING'];
    server.requests.push(request);
    if (server.down) {
      throw new SaicError('network', 'connection refused', { notSent: true });
    }
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [entry] = server.queue.splice(forced, 1);
      if (entry.wait) {
        await entry.wait;
      }
      if (entry.error) {
        throw entry.error;
      }
      if (entry.raw !== undefined) {
        return { status: entry.status ?? 200, headers: entry.headers ?? {}, body: entry.raw };
      }
      return answer(entry.status ?? 200, entry.json, entry.headers);
    }
    if (!request.signed || headers['tenant-id'] !== SAIC.tenantId) {
      return answer(200, { code: 2, message: 'bad signature' });
    }
    if (path === 'oauth/token') {
      const form = request.form ?? {};
      if (
        headers.Authorization !== SAIC.basicAuth ||
        form.username !== server.email ||
        form.password !== sha1Hex(server.password) ||
        form.grant_type !== 'password' ||
        form.loginType !== '2'
      ) {
        return answer(200, { code: 2, message: 'wrong user name or password' });
      }
      server.issued += 1;
      server.token = `token-${server.issued}-secret`;
      server.secrets.push(server.token);
      server.onLogin?.();
      return success({ access_token: server.token, expires_in: 86_400, token_type: 'bearer' });
    }
    if (!token || token !== server.token) {
      return answer(200, { code: 401, message: 'token expired' });
    }
    const vehicle = server.vehicles.find(
      (v) => sha256Hex(v.vin) === (request.query.vin ?? request.json?.vin),
    );
    switch (`${method} ${path}`) {
      case 'GET vehicle/list':
        return success({ vinList: server.vehicles });
      case 'GET vehicle/status': {
        if (!vehicle) {
          return answer(200, { code: 3, message: 'unknown vehicle' });
        }
        const waits = server.asleep.has(vehicle.vin) ? Infinity : (server.waits[vehicle.vin] ?? 1);
        // The car reports "now" (30 s ago), unless the test fixes its time.
        const data = { ...server.statuses[vehicle.vin] };
        if (server.reportAge !== undefined) {
          data.statusTime =
            server.reportAge === null ? undefined : Math.floor((now() - server.reportAge) / 1000);
        } else {
          data.statusTime = Math.floor(now() / 1000) - 30;
        }
        return eventAnswer(`status-${vehicle.vin}`, request, data, waits);
      }
      case 'GET vehicle/charging/mgmtData': {
        if (!vehicle) {
          return answer(200, { code: 3, message: 'unknown vehicle' });
        }
        const waits = server.asleep.has(vehicle.vin) ? Infinity : (server.waits[vehicle.vin] ?? 1);
        return eventAnswer(
          `charging-${vehicle.vin}`,
          request,
          server.chargings[vehicle.vin],
          waits,
        );
      }
      case 'POST vehicle/control': {
        const basic = server.statuses[vehicle.vin].basicVehicleStatus;
        const type = request.json.rvcReqType;
        if (request.eventId === '0') {
          if (type === '1') {
            basic.lockStatus = 1;
          } else if (type === '2') {
            const lockId = Buffer.from(request.json.rvcParams[3].paramValue, 'base64')[0];
            if (lockId === 3) {
              basic.lockStatus = 0;
            } else {
              basic.bootStatus = 1;
            }
          } else if (type === '6') {
            const fan = Buffer.from(request.json.rvcParams[0].paramValue, 'base64')[0];
            basic.remoteClimateStatus = fan > 0 ? 2 : 0;
          }
        }
        return eventAnswer(
          `control-${vehicle.vin}`,
          request,
          {
            basicVehicleStatus: { ...basic, ...server.answerOverride },
            rvcReqType: Buffer.from([Number(type)]).toString('base64'),
            rvcReqSts: 'AQ==',
            failureType: server.failureType ?? 0,
          },
          1,
        );
      }
      case 'POST vehicle/charging/control': {
        const data = server.chargings[vehicle.vin];
        if (request.eventId === '0') {
          const start = request.json.chrgCtrlReq === 1;
          data.chrgMgmtData.bmsChrgSts = start ? 1 : 7;
          data.chrgMgmtData.bmsPackCrnt = start ? 19915 : 20000;
        }
        return eventAnswer(
          `charge-${vehicle.vin}`,
          request,
          { chrgCtrlResp: 1, rvcReqSts: 'AQ==' },
          1,
        );
      }
      default:
        return answer(404, { code: 404, message: 'not found' });
    }
  };

  return server;
}

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
