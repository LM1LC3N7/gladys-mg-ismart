# TODO — MG iSMART v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core** (2026-10-18): port of saic-ismart-client-ng
      0.10.0 (encoding checked against its test vectors), sign-in, token in
      `/data`, event-id polling; vehicle list, status and charging reads;
      one device per car (battery, range, charge status, charging, plugged,
      charging power, odometer, locks, doors, boot, position, cabin
      temperature, climate, last report, last command); buttons (refresh,
      lock, unlock, boot, climate, charge) behind off-by-default options,
      fresh read before acting, one at a time, never re-sent; spaced reads
      to spare the 12 V battery; stops and pauses persisted and capped;
      badges; test button; en/fr; docs; cover. Tested against a fake
      gateway only.
- [x] **Review fixes** (2026-10-18): "refused by MG" only before the gateway
      took a command (B1); the sign-in budget after a refused token
      persisted (I1); a wake-up budget for clicks (I2); the short charging
      cadence only with power flowing, 12 h at most (I3); stale states
      refused (I4); command answers examined (I5); M1–M16 (see Decisions).
- [ ] **Milestone 2 — real account**: run against a real account and car,
      compare with the app (see "To check"); turn the answers (anonymized)
      into fixtures.
- [ ] **Milestone 3 — more**: the alarm messages (`message/list`, does not
      wake the car: a read when the car reports a start or a stop, as the
      MQTT gateway does), target temperature for the climate, charge target
      (`vehicle/charging/setting`), heated seats, windows, find my car,
      12 V battery voltage (`batteryVoltage`), the phone-number sign-in, the
      other regions (Australia, China).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real account

- The sign-in answer of a wrong password: which `code` (assumed non-zero
  with HTTP 200, read as "refused"); the `expires_in` of the token.
- That a token refused because of the app (`code` 401/403, or HTTP 401) is
  told apart from a token that just expired (both sign in again once per
  24 h); whether a 403 without the JSON envelope ever comes (read as a
  passing WAF/CDN error).
- `statusTime`: in seconds, the time the car made its report (not the time
  the gateway answered); a command refuses a report older than 10 minutes.
  Does a car woken by the read always send a fresh one? Is it ever absent
  (then "already done" is never concluded and the command is sent)?
- `failureType` of a command answer (any non-zero value is shown as a
  failure reported by the car) and whether the `basicVehicleStatus` it
  carries is the state after the command (used to say "confirmed").
- `bmsChrgSts` 11 ("super off-board charging") read as charging.
- The event-id polling: how many "wait" answers a parked car gives before its
  status, whether 30 s is enough after a long sleep (the reference uses 30 s).
- The scales: `mileage` and `fuelRangeElec` in 0.1 km, `bmsPackSOCDsp` in
  0.1 %, `extendedData1` as the state of charge (fallback only), the sign of
  `bmsPackCrnt × 0.05 − 1000` while charging (the absolute value is used),
  `interiorTemperature` in °C, `statusTime` in seconds.
- `chargingGunState` as the plug state (the reference test answer has
  `ccuOnbdChrgrPlugOn: 4`, so those two are not used).
- `remoteClimateStatus` values beyond 0, 1, 2, 5 (any other non-zero value is
  shown as "on").
- Whether the answer of a command really holds `basicVehicleStatus` (used to
  show the lock and climate at once).
- How often a real car tolerates a read without draining its 12 V battery
  (the default is 3 h; see Decisions).

## Decisions

- **Not a duplicate** (checked for lot 7, 2026-10-18): no MG or SAIC
  service in the Gladys core, none in the store, the repository was reserved
  in post 262 of the forum thread 10385.
- **Reference reused: saic-ismart-client-ng 0.10.0** (MIT, maintained, the
  one of the SAIC MQTT gateway and Home Assistant integrations), ported to
  JavaScript (no Python in the container), credited in the README and
  `THIRD_PARTY_NOTICES.md`. Only runtime dependency: the SDK; the encoding
  uses `node:crypto` only.
- **Spare the 12 V battery** (prudent choice): each status or charging read
  wakes the car through the TBox. Default interval 3 h (60–1440 min,
  configurable), 30 min only while the last read said charging with power
  flowing (`charging`, `plugged` not false, power > 0) and for 12 h at most
  (`chargingSince` in `/data`), then the normal interval (review I3). The
  next read is reserved in `/data` (now + interval) BEFORE each read, so a
  crash during it does not wake the car again at the restart (M1). The SAIC
  MQTT gateway reads a parked car far less
  (once a day by default, more on events); Home Assistant integrations read
  more often. A car that does not answer within 30 s is read again after the
  interval, then twice later each time (3 h, 6 h, 12 h, 24 h max): **never
  woken in a loop**. An error never comes back sooner than the interval;
  every timer has a 30 s floor. The next read of each car is in `/data`, so a
  container restarting in a loop does not wake the car. The vehicle list
  (no wake-up) is read at start and every 24 h; an empty or malformed list
  keeps the cars known and is read again after the interval (M10). The
  "Test the connection" button never wakes a car.
- **Wake-up budget for clicks** (review I2): every press wakes the car (the
  refresh reads it, each command reads it before acting). Per car, shared by
  the refresh and the commands: 2 minutes apart at least, 6 per hour at
  most; beyond, the press is refused at once with a clear message. While a
  silent car is left asleep (its `asleep` spacing), one click per hour is
  still accepted (refresh or command, counted in the budget), the others are
  refused until its next read; a command read that gets no answer applies the same
  spacing as the polling. The budget is in memory (a restart resets it; the
  reads reserved in `/data` still hold).
- **One session per account** (SAIC): a sign-in signs the MG app out. The
  docs and the configuration advise a second account the car is shared
  with. **One automatic sign-in per 24 h** (review I1): a token refused by
  the gateway signs in again only if the last automatic sign-in is 24 h old;
  the new try of a `session_taken` stop and the test button count as one.
  Refused again: a `session_taken` stop, new try at max(6 h then 24 h by the
  stops in a row, 24 h after the last automatic sign-in). The stops in a row
  (`streak`), the last refusal and the last sign-in are in `/data`; the streak
  goes back to 0 only after 24 h without a refused token. With the app taking
  the session 1 h after each sign-in, that is 4 sign-ins in 72 h (tested).
  Never a dead integration; new credentials lift the stop at once. The token
  is kept in `/data` (0600, with a hash of the e-mail), so a restart does not
  sign in; it is renewed at min(10 min, half its lifetime) before it expires
  (M9), which signs the app out too when it uses the same account (docs).
- **Refused token** (M8): only a JSON `code` 401/403 or an HTTP 401. An HTTP
  403 without the JSON envelope (WAF, CDN) is a passing error (`http`).
- **No code is ever sent**: the SAIC sign-in is e-mail and password only;
  nothing in the integration asks for an SMS or an e-mail code.
- **Refused credentials** (any non-zero `code`, or HTTP 401, on
  `oauth/token`): stop, new try after 6 h then every 24 h; at once on a
  configuration change or the test button.
- **Commands are buttons** (`button/push`, value 1 only: `0`, `''`, `null`,
  `true` are refused), never a switch nor a `binary` command: a "turn
  everything off", Google Home, Alexa, HomeKit and `switch.*` scene actions
  never reach them. The lock is a read-only `lock/state`, the climate
  a read-only `unknown/binary` plus a text, never the core's `climate-on`
  command type. Each command has its own option, **all off by default**;
  unlock and boot have separate options, both described as "better left off".
- **A command answers Gladys at once** (Gladys acks in 5 s; the gateway
  takes 10–30 s to wake the car): the button is accepted after the checks
  that need no request (role, value, option, connection, pause, one at a
  time per car, wake-up budget). The ack never waits for the flush to Gladys
  (M3). The command then runs in the SAIC queue: a fresh `vehicle/status`
  (and `charging/mgmtData` for charging), the option and the connection
  checked again, a report older than 10 min refused as "stale state (report
  of HH:MM)" (I4), a decision on that fresh state only (never on memory; a
  missing value refuses; "already done" never concluded on an undated state:
  the idempotent command is sent instead; the climate is "already on" only
  for `remoteClimateStatus` 2 and "already off" only for 0, M7), the option
  checked once more by a guard right before the first POST (M5), sent once,
  polled with its event id (the protocol; every 3 s for the charging control,
  M13), never re-sent after a failure.
- **Command outcomes** (review B1, I5, M4): a flag `accepted` is set when the
  first answer gives an event id or the data (without a refusal code).
  Accepted, any later error (a 401 or the code 7 while polling, a timeout)
  is "sent, not confirmed" — never "refused by MG". Not accepted: a `code`
  or a refused token is "refused by MG"; a 429, a refused sign-in, no
  credentials, a cancelled guard or a request that never left is "not sent";
  anything else "sent, not confirmed". Answered: a non-zero integer
  `failureType` is "sent, the car reported a failure (N)"; lock, unlock and
  climate say "confirmed" only when the `basicVehicleStatus` sent back
  matches (locked 1 / 0, climate 2 / 0), else "sent, state not confirmed".
  One read of the car 90 s later shows the effect. Every "not sent" path
  saves `/data` (M12). A command in progress is in `/data`; a restart writes
  "last command interrupted: check the state" (M2).
- **A hold (429, a stop) on the charging read** keeps the status just read
  and its next read, then holds every path (M11).
- **`bmsChrgSts` 11** counts as charging: binary 1, short cadence, "Start
  charging" refused as "already" (M6).
- **One SAIC queue**: polling, buttons and the test button never overlap at
  the gateway (one session, slow answers). The test button answers "busy"
  when the queue is not empty.
- **Ids**: `ext:<selector>:vehicle:<16 hex of SHA-256 of the VIN>`:
  pseudonymised, not anonymous (anyone who knows the VIN can compute it,
  M14); the VIN itself is not written to Gladys, `/data` nor the logs.
  Feature roles are frozen; every
  car gets the full list (so a device published again never loses a feature).
- **Units and categories** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`): % and
  km on `electrical-vehicle-battery`, kW on `electrical-vehicle-charge` (the
  category has no W), km on `electrical-vehicle-state`, °C on
  `electrical-vehicle-climate`; `battery/charging`, `electrical-vehicle-charge/plugged`,
  `electrical-vehicle-state/door-opened` (1 open) binaries; `lock/state`
  (0 unlocked, 1 locked).
- **Position**: `unknown/unknown` latitude and longitude, `keep_history:
false`, never in the logs nor in `/data`.
- **Energy**: no index at all (the gateway has no reliable cumulative
  meter); the charging power is `charge-power` in kW, 0 when not charging.
- **A failed charging read never hides the status** (secondary read).
- **Status and Discovery at each `connected`**: the deduplication caches
  (last status, Discovery list, badges) are cleared and sent again; the
  token, pauses and stops stay.
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag: the one-time exception to "versions
  belong to the Release workflow" (the template's 1.0.0 had to be replaced);
  the first patch release gives 0.1.1.
- **LICENSE**: the standard Apache-2.0 text (appendix placeholder, no
  personal name); `THIRD_PARTY_NOTICES.md` holds the full MIT notice of
  saic-ismart-client-ng; both copied into the image.
- **Public app constants** in `src/constants.js` (the OAuth client
  `sword:sword_secret`, the tenant, the gateway), as in the reference: they
  identify the app, not the user.
