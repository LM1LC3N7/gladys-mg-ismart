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
- Buttons: refresh now, lock, unlock, open the boot, start and stop the
  climate, start and stop charging; each command behind its own option, all
  off by default. A command reads the car again, decides on that state only,
  is sent once, and shows its outcome in "Last command".
- Reads every 3 hours by default (60 minutes to 24 hours), every 30 minutes
  while charging; a car that does not answer is read twice as late each time
  (up to once a day); the next read of each car kept in `/data`, so a restart
  never wakes the car early.

### Changed

- Review of milestone 1. "Refused by MG" is only said when the gateway did
  not take the command; after it took it, any later error reads "sent, not
  confirmed". A 429 or a refused sign-in before it reads "not sent".
- The answer of a command is examined: a failure reported by the car, or a
  lock/climate state that does not match, is said so instead of "confirmed".
- One automatic sign-in per 24 h after a refused token, the new tries of a
  stop and the test button included; the stops in a row are kept in `/data`.
- A wake-up budget per car for the buttons (refresh and commands): 2 minutes
  apart, 6 per hour at most, none while a silent car is left asleep.
- The 30-minute cadence only while power flows into the car, and for 12 hours
  at most.
- A command refuses a report of the car older than 10 minutes, and never
  concludes "already done" on an undated state.
- The next read is reserved in `/data` before each read; a command running
  at a restart is reported as interrupted; the token is renewed at half its
  lifetime when that is shorter than 10 minutes; a 403 page without the JSON
  envelope is a passing error; an empty vehicle list keeps the cars known;
  charging status 11 counts as charging; the climate counts as on only for
  status 2; the car ids are documented as pseudonymised.
- Resilience: a refused password stops with one new try after 6 h, then every
  24 h; 429 pauses every path (1 minute to 6 hours), kept in `/data`; network
  and 5xx errors wait the interval.
- "Test the connection" button (the vehicle list only, never wakes a car);
  documentation in English and French; `LICENSE` and
  `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-mg-ismart/commits/main
