# Thermal model

There is no hoodie to measure yet, so the app is developed against a model of
one. This page says what the model is, how it was tuned, and where it should
not be trusted. The code is `src/core/thermal/model.ts`.

## What is modelled

Four slow things, each as a first-order lag:

- the collar skin temperature the sensor reads
- how far each of the three panels has been lifted by its heater
- how much heat is trapped behind each panel when something presses on it

Everything is in degrees Celsius. Conversion to Fahrenheit happens only when a
number is shown.

## Equations

Resting skin temperature at the collar, with no heating:

```
rest(Ta) = clamp(32.556 + 0.12 * (Ta - 19), 28, 34.5)
```

`Ta` is the air temperature. 32.556 °C is 90.6 °F, in a 66 °F room.

Heater lift of a panel, as if uncovered. `P` is the electrical power in watts
and `R` the panel's thermal resistance:

```
d(flux)/dt = (P * R - flux) / tau_panel
```

Insulation behind a panel, 1 in open air and 3.6 when pressed against the body:

```
d(ins)/dt = (target - ins) / tau_ins
```

What the panel's own thermistor reads:

```
open    = 0.95 * skin + 0.05 * Ta
pressed = skin + 3
base    = open + (pressed - open) * coverage      coverage = (ins - 1) / 2.6
panel   = base + flux * ins
```

Skin temperature, pulled towards rest plus what the panels add:

```
skin_eq    = rest + sum over zones of k * max(0, open + flux - rest)
d(skin)/dt = (skin_eq - skin) / tau_skin
```

The insulation multiplier is deliberately left out of the skin equation. The
collar feels the heat a panel delivers, not how hot a covered panel gets. With
it left in, a covered panel fooled the controller into backing off and the
cutoff never fired.

## Constants

| Constant | Value |
| --- | --- |
| Panel resistance, chest | 3.7 °C/W |
| Panel resistance, back | 3.85 °C/W |
| Skin coupling `k`, chest left and right | 0.096 each |
| Skin coupling `k`, back | 0.128 |
| Panel time constant | 75 s |
| Insulation time constant | 40 s |
| Skin time constant | 240 s |
| Covered multiplier | 3.6 |
| Covered baseline lift | 3 °C |

## Power comes from the spec

Panel power is not a free parameter. The published runtimes are constants and
the power follows from them:

```
pack power(level) = 18.5 Wh * (1 - 0.03 reserve) / runtime(level)
zone power(level) = (pack power - 0.06 W electronics) / 3
```

| Level | Runtime from full | Pack | Per zone |
| --- | --- | --- | --- |
| Low | 6h 30m | 2.76 W | 0.90 W |
| Medium | 4h 10m | 4.31 W | 1.42 W |
| High | 2h 50m | 6.33 W | 2.09 W |

## What it reproduces

Running flat out with all three zones on, where the model settles:

| Air | Level | Skin | Chest panel | Back panel |
| --- | --- | --- | --- | --- |
| 66 °F | Low | 92.8 °F | 97.5 °F | 97.7 °F |
| 66 °F | Medium | 94.4 °F | 102.5 °F | 102.8 °F |
| 66 °F | High | 96.6 °F | 109.0 °F | 109.5 °F |
| 80 °F | High | 98.5 °F | 111.5 °F | 112.1 °F |
| 45 °F | High | 93.5 °F | 105.0 °F | 105.6 °F |

Closed loop, Auto at 93 °F in a 66 °F room:

| Level | Skin | Duty | Draw |
| --- | --- | --- | --- |
| Low | 92.8 °F, just short | 100 % | 2.76 W |
| Medium | 93.0 °F | about 65 % | 2.81 W |
| High | 93.0 °F | about 45 % | 2.63 W |

That is the published claim made concrete: Auto lands between Low and Medium
because it pulses instead of holding.

A backpack on the back panel, starting from a settled Auto:

| Event | Time |
| --- | --- |
| Panel reaches 113 °F, cut off | about 43 s |
| Cooled below 105 °F, resumes | about 90 s later |
| Third trip, zone locked for the day | about 4.5 min |

## The heat controller

`src/core/thermal/controller.ts`. A PI loop on skin temperature:

```
duty = clamp(1.0 * error + integral, 0, cap)        error in °C
integral += 0.004 * error * dt                      while not saturated
```

- The output is slew limited on the way up by the mode's ramp: 180 s, 60 s or
  15 s from zero to full. It comes down in 8 s.
- The duty is delivered as one burst per 20 s window, so a 40 % duty is 8 s on
  and 12 s off. Below 2 % it stays off and above 98 % it stays on.
- With pulse off, a mode uses a plain thermostat instead: on until 0.35 °C over
  the target, off until 0.1 °C under. It overshoots, which is why pulse saves
  battery.

Tuned for no overshoot: from a cold start at High the skin peaks at 93.03 °F
on its way to 93.

## Safety

`src/core/thermal/safety.ts`, checked every tick before anything else.

| Rule | Value |
| --- | --- |
| Panel cut off at | 113 °F |
| Panel may resume below | 105 °F |
| Trips before a day lockout | 3 within 10 minutes |
| Hard limit, latches a fault | 122 °F |
| Sensor reading treated as a fault | skin outside 5 to 45 °C, or not a number |

## Where not to trust it

- It is tuned to published targets, not measured from a garment. Real panels
  will have different resistances and time constants, and the first prototype
  should be logged and these constants refitted.
- One skin temperature stands in for the whole torso. Real skin under a panel
  is warmer than skin at the collar.
- Fit, layers, wind and sweat are not modelled. They matter a great deal
  outdoors.
- The covered-panel behaviour is chosen so that a realistic hazard trips the
  cutoff within a minute. The true margin has to come from testing.
- The cell model tracks energy, with a voltage curve for plausibility. It has
  no temperature dependence, and cold cells hold less.

The model is good for developing the app and the control logic, and for
showing how the product behaves. It is not evidence that the product is safe.
