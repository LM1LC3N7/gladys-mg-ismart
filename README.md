# gladys-mg-ismart

[Gladys Assistant](https://gladysassistant.com) external integration for
**MG** cars (MG4, ZS EV, MG5, Marvel R…) through the **SAIC iSMART** cloud
(Europe): battery, range, charge status and power, odometer, locks, doors
and boot, position, cabin temperature and climate; lock, unlock, boot,
climate and charge buttons, each behind an off-by-default option. **Unofficial
API, never tested with a real account nor a real car. Not affiliated with MG
or SAIC.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> SAIC keeps **one session per account**: signing in here signs the MG app
> out. Use a second account the car is shared with.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (MgApp)
                                  ├─ src/client.js     sign-in, token, event-id polling, reads, commands
                                  ├─ src/crypto.js     the gateway's body encoding and verification string
                                  ├─ src/saic.js       the only HTTP access, errors (codes only)
                                  ├─ src/model.js      answers -> values, ranges checked (pure)
                                  ├─ src/devices.js    the devices and their states (pure)
                                  ├─ src/publisher.js  states within 300/min
                                  └─ src/store.js      /data/mg-ismart-state.json
```

- **Sign-in** (as saic-ismart-client-ng): `oauth/token` with the e-mail and
  the SHA-1 of the password; the token goes in `blade-auth` and is kept until
  10 minutes before it expires (in `/data`, with a hash of the e-mail), so a
  restart does not sign in. A token refused by the gateway signs in again at
  most once per 24 h; refused again, the integration stops (6 h, then 24 h)
  instead of fighting the MG app.
- **Encoding**: every body is AES-128-CBC encoded with MD5-derived keys and
  every request signed with an HMAC-SHA256 "verification string", as the app
  does (checked against the reference's test vectors).
- **Reads**: `vehicle/list` at start then every 24 h (no wake-up);
  `vehicle/status` then `vehicle/charging/mgmtData` per car (each wakes the
  car: event-id polling every 3 s, 30 s at most) every 3 h by default
  (60–1440 min), every 30 min while charging; a silent car is read twice as
  late each time (up to 24 h). The next read of each car is kept in `/data`.
- **Commands**: `BUTTON/PUSH` features only, never a switch nor a binary
  command; each behind its own option (`allow_lock`, `allow_unlock`,
  `allow_tailgate`, `allow_climate`, `allow_charging`), all off by default.
  Gladys is answered at once; the command then reads the car again, decides
  on that fresh state only, is sent once (polled with its event id, never
  re-sent), and its outcome goes to the "Last command" text feature. One at a
  time per car; every SAIC call goes through one queue.
- **Errors**: refused credentials stop with one new try after 6 h, then every
  24 h; 429 pauses every path (1 min – 6 h, kept in `/data`); network and 5xx
  wait the interval. Logs carry error codes only: never the password, the
  token, the VIN nor the position.
- **Energy**: no cumulative index exists in the gateway: no `index`, no
  `publishEnergyConsumption`. The charging power is a plain sensor.

## Credits

Ported from [saic-ismart-client-ng](https://github.com/SAIC-iSmart-API/saic-python-client-ng)
0.10.0 (SAIC-iSmart-API, MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Modelled on the sibling integrations
[gladys-ohme](https://github.com/LM1LC3N7/gladys-ohme) (cloud sign-in, charging)
and [gladys-tibber](https://github.com/LM1LC3N7/gladys-tibber) (energy).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the gateway is a fake behind the injected
transport (it decodes the requests, checks the verification string and asks
to wait with event ids like the real one), Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the
Docker image).
