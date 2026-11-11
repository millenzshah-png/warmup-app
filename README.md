# Warmup app

The companion app for the Warmup heated hoodie: three graphene heat panels, a
collar sensor that reads skin temperature, two snap-in cells at the waist and
a Bluetooth controller in the hem.

The app sets a target skin temperature and the hoodie holds it. This repository
contains the whole app, built screen for screen from the Warmup app design, and
a full simulation of the hoodie so every screen is live without hardware.

## What is real and what is simulated

| Part | Status |
| --- | --- |
| The app: 16 screens, storefront, state, persistence | Real, working code |
| Wire protocol between phone and hoodie | Real, binary, checksummed, tested |
| Hoodie firmware logic (heat control, safety, schedule, cells, updates) | Real logic, running in the simulator |
| The garment, the wearer and the air around them | A thermal model, tuned to the published numbers |
| Bluetooth to a physical controller | Written to the spec, not yet run against hardware |
| Storefront checkout | Not connected. The bag is saved on the device |

No hardware exists yet. The simulator speaks the same bytes a real controller
would, so the app has one code path, and the swap to hardware is made in one
place: `src/ui/env.ts`.

## Run it

Needs Node 20.19 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. On a laptop the app sits in a phone frame with the
demo controls beside it. On a phone it fills the screen.

To open it on a phone on the same Wi-Fi:

```bash
npm run dev -- --host
```

Then visit the "Network" address it prints.

## Try this

A two minute tour. `docs/DEMO_SCRIPT.md` has the full walkthrough.

1. Go through setup. Pairing finds the simulated hoodie.
2. Home shows live skin temperature. Tap **High**, then watch the zones pulse
   once the target is reached.
3. In the demo controls, tap **Put on a backpack**. Within about 40 seconds the
   back panel reaches 113°F and the app raises the **Heat paused** sheet.
4. Set a cell to **Out**. The hoodie keeps running on the other one.
5. Settings, **Firmware update**, **Install now**. The image is streamed to the
   hoodie, verified by checksum, and the hoodie restarts on 1.3.0.
6. Set the speed to **60×** to watch a Sleep fade or a morning preheat.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm test` | Run the 387 tests |
| `npm run typecheck` | Type-check everything |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the built app |

## How it is built

```
ui/screens      one file per screen, reads state, calls the controller
ui/components   switches, sliders, rings, sheets, the hoodie figure
        │
core/app        AppController: every action a screen can take
        │        state, selectors, wording
core/device     HoodieClient: commands in, telemetry and events out
        │        ── HoodieTransport ──┬── SimulatedHoodie (today)
        │                             └── WebBluetoothTransport (hardware)
core/protocol   frames, telemetry, commands, events, checksums
core/firmware   the controller's logic, stepped by a clock
core/thermal    garment model, heat controller, safety cutoff
core/battery    cells, load balancing, runtime estimates
core/spec.ts    every product number, in one place
```

Everything under `src/core` is plain TypeScript with no React and no browser
globals. That is what makes it testable in Node and reusable in a native app.

Two ideas hold it together:

- **The hoodie is the source of truth for what it owns.** Power, level, zones
  and the running mode come back from the hoodie in telemetry. The app never
  assumes a command worked.
- **The product spec drives the physics.** The published runtimes (6h 30m,
  4h 10m, 2h 50m) are constants in `spec.ts`. Panel power is derived from them,
  so the Battery screen, the storefront and the simulation can never disagree.

More detail: `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, `docs/THERMAL_MODEL.md`.

## Project layout

```
src/core/            engine, about 6,800 lines
src/ui/              interface, about 3,500 lines of TypeScript and 2,900 of CSS
tests/               387 tests, about 4,000 lines
public/              images, icons, install manifest
docs/                architecture, protocol, thermal model, demo script
```

## Tests

```bash
npm test
```

The suite covers the thermal model against the published behaviour, the heat
controller, the safety state machine, the cells, every protocol message in
both directions, the firmware in more than sixty scenarios, the simulator and
client over the wire, and the app controller end to end.

Some of what is pinned down:

- two full cells last exactly 6h 30m, 4h 10m and 2h 50m at Low, Medium, High
- Auto reaches 93°F at Medium and holds it within 0.2°F, with no overshoot
- a covered back panel is cut off at 113°F and resumes below 105°F
- three trips in ten minutes lock that zone until local midnight
- an uncovered panel never trips, flat out at High in an 80°F room
- a firmware image with one flipped bit is refused by the hoodie
- every single-bit error in a frame is detected

## Putting it on a phone

`npm run build` produces a static site in `dist/` that works from any host and
any sub-path. It includes an install manifest and a service worker, so once it
is hosted you can use **Add to Home Screen** and it opens full screen and works
offline.

This repository is private, and GitHub Pages on a free plan needs a public
repository. Ready-made workflows for tests and for Pages are in `docs/ci/`,
with the two steps needed to switch them on.

## From simulator to hardware

1. Build the hem controller firmware to `docs/PROTOCOL.md`. The firmware model
   in `src/core/firmware/firmware.ts` is the reference behaviour, and its
   tests are the acceptance tests.
2. In `src/ui/env.ts`, pass `new WebBluetoothTransport()` to the controller in
   place of the simulator.
3. Web Bluetooth works in Chrome and Edge on Android and desktop. Safari on
   iPhone does not offer it, so an iPhone build needs a native wrapper that
   implements the same `HoodieTransport` interface. Nothing above that
   interface changes.

## Credits

Warmup is a DECA Start-Up Business Plan project by Dan Huang and Millen Shah,
Henry M. Gunn High School.
