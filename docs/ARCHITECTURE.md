# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ ui/screens, ui/components        React, no business logic    │
├──────────────────────────────────────────────────────────────┤
│ core/app      AppController, state, selectors, wording       │
├──────────────────────────────────────────────────────────────┤
│ core/device   HoodieClient ── HoodieTransport                │
│                                  ├─ SimulatedHoodie          │
│                                  └─ WebBluetoothTransport    │
├──────────────────────────────────────────────────────────────┤
│ core/protocol frames, telemetry, commands, events, info      │
├──────────────────────────────────────────────────────────────┤
│ core/firmware the controller's rules (runs in the simulator) │
│ core/thermal  garment model, heat controller, safety         │
│ core/battery  cells, pack, runtime                           │
└──────────────────────────────────────────────────────────────┘
```

Dependencies point downwards only. `src/core` imports nothing from `src/ui`,
uses no React and touches no browser global, so all of it runs under Node in
the tests.

## A tap, end to end

Tapping **High** on Home:

1. `Main.tsx` calls `app.setLevel(2)`.
2. `AppController` encodes a `setLevel` command and sends it through
   `HoodieClient`.
3. The client wraps it in a frame with a sequence number and a CRC and writes
   it to the transport.
4. The simulator decodes the frame, hands the command to `Firmware.handle`,
   and notifies an Ack frame with the same sequence number.
5. The client resolves the command. The hoodie then notifies a telemetry frame
   with the new level.
6. `AppController.onTelemetry` puts it in the store. Home re-renders.

The screen never set its own state. If the hoodie had refused (wash mode on,
no cells, a fault), the Ack would carry the reason and the controller would
show it as a notice.

## Who owns what

| Owned by the hoodie | Owned by the app |
| --- | --- |
| power, level, enabled zones | profiles and each profile's modes |
| the running mode's parameters | which mode is selected, as a name |
| wash lock, safety state, faults | settings, unit, notification choice |
| the preheat schedule (a copy) | the schedule (the editable original) |
| cell charge, cycles, health | usage history |
| firmware version | the shopping bag |

On every connection the app pushes the clock, the preferences, the schedule
and the phone's context. It does not push power, level or mode: the hoodie
keeps those, and the app follows what telemetry reports. That matters because
the hoodie can change them itself, from the hem button or the schedule.

## State and persistence

One store (`core/store/store.ts`) holds `AppState`. Half of it is persisted
(setup, hoodie record, settings, profiles, schedule, history, bag) and half is
volatile (link status, last telemetry, alerts, notices, update progress).

The persisted half is written to local storage through
`core/store/persistence.ts`, which wraps it in an envelope with a schema
number, runs migrations when the schema moves on, validates the result and
discards anything it cannot trust. A damaged save can never stop the app from
starting.

The simulated hoodie persists separately, under its own key, because it stands
in for the controller's own flash memory.

## The simulator

`SimulatedHoodie` is a `HoodieTransport`. It owns a `Firmware`, steps it on a
250 ms timer, and encodes what it reports into real frames. Its demo controls
act on the simulated world (room temperature, a backpack, a cell pulled out),
never on the app. The app finds out the way it would with hardware.

`SimulatedPhoneSensors` reads the same world and reports where the wearer is,
which the controller forwards to the hoodie as context. On a real phone that
class is replaced by location, motion and weather.

Time can run at 1×, 10×, 60× or 600×. The firmware is stepped in one second
slices however fast time runs, so behaviour does not change with speed.

## Routing

`ui/router.tsx` is a small hash router. The path lives in the URL hash so the
build works from any host and sub-path with no server rules. Each history
entry stores its depth, which is how a navigation knows whether it went
forward or back and slides in from the right side.

`App.tsx` guards the routes: setup screens until setup is done, the name
screen only once a hoodie is connected, pairing only while nothing is paired.

## Layout

On a phone the app fills the viewport and respects the safe areas. On a
laptop it is drawn inside a 390 by 844 frame, scaled to the window, with the
demo controls beside it. Screens size themselves from their container
(`cqh` units), not from the window, so they behave the same in both.

## Testing

Tests live in `tests/` and run under Node with Vitest.

- Pure modules are tested directly: units, modes, thermal, safety, battery,
  protocol, schedule, insights, profiles, shop, store.
- `firmware.test.ts` steps the controller through scenarios in simulated
  seconds.
- `simulator.test.ts` exercises the transport and client over the wire.
- `controller.test.ts` drives the app controller against the simulator with a
  fake clock, so pairing, updates and reconnection run in milliseconds.

The interface itself was checked by hand in a browser at 375 by 667, 390 by
844 and 1440 by 900.

## Decisions

**A web app, not a native one.** It runs on any phone from a link, installs to
the home screen, and needs no developer account. The core has no browser
dependencies, so a native shell can reuse it.

**The simulator speaks the real protocol.** A fake that returned objects would
have been quicker to write and would have hidden every encoding bug until
hardware arrived.

**Spec first.** Published numbers are constants and the physics is derived
from them. Tests assert the published behaviour, so a change that breaks a
claim on the storefront fails a test.

**No UI framework beyond React.** The design is one stylesheet of about thirty
classes. Reproducing it directly was simpler than bending a component library
to match.
