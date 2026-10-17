# MG iSMART for Gladys

Shows your **MG** cars (MG4, ZS EV, MG5, Marvel R, MG4 XPower…) in Gladys,
through the **SAIC iSMART** cloud (Europe), with the account of the MG iSMART
app.

> **Unofficial API, never tested with a real account nor a real car.** The
> integration talks to the gateway of the MG iSMART app, as the
> saic-ismart-client-ng library does. SAIC may change it without notice. Not
> affiliated with MG or SAIC Motor.

## Before you start: a second account

**SAIC allows one session per account.** When the integration signs in, the
MG app on your phone is signed out, and the other way round. The simplest:
create a **second account** (another e-mail) in the MG iSMART app, share the
car with it from your main account, and give that second account to Gladys.

If you use the same account, the integration signs in again **once per
24 hours** at most when its session is taken; taken again within those
24 hours, it pauses (new try after 6 h, then every 24 h) so as not to sign
the app out in a loop.

## What you get

One device per car of the account, with:

| Feature                | Content                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| Battery                | State of charge in %                                                       |
| Range                  | In km                                                                      |
| Charge status          | Unplugged, Plugged in not charging, Charging, Complete, Scheduled, Fault…  |
| Charging / Plugged in  | Yes or no                                                                  |
| Charging power         | In kW while the car charges (0 otherwise)                                  |
| Odometer               | In km                                                                      |
| Locks                  | Locked or unlocked (read only)                                             |
| Doors (4) and boot     | Open or closed                                                             |
| Latitude, longitude    | Position of the car, without history                                       |
| Cabin temperature      | In °C                                                                      |
| Climate (running)      | Yes or no, and its mode: off, fan only, on, front defrost                  |
| Last report of the car | Date and time of the last report sent by the car                           |
| Last command           | The outcome of the last command or refresh                                 |
| Buttons                | Refresh now, Lock, Unlock, Open the boot, climate and charge (start, stop) |

**Energy**: the gateway gives no reliable cumulative meter. The integration
publishes **no index** and no consumption: the charging power is a plain
sensor.

**Position**: published as two numbers, without history in Gladys, never
written in the logs nor in `/data`.

## The 12 V battery: spaced reads

**Each read wakes the car up**, which then draws on its 12 V battery. Waking
a parked car too often can drain that battery until the car no longer
starts. So:

- one read per car **every 3 hours** by default (60 minutes to 24 hours),
  **every 30 minutes while charging** (the car is then awake and plugged in);
- a car that does not answer (30 seconds of waiting) is read again after the
  interval, then twice later after each silence (up to once a day): never in
  a loop;
- an error is never read again sooner than the interval;
- the **Refresh now** button reads the car at once, at most every 10 minutes;
- the vehicle list (which does not wake the car) is read at start, then
  every 24 hours;
- the time of the next read is kept in `/data`: a restart does not wake the
  car before its time.

## Installation

1. Install the integration from the Gladys store.
2. In its configuration, enter the **e-mail** and the **password** of the MG
   iSMART account (preferably the second one). The password is kept by
   Gladys in its database, never shown again, sent only to the MG iSMART
   gateway of SAIC, as its SHA-1 digest like the app does.
3. Adjust the **interval**, the **timezone** (Europe/Paris by default) and the
   **language** of the names if needed.
4. Save, then add the cars from the **Discovery** tab.

The **Test the connection** button signs in if needed and reads the vehicle
list, **without waking the cars** (at most every 30 seconds). It also tries
again at once after a stop.

## Commands (all off by default)

Each command is a **button**, never a switch: a "turn everything off",
Google Home, Alexa, HomeKit or a "switch" scene action never reach them. A
scene can press a button, only through an explicit action on that button,
and only if its option is on.

| Button                   | Option to turn on           |
| ------------------------ | --------------------------- |
| Lock                     | Allow locking               |
| Unlock                   | Allow unlocking             |
| Open the boot            | Allow opening the boot      |
| Start / stop the climate | Allow the climate commands  |
| Start / stop charging    | Allow the charging commands |

Unlocking and opening the boot work remotely, for anyone who can press the
button in Gladys: leave these options off unless you need them.

How a command goes:

1. Gladys gets the answer "accepted" at once (the gateway often takes more
   than 10 seconds, and Gladys waits 5 seconds only); "Last command" shows
   "reading the car first…".
2. The integration **reads the car again** and decides on that fresh state
   only, never on memory: a useless command (already locked, climate already
   on…) is not sent; an unknown state, a car that does not answer, a car not
   plugged in (for charging) refuse the command without sending it.
3. The command is sent **once**, never sent again after a failure.
4. "Last command" gives the outcome: sent and confirmed by MG, sent but not
   confirmed (check before trying again), refused by MG, or not sent with the
   reason. The car is read again about 90 seconds later.

One command at a time per car. The integration never sends a code (SMS,
e-mail): it signs in with the e-mail and the password only.

## Errors and limits

- **E-mail or password refused**: a stop, one new try after 6 h, then every
  24 h. Saving new credentials or the test button try again at once.
- **Session taken by the app**: see "a second account" above.
- **429 (too many requests)**: a pause of 1 minute to 6 hours (15 minutes
  without a hint), for everything (reads, buttons, commands), kept across a
  restart.
- **Network, 5xx**: a new try after the interval, never sooner.
- `/data` keeps the MG session token, in clear, in a file readable by the
  container user only (0600), so also by the administrator of the machine and
  in the backups of the volume; never the e-mail, the password, the VIN nor
  the position. This token gives access to the car: it goes away when the
  integration is removed.
- Only European cars (the `gateway-mg-eu` gateway) and the e-mail sign-in
  are supported (not the phone number yet).
- Not supported yet: target temperature, heated seats and steering wheel,
  windows, sunroof, find my car, charge target, scheduled charging, charging
  port lock, alarms.
- The logs never hold the password, the token, the VIN, the position, nor
  the text of the gateway's answers.

## Credits

Ported from [saic-ismart-client-ng](https://github.com/SAIC-iSmart-API/saic-python-client-ng)
(SAIC-iSmart-API, MIT, version 0.10.0). Apache-2.0 license.
