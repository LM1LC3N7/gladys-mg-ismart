# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to the SAIC iSMART cloud (Europe) with the e-mail and the password
  of the MG iSMART app, as saic-ismart-client-ng; the token kept in `/data`,
  no sign-in per read. A token refused by the gateway signs in again at most
  once per 24 h (SAIC keeps one session per account), then stops with spaced
  new tries.
- One device per car: battery, range, charge status, charging, plugged in,
  charging power (kW), odometer, locks (read only), four doors and boot,
  latitude and longitude (no history), cabin temperature, climate state, last
  report of the car, last command.
- Buttons: refresh now (at most every 10 minutes), lock, unlock, open the
  boot, start and stop the climate, start and stop charging; each command
  behind its own option, all off by default. A command reads the car again,
  decides on that state only, is sent once, and shows its outcome in "Last
  command".
- Reads every 3 hours by default (60 minutes to 24 hours), every 30 minutes
  while charging; a car that does not answer is read twice as late each time
  (up to once a day); the next read of each car kept in `/data`, so a restart
  never wakes the car early.
- Resilience: a refused password stops with one new try after 6 h, then every
  24 h; 429 pauses every path (1 minute to 6 hours), kept in `/data`; network
  and 5xx errors wait the interval.
- "Test the connection" button (the vehicle list only, never wakes a car);
  documentation in English and French; `LICENSE` and
  `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-mg-ismart/commits/main
