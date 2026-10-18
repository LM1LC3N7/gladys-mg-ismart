# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## saic-ismart-client-ng

<https://github.com/SAIC-iSmart-API/saic-python-client-ng> (package
`saic_ismart_client_ng`), by the SAIC-iSmart-API project. MIT License
(`LICENSE` of the repository, version 0.10.0). Its notice:

```
MIT License

Copyright (c) 2024 The SAIC-iSmart-API project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported in `src/constants.js`, `src/crypto.js`, `src/client.js` and
`src/model.js`:

- `model.py` (SaicApiConfiguration): the European gateway, the tenant id, the
  region;
- `net/crypto.py`, `crypto_utils.py`, `net/utils.py`: the AES-128-CBC
  encoding of the request and answer bodies, its MD5-derived key and IV, the
  HMAC-SHA256 verification string and the app headers (checked against the
  test vectors of `tests/security_test.py`);
- `api/base.py`: the sign-in (`oauth/token`, the app's OAuth client, the
  SHA-1 of the password, the simulator device id), the `blade-auth` token,
  the answer envelope (`code`, `data`, codes 2/3/7, 401/403) and the event-id
  polling of the slow calls (every 3 s for a read and for the charging
  control, 1 s for the other commands, 30 s at most);
- `api/vehicle`, `api/vehicle/locks`, `api/vehicle/climate`,
  `api/vehicle_charging`: `vehicle/list`, `vehicle/status`
  (`vehStatusReqType` 2), `vehicle/charging/mgmtData`, `vehicle/control`
  (lock, unlock the doors, open the tailgate, start and stop the climate) and
  `vehicle/charging/control` (start and stop charging), the VIN sent as its
  SHA-256, the rvcParams of each command;
- `api/vehicle/schema.py`, `api/vehicle_charging/schema.py`, `api/schema.py`:
  the fields read and their scales (mileage and range in 0.1 km, state of
  charge in 0.1 %, position in micro-degrees, pack current and voltage), the
  charging codes (`BmsChargingStatusCode`, `is_bms_charging`).

Changed: a token refused by the gateway signs in again at most once per
24 hours (SAIC keeps one session per account, so each sign-in signs the MG
app out), then stops with spaced new tries; a command is never retried after
a failure and is only sent after a fresh read of the car; a car that does not
answer is read again less and less often (up to once a day); a 429 and the
stops are kept in `/data`; values out of range are dropped.
