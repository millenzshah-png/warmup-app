import { describe, expect, it } from 'vitest';
import { Firmware, ambientC, defaultWorld } from '../src/core/firmware/firmware';
import { buildFirmwareImage, checkFirmwareImage } from '../src/core/firmware/image';
import { availableUpdate, featuresFor, findRelease, latestRelease } from '../src/core/firmware/releases';
import { builtInMode } from '../src/core/modes';
import { AckCode, OTA_CHUNK_BYTES, modeParamsFromConfig, type ModeParams } from '../src/core/protocol/commands';
import { FIRMWARE_IMAGE_BYTES, PANEL_LIMIT_C, levelZonePowerW } from '../src/core/spec';
import { FAULT_NONE, FAULT_SENSOR } from '../src/core/thermal/safety';
import { parseVersion } from '../src/core/types';
import { cToF, fToC } from '../src/core/units';
import { MONDAY_NOON_S, freshFirmware, run, runCollecting } from './helpers';

const mode = (id: Parameters<typeof builtInMode>[0], over: Partial<ModeParams> = {}): ModeParams => ({
  ...modeParamsFromConfig(builtInMode(id)),
  ...over,
});

describe('a new hoodie', () => {
  it('starts cold, off and at rest', () => {
    const fw = freshFirmware();
    const t = fw.telemetry();
    expect(t.power).toBe(false);
    expect(t.heating).toBe(false);
    expect(cToF(t.skinC)).toBeCloseTo(90.6, 1);
    expect(t.cells.left.soc).toBe(1);
    expect(fw.info().version).toEqual(parseVersion('1.2.0'));
    expect(fw.advertisement().name).toBe('Warmup Hoodie');
  });

  it('does not heat until asked', () => {
    const fw = freshFirmware();
    run(fw, 600);
    expect(cToF(fw.telemetry().skinC)).toBeCloseTo(90.6, 1);
    expect(fw.telemetry().duty).toEqual({ L: 0, R: 0, B: 0 });
  });

  it('builds a worn-in hoodie that is already holding its target', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    const t = fw.telemetry();
    expect(t.power).toBe(true);
    expect(cToF(t.skinC)).toBeCloseTo(93, 0);
    expect(t.cells.left.soc).toBeCloseTo(0.82, 6);
    expect(t.cells.right.soc).toBeCloseTo(0.74, 6);
    expect(t.rtcEpochS).toBe(MONDAY_NOON_S);
    expect(t.runtimeMin ?? 0).toBeGreaterThan(185);
    expect(t.runtimeMin ?? 0).toBeLessThan(200);
    expect(fw.takeEvents()).toEqual([]);
  });
});

describe('holding a target', () => {
  it('brings the skin to 93 °F in Auto at Medium and holds it', () => {
    const fw = freshFirmware();
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Ok);
    run(fw, 40 * 60);
    const readings: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      fw.step(1);
      readings.push(cToF(fw.telemetry().skinC));
    }
    expect(Math.min(...readings)).toBeGreaterThan(92.8);
    expect(Math.max(...readings)).toBeLessThan(93.2);
  });

  it('pulses rather than running flat out once it is there', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setLevel', level: 2 });
    fw.handle({ op: 'setPower', on: true });
    run(fw, 40 * 60);
    let on = 0;
    for (let i = 0; i < 600; i += 1) {
      fw.step(1);
      if (fw.telemetry().zonesHeating.L) on += 1;
    }
    expect(on).toBeGreaterThan(120);
    expect(on).toBeLessThan(480);
    expect(fw.state.drawEmaW).toBeLessThan(levelZonePowerW(2) * 3);
  });

  it('runs flat out at Low and still falls short of 93 °F', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setLevel', level: 0 });
    fw.handle({ op: 'setPower', on: true });
    run(fw, 60 * 60);
    const t = fw.telemetry();
    expect(t.duty.L).toBe(1);
    expect(cToF(t.skinC)).toBeLessThan(93);
    expect(cToF(t.skinC)).toBeGreaterThan(92.4);
  });

  it('never overshoots by more than a fraction of a degree on the way up', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setLevel', level: 2 });
    fw.handle({ op: 'setMode', mode: mode('auto', { ramp: 'fast' }), start: true });
    let peak = 0;
    for (let i = 0; i < 60 * 60; i += 1) {
      fw.step(1);
      peak = Math.max(peak, cToF(fw.telemetry().skinC));
    }
    expect(peak).toBeLessThan(93.5);
  });

  it('warms more slowly in Sick mode than with a fast ramp', () => {
    const slow = freshFirmware();
    slow.handle({ op: 'setMode', mode: mode('sick'), start: true });
    const fast = freshFirmware();
    fast.handle({ op: 'setMode', mode: mode('sick', { ramp: 'fast' }), start: true });
    run(slow, 120);
    run(fast, 120);
    expect(slow.telemetry().duty.L).toBeLessThan(fast.telemetry().duty.L);
    expect(slow.telemetry().skinC).toBeLessThan(fast.telemetry().skinC);
  });

  it('heats only the zones that are switched on', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setZones', zones: { L: true, R: false, B: false } });
    fw.handle({ op: 'setPower', on: true });
    run(fw, 600);
    const t = fw.telemetry();
    expect(t.duty.L).toBeGreaterThan(0);
    expect(t.duty.R).toBe(0);
    expect(t.duty.B).toBe(0);
    expect(t.panelC.L).toBeGreaterThan(t.panelC.R + 2);
  });

  it('stops heating with every zone off', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setPower', on: true });
    fw.handle({ op: 'setZones', zones: { L: false, R: false, B: false } });
    run(fw, 60);
    expect(fw.telemetry().heating).toBe(false);
    expect(fw.telemetry().runtimeMin).toBeNull();
  });

  it('applies a mode\'s own zones when the mode starts', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setMode', mode: mode('auto', { zones: { L: true, R: true, B: false } }), start: true });
    expect(fw.telemetry().zonesEnabled).toEqual({ L: true, R: true, B: false });
  });
});

describe('over-temperature protection', () => {
  function wornAndCovered(): Firmware {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.world.covered.B = true;
    return fw;
  }

  it('cuts the back panel off when a backpack presses on it', () => {
    const fw = wornAndCovered();
    const events = runCollecting(fw, 120);
    const tripped = events.find((e) => e.type === 'overheatTrip');
    expect(tripped).toMatchObject({ type: 'overheatTrip', zone: 'B' });
    if (tripped?.type === 'overheatTrip') expect(tripped.peakC).toBeGreaterThanOrEqual(PANEL_LIMIT_C);
    const t = fw.telemetry();
    expect(t.zoneSafety.B).toBe('cutoff');
    expect(t.duty.B).toBe(0);
    expect(t.zoneSafety.L).toBe('ok');
    expect(t.duty.L).toBeGreaterThan(0);
  });

  it('resumes on its own once the panel has cooled and the pressure is gone', () => {
    const fw = wornAndCovered();
    runCollecting(fw, 60);
    expect(fw.telemetry().zoneSafety.B).toBe('cutoff');
    fw.world.covered.B = false;
    const events = runCollecting(fw, 300);
    expect(events.some((e) => e.type === 'overheatClear')).toBe(true);
    expect(fw.telemetry().zoneSafety.B).toBe('ok');
    const later = runCollecting(fw, 900);
    expect(later.some((e) => e.type === 'overheatTrip')).toBe(false);
    expect(fw.telemetry().duty.B).toBeGreaterThan(0);
  });

  it('never lets a covered panel run far past the limit', () => {
    const fw = wornAndCovered();
    let peak = 0;
    for (let i = 0; i < 900; i += 1) {
      fw.step(1);
      peak = Math.max(peak, fw.telemetry().panelC.B);
    }
    expect(peak).toBeLessThan(PANEL_LIMIT_C + 1.5);
  });

  it('locks the zone for the day after three trips', () => {
    const fw = wornAndCovered();
    const events = runCollecting(fw, 15 * 60);
    expect(events.filter((e) => e.type === 'overheatTrip').length).toBe(3);
    expect(events.some((e) => e.type === 'zoneLockout')).toBe(true);
    expect(fw.telemetry().zoneSafety.B).toBe('lockout');
    fw.world.covered.B = false;
    run(fw, 3600);
    expect(fw.telemetry().zoneSafety.B).toBe('lockout');
    expect(fw.telemetry().duty.B).toBe(0);
  });

  it('lifts the lockout at the next local midnight', () => {
    const fw = wornAndCovered();
    runCollecting(fw, 15 * 60);
    fw.world.covered.B = false;
    fw.state.rtcEpochS = MONDAY_NOON_S + 12 * 3600 - 5;
    const events = runCollecting(fw, 10);
    expect(events.some((e) => e.type === 'zoneLockoutEnded')).toBe(true);
    expect(fw.telemetry().zoneSafety.B).toBe('ok');
  });

  it('lets the wearer switch a zone off for the day and back on', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    expect(fw.handle({ op: 'safetyAck', zone: 'B', action: 'lockoutToday' })).toBe(AckCode.Ok);
    run(fw, 5);
    expect(fw.telemetry().zoneSafety.B).toBe('lockout');
    expect(fw.handle({ op: 'safetyAck', zone: 'B', action: 'clearLockout' })).toBe(AckCode.Ok);
    run(fw, 5);
    expect(fw.telemetry().zoneSafety.B).toBe('ok');
  });

  it('does not trip when lying on the back panel in Sleep mode', () => {
    const fw = freshFirmware({ version: '1.3.0' });
    fw.world.covered.B = true;
    fw.handle({ op: 'setMode', mode: mode('sleep'), start: true });
    const events = runCollecting(fw, 30 * 60);
    expect(events.some((e) => e.type === 'overheatTrip')).toBe(false);
  });

  it('disables heating on a sensor fault until it is cleared', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.world.sensorFault = true;
    const events = runCollecting(fw, 3);
    expect(events).toContainEqual({ type: 'fault', code: FAULT_SENSOR });
    run(fw, 30);
    expect(fw.telemetry().fault).toBe(FAULT_SENSOR);
    expect(fw.telemetry().heating).toBe(false);
    expect(fw.handle({ op: 'setPower', on: false })).toBe(AckCode.Ok);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Fault);

    // Clearing while the sensor is still broken does not stick.
    fw.handle({ op: 'clearFault' });
    run(fw, 2);
    expect(fw.telemetry().fault).toBe(FAULT_SENSOR);

    fw.world.sensorFault = false;
    fw.handle({ op: 'clearFault' });
    expect(fw.takeEvents().some((e) => e.type === 'faultCleared')).toBe(true);
    run(fw, 2);
    expect(fw.telemetry().fault).toBe(FAULT_NONE);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Ok);
  });
});

describe('wash mode and the hem button', () => {
  it('locks heating out completely', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    expect(fw.handle({ op: 'setWashLock', on: true })).toBe(AckCode.Ok);
    expect(fw.telemetry().power).toBe(false);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Locked);
    expect(fw.handle({ op: 'setMode', mode: mode('sick'), start: true })).toBe(AckCode.Locked);
    expect(fw.pressButton()).toBe(false);
    run(fw, 60);
    expect(fw.telemetry().heating).toBe(false);
    expect(fw.telemetry().washLock).toBe(true);
    fw.handle({ op: 'setWashLock', on: false });
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Ok);
  });

  it('toggles heating from the hem button and says so', () => {
    const fw = freshFirmware();
    expect(fw.pressButton()).toBe(true);
    expect(fw.telemetry().power).toBe(true);
    expect(fw.takeEvents()).toContainEqual({ type: 'button', power: true });
    fw.pressButton();
    expect(fw.telemetry().power).toBe(false);
    expect(fw.takeEvents()).toContainEqual({ type: 'button', power: false });
  });
});

describe('timers', () => {
  it('switches off when a mode\'s time is up', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setMode', mode: mode('sick', { autoOffMin: 5 }), start: true });
    run(fw, 4 * 60);
    expect(fw.telemetry().power).toBe(true);
    expect(fw.telemetry().autoOffRemainingMin).toBe(1);
    const events = runCollecting(fw, 61);
    expect(events).toContainEqual({ type: 'autoOff', reason: 'timer' });
    expect(fw.telemetry().power).toBe(false);
    expect(fw.telemetry().autoOffRemainingMin).toBeNull();
  });

  it('restarts the timer when the mode is started again', () => {
    const fw = freshFirmware();
    const sick = mode('sick', { autoOffMin: 5 });
    fw.handle({ op: 'setMode', mode: sick, start: true });
    run(fw, 4 * 60);
    fw.handle({ op: 'setMode', mode: sick, start: true });
    run(fw, 4 * 60);
    expect(fw.telemetry().power).toBe(true);
  });

  it('fades Sleep out and stops cleanly on 1.3.0', () => {
    const fw = freshFirmware({ version: '1.3.0' });
    fw.handle({ op: 'setLevel', level: 2 });
    fw.handle({ op: 'setMode', mode: mode('sleep', { autoOffMin: 40, fadeOutMin: 30 }), start: true });
    run(fw, 9 * 60);
    expect(fw.telemetry().fading).toBe(false);
    run(fw, 6 * 60);
    expect(fw.telemetry().fading).toBe(true);
    const early = fw.telemetry().targetC;
    run(fw, 15 * 60);
    expect(fw.telemetry().targetC).toBeLessThan(early);
    const events = runCollecting(fw, 11 * 60);
    expect(events).toContainEqual({ type: 'autoOff', reason: 'fade' });
    expect(fw.telemetry().power).toBe(false);
    run(fw, 60);
    expect(fw.telemetry().duty).toEqual({ L: 0, R: 0, B: 0 });
  });

  it('reproduces the 1.2.0 fault where the back zone stays on after Sleep', () => {
    const fw = freshFirmware({ version: '1.2.0' });
    fw.handle({ op: 'setMode', mode: mode('sleep'), start: true });
    const events = runCollecting(fw, 31 * 60);
    expect(events).toContainEqual({ type: 'autoOff', reason: 'fade' });
    const t = fw.telemetry();
    expect(t.power).toBe(true);
    expect(t.duty.B).toBeGreaterThan(0);
    expect(t.duty.L).toBe(0);
    expect(t.duty.R).toBe(0);
    // Any deliberate action clears it.
    fw.handle({ op: 'setPower', on: false });
    run(fw, 5);
    expect(fw.telemetry().duty.B).toBe(0);
  });

  it('switches off after thirty still minutes in an open-ended mode', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.handle({ op: 'setContext', outdoors: false, moving: false, outdoorC: 7 });
    run(fw, 29 * 60);
    expect(fw.telemetry().power).toBe(true);
    const events = runCollecting(fw, 2 * 60);
    expect(events).toContainEqual({ type: 'autoOff', reason: 'still' });
    expect(fw.telemetry().power).toBe(false);
  });

  it('leaves timed modes and the opted-out wearer alone when still', () => {
    const timed = freshFirmware();
    timed.handle({ op: 'setContext', outdoors: false, moving: false, outdoorC: 7 });
    timed.handle({ op: 'setMode', mode: mode('sick'), start: true });
    run(timed, 45 * 60);
    expect(timed.telemetry().power).toBe(true);

    const optedOut = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    optedOut.handle({ op: 'setPrefs', autoOffWhenStill: false, buttonHaptics: false });
    optedOut.handle({ op: 'setContext', outdoors: false, moving: false, outdoorC: 7 });
    run(optedOut, 45 * 60);
    expect(optedOut.telemetry().power).toBe(true);
  });

  it('resets the stillness clock the moment the wearer moves', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.handle({ op: 'setContext', outdoors: false, moving: false, outdoorC: 7 });
    run(fw, 25 * 60);
    fw.handle({ op: 'setContext', outdoors: false, moving: true, outdoorC: 7 });
    fw.handle({ op: 'setContext', outdoors: false, moving: false, outdoorC: 7 });
    run(fw, 25 * 60);
    expect(fw.telemetry().power).toBe(true);
  });
});

describe('context from the phone', () => {
  it('eases Commute to Low after five still minutes indoors, and back', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setLevel', level: 2 });
    fw.handle({ op: 'setMode', mode: mode('commute'), start: true });
    fw.handle({ op: 'setContext', outdoors: false, moving: false, outdoorC: 7 });
    run(fw, 4 * 60);
    expect(fw.telemetry().eased).toBe(false);
    const events = runCollecting(fw, 2 * 60);
    expect(events).toContainEqual({ type: 'eased', on: true });
    expect(fw.telemetry().eased).toBe(true);
    expect(fw.telemetry().level).toBe(2);
    expect(fw.telemetry().effectiveLevel).toBe(0);
    fw.handle({ op: 'setContext', outdoors: false, moving: true, outdoorC: 7 });
    const after = runCollecting(fw, 2);
    expect(after).toContainEqual({ type: 'eased', on: false });
    expect(fw.telemetry().effectiveLevel).toBe(2);
  });

  it('does not ease while the wearer is still outdoors', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setMode', mode: mode('commute'), start: true });
    fw.handle({ op: 'setContext', outdoors: true, moving: false, outdoorC: 7 });
    run(fw, 10 * 60);
    expect(fw.telemetry().eased).toBe(false);
  });

  it('adds two degrees outdoors with outdoor boost', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setMode', mode: mode('auto', { outdoorBoost: true }), start: true });
    fw.handle({ op: 'setContext', outdoors: false, moving: true, outdoorC: 7 });
    run(fw, 2);
    expect(cToF(fw.telemetry().targetC)).toBeCloseTo(93, 1);
    fw.handle({ op: 'setContext', outdoors: true, moving: true, outdoorC: 7 });
    run(fw, 2);
    expect(cToF(fw.telemetry().targetC)).toBeCloseTo(95, 1);
  });

  it('holds the full Outdoor target in the cold and backs off when it is mild', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setMode', mode: mode('outdoor'), start: true });
    fw.handle({ op: 'setContext', outdoors: true, moving: true, outdoorC: fToC(30) });
    run(fw, 2);
    expect(cToF(fw.telemetry().targetC)).toBeCloseTo(97, 1);
    fw.handle({ op: 'setContext', outdoors: true, moving: true, outdoorC: fToC(70) });
    run(fw, 2);
    expect(cToF(fw.telemetry().targetC)).toBeCloseTo(93, 1);
  });

  it('uses the plain target until the phone has reported in', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'setMode', mode: mode('outdoor'), start: true });
    run(fw, 2);
    expect(cToF(fw.telemetry().targetC)).toBeCloseTo(97, 1);
    expect(fw.telemetry().contextMoving).toBe(true);
  });

  it('feels the cold when the wearer steps outside', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    const indoors = fw.telemetry().skinC;
    fw.world.outdoors = true;
    fw.world.outdoorC = fToC(30);
    expect(ambientC(fw.world)).toBeCloseTo(fToC(30), 9);
    run(fw, 20 * 60);
    expect(fw.telemetry().skinC).toBeLessThan(indoors - 0.3);
    expect(fw.telemetry().duty.L).toBe(1);
    expect(defaultWorld().outdoors).toBe(false);
  });
});

describe('the preheat schedule', () => {
  const sched = (over = {}) => ({
    enabled: true,
    minuteOfDay: 7 * 60 + 20,
    days: [true, true, true, true, true, false, false] as [boolean, boolean, boolean, boolean, boolean, boolean, boolean],
    preheatMin: 10,
    mode: mode('commute'),
    level: 2 as const,
    ...over,
  });
  /** Tuesday 3 November 2026 at the given local time, with the clock in UTC. */
  const tuesdayAt = (h: number, m: number): number => Date.UTC(2026, 10, 3, h, m, 0) / 1000;

  it('starts heating ten minutes before the departure time', () => {
    const fw = freshFirmware({ epochS: tuesdayAt(7, 5) });
    expect(fw.handle({ op: 'setSchedule', schedule: sched() })).toBe(AckCode.Ok);
    run(fw, 4 * 60);
    expect(fw.telemetry().power).toBe(false);
    const events = runCollecting(fw, 2 * 60);
    expect(events).toContainEqual({ type: 'scheduleStart', preheatMin: 10 });
    const t = fw.telemetry();
    expect(t.power).toBe(true);
    expect(t.preheating).toBe(true);
    expect(t.modeSlot).toBe(2);
    expect(t.level).toBe(2);
    expect(t.scheduleArmed).toBe(true);
  });

  it('stops calling it a preheat once the departure time arrives', () => {
    const fw = freshFirmware({ epochS: tuesdayAt(7, 9) });
    fw.handle({ op: 'setSchedule', schedule: sched() });
    run(fw, 5 * 60);
    expect(fw.telemetry().preheating).toBe(true);
    run(fw, 8 * 60);
    expect(fw.telemetry().preheating).toBe(false);
    expect(fw.telemetry().power).toBe(true);
  });

  it('runs once a day, even if the wearer switches it off again', () => {
    const fw = freshFirmware({ epochS: tuesdayAt(7, 9) });
    fw.handle({ op: 'setSchedule', schedule: sched() });
    runCollecting(fw, 2 * 60);
    fw.handle({ op: 'setPower', on: false });
    const events = runCollecting(fw, 8 * 60);
    expect(events.some((e) => e.type === 'scheduleStart')).toBe(false);
    expect(fw.telemetry().power).toBe(false);
  });

  it('runs again the next day', () => {
    const fw = freshFirmware({ epochS: tuesdayAt(7, 9) });
    fw.handle({ op: 'setSchedule', schedule: sched() });
    runCollecting(fw, 20 * 60);
    fw.handle({ op: 'setPower', on: false });
    fw.state.rtcEpochS = Date.UTC(2026, 10, 4, 7, 9, 0) / 1000;
    const events = runCollecting(fw, 2 * 60);
    expect(events.some((e) => e.type === 'scheduleStart')).toBe(true);
  });

  it('skips days that are switched off', () => {
    const saturday = Date.UTC(2026, 10, 7, 7, 9, 0) / 1000;
    const fw = freshFirmware({ epochS: saturday });
    fw.handle({ op: 'setSchedule', schedule: sched() });
    const events = runCollecting(fw, 15 * 60);
    expect(events.some((e) => e.type === 'scheduleStart')).toBe(false);
  });

  it('respects the wearer\'s time zone', () => {
    // 15:09 UTC is 07:09 in a zone eight hours behind.
    const fw = freshFirmware({ epochS: tuesdayAt(15, 9), tzOffsetMin: -480 });
    fw.handle({ op: 'setSchedule', schedule: sched() });
    const events = runCollecting(fw, 2 * 60);
    expect(events.some((e) => e.type === 'scheduleStart')).toBe(true);
  });

  it('starts the evening before for a departure just after midnight', () => {
    const mondayLate = Date.UTC(2026, 10, 2, 23, 54, 0) / 1000;
    const fw = freshFirmware({ epochS: mondayLate });
    fw.handle({ op: 'setSchedule', schedule: sched({ minuteOfDay: 5 }) });
    const events = runCollecting(fw, 3 * 60);
    expect(events.some((e) => e.type === 'scheduleStart')).toBe(true);
  });

  it('does nothing when disabled, in wash mode or without charge', () => {
    const disabled = freshFirmware({ epochS: tuesdayAt(7, 9) });
    disabled.handle({ op: 'setSchedule', schedule: sched({ enabled: false }) });
    expect(runCollecting(disabled, 600).some((e) => e.type === 'scheduleStart')).toBe(false);

    const washing = freshFirmware({ epochS: tuesdayAt(7, 9) });
    washing.handle({ op: 'setSchedule', schedule: sched() });
    washing.handle({ op: 'setWashLock', on: true });
    expect(runCollecting(washing, 600).some((e) => e.type === 'scheduleStart')).toBe(false);

    const flat = freshFirmware({ epochS: tuesdayAt(7, 9), cells: { left: { soc: 0.02 }, right: { soc: 0.02 } } });
    flat.handle({ op: 'setSchedule', schedule: sched() });
    expect(runCollecting(flat, 600).some((e) => e.type === 'scheduleStart')).toBe(false);
  });

  it('rejects a schedule with impossible values', () => {
    const fw = freshFirmware();
    expect(fw.handle({ op: 'setSchedule', schedule: sched({ preheatMin: 0 }) })).toBe(AckCode.Invalid);
    expect(fw.handle({ op: 'setSchedule', schedule: sched({ minuteOfDay: 1440 }) })).toBe(AckCode.Invalid);
  });
});

describe('cells', () => {
  it('drains two full cells in the published time at each level', () => {
    for (const [level, minutes] of [
      [0, 390],
      [1, 250],
      [2, 170],
    ] as const) {
      const fw = freshFirmware();
      fw.handle({ op: 'setLevel', level });
      // A target the level cannot reach keeps every panel on continuously.
      fw.handle({ op: 'setMode', mode: mode('auto', { targetF: 99, ramp: 'fast' }), start: true });
      let seconds = 0;
      while (fw.state.power && seconds < 8 * 3600) {
        fw.step(1);
        seconds += 1;
      }
      expect(seconds / 60).toBeGreaterThan(minutes - 2);
      expect(seconds / 60).toBeLessThan(minutes + 2);
    }
  });

  it('warns at twenty percent and stops heating at the reserve', () => {
    const fw = freshFirmware({ cells: { left: { soc: 0.215 }, right: { soc: 0.215 } } });
    fw.handle({ op: 'setLevel', level: 2 });
    fw.handle({ op: 'setMode', mode: mode('auto', { targetF: 99, ramp: 'fast' }), start: true });
    const events = runCollecting(fw, 3600);
    const low = events.find((e) => e.type === 'lowBattery');
    expect(low).toMatchObject({ type: 'lowBattery', percent: 20 });
    expect(events.filter((e) => e.type === 'lowBattery').length).toBe(1);
    expect(events).toContainEqual({ type: 'criticalBattery' });
    expect(fw.telemetry().power).toBe(false);
    expect(fw.telemetry().lowBattery).toBe(true);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.LowBattery);
    expect(fw.hasPower()).toBe(true);
  });

  it('keeps running on one cell when the other is pulled', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.removeCell('left');
    const events = runCollecting(fw, 60);
    expect(events).toContainEqual({ type: 'cellRemoved', cell: 'left' });
    const t = fw.telemetry();
    expect(t.cells.left.present).toBe(false);
    expect(t.power).toBe(true);
    expect(t.heating).toBe(true);
    expect(fw.state.pack.left.soc).toBeCloseTo(0.82, 6);
    expect(fw.state.pack.right.soc).toBeLessThan(0.74);
  });

  it('goes dark with both cells out and wakes when one returns', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.removeCell('left');
    fw.removeCell('right');
    run(fw, 5);
    expect(fw.hasPower()).toBe(false);
    expect(fw.isLinkUp()).toBe(false);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Busy);
    expect(fw.pressButton()).toBe(false);
    fw.insertCell('right');
    run(fw, 2);
    expect(fw.isLinkUp()).toBe(true);
    expect(fw.telemetry().power).toBe(false);
    expect(fw.telemetry().uptimeS).toBeLessThan(5);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Ok);
  });

  it('refuses to start with no charged cell seated', () => {
    const fw = freshFirmware({ cells: { left: { soc: 0.5, present: false }, right: { soc: 0.5 } } });
    fw.state.pack.right.soc = 0.001;
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.NoCells);
  });

  it('charges a cell on the dock while the other keeps the hoodie warm', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.dockCell('left');
    run(fw, 20 * 60);
    expect(fw.state.pack.left.soc).toBeGreaterThan(0.95);
    expect(fw.telemetry().cells.left).toMatchObject({ present: false, docked: true });
    expect(fw.telemetry().heating).toBe(true);
    fw.insertCell('left');
    expect(fw.takeEvents()).toContainEqual({ type: 'cellInserted', cell: 'left' });
    expect(fw.telemetry().cells.left).toMatchObject({ present: true, docked: false });
  });

  it('lets the cells drift apart on 1.2.0 and pulls them together on 1.3.0', () => {
    const old = Firmware.createWorn({ epochS: MONDAY_NOON_S, version: '1.2.0' });
    const modern = Firmware.createWorn({ epochS: MONDAY_NOON_S, version: '1.3.0' });
    run(old, 3600);
    run(modern, 3600);
    expect(old.state.pack.left.soc - old.state.pack.right.soc).toBeGreaterThan(0.08);
    expect(Math.abs(modern.state.pack.left.soc - modern.state.pack.right.soc)).toBeLessThan(0.02);
  });
});

describe('firmware update', () => {
  const image = buildFirmwareImage('1.3.0');

  function stream(fw: Firmware, bytes: Uint8Array = image.bytes): void {
    for (let offset = 0; offset < bytes.length; offset += OTA_CHUNK_BYTES) {
      const code = fw.handle({ op: 'otaChunk', offset, data: bytes.subarray(offset, offset + OTA_CHUNK_BYTES) });
      if (code !== AckCode.Ok) throw new Error(`chunk at ${offset} refused with ${code}`);
    }
  }

  it('builds a valid image of the published size', () => {
    expect(image.bytes.length).toBe(FIRMWARE_IMAGE_BYTES);
    expect(checkFirmwareImage(image.bytes)).toEqual({ ok: true, version: parseVersion('1.3.0') });
    expect(buildFirmwareImage('1.3.0').crc32).toBe(image.crc32);
    expect(buildFirmwareImage('1.2.0').crc32).not.toBe(image.crc32);
    expect(() => buildFirmwareImage('9.9.9')).toThrow();
  });

  it('spots a damaged image', () => {
    const damaged = image.bytes.slice();
    damaged[5000] = (damaged[5000] ?? 0) ^ 1;
    expect(checkFirmwareImage(damaged)).toEqual({ ok: false, reason: 'checksum' });
    expect(checkFirmwareImage(image.bytes.slice(0, 100))).toEqual({ ok: false, reason: 'length' });
    expect(checkFirmwareImage(new Uint8Array(64))).toEqual({ ok: false, reason: 'magic' });
  });

  it('installs, restarts and comes back on the new version', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    expect(fw.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version })).toBe(AckCode.Ok);
    expect(fw.telemetry().otaActive).toBe(true);
    run(fw, 5);
    expect(fw.telemetry().heating).toBe(false);
    stream(fw);
    expect(fw.handle({ op: 'otaEnd' })).toBe(AckCode.Ok);
    expect(fw.takeEvents()).toContainEqual({ type: 'otaVerified' });
    expect(fw.isLinkUp()).toBe(false);
    expect(fw.handle({ op: 'setPower', on: true })).toBe(AckCode.Busy);
    const events = runCollecting(fw, 5);
    expect(events).toContainEqual({ type: 'rebooted', version: parseVersion('1.3.0') });
    expect(fw.isLinkUp()).toBe(true);
    expect(fw.info().version).toEqual(parseVersion('1.3.0'));
    expect(fw.features.balanceStrategy).toBe('balanced');
    // Heating picks up where it left off.
    run(fw, 120);
    expect(fw.telemetry().heating).toBe(true);
  });

  it('refuses commands that would interfere while an update is in flight', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version });
    expect(fw.handle({ op: 'setLevel', level: 2 })).toBe(AckCode.Busy);
    expect(fw.handle({ op: 'setWashLock', on: true })).toBe(AckCode.Busy);
    expect(fw.handle({ op: 'syncTime', epochS: MONDAY_NOON_S, tzOffsetMin: 0 })).toBe(AckCode.Ok);
    expect(fw.pressButton()).toBe(false);
  });

  it('rejects an image that arrives damaged and stays on the old version', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    const damaged = image.bytes.slice();
    damaged[12345] = (damaged[12345] ?? 0) ^ 0x10;
    fw.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version });
    stream(fw, damaged);
    expect(fw.handle({ op: 'otaEnd' })).toBe(AckCode.Checksum);
    expect(fw.takeEvents()).toContainEqual({ type: 'otaFailed', reason: 'checksum' });
    run(fw, 10);
    expect(fw.info().version).toEqual(parseVersion('1.2.0'));
    expect(fw.telemetry().otaActive).toBe(false);
    expect(fw.isLinkUp()).toBe(true);
  });

  it('rejects chunks out of order and an image that ends early', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version });
    expect(fw.handle({ op: 'otaChunk', offset: 200, data: image.bytes.subarray(200, 400) })).toBe(AckCode.Invalid);
    expect(fw.handle({ op: 'otaChunk', offset: 0, data: image.bytes.subarray(0, 200) })).toBe(AckCode.Ok);
    expect(fw.handle({ op: 'otaChunk', offset: 0, data: image.bytes.subarray(0, 200) })).toBe(AckCode.Invalid);
    expect(fw.handle({ op: 'otaEnd' })).toBe(AckCode.Invalid);
    expect(fw.takeEvents()).toContainEqual({ type: 'otaFailed', reason: 'size' });
    expect(fw.handle({ op: 'otaChunk', offset: 200, data: image.bytes.subarray(200, 400) })).toBe(AckCode.Invalid);
    expect(fw.handle({ op: 'otaEnd' })).toBe(AckCode.Invalid);
  });

  it('refuses to start below thirty percent on both cells', () => {
    const fw = freshFirmware({ cells: { left: { soc: 0.29 }, right: { soc: 0.12 } } });
    expect(fw.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version })).toBe(AckCode.LowBattery);
    expect(fw.takeEvents()).toContainEqual({ type: 'otaFailed', reason: 'battery' });
    const ok = freshFirmware({ cells: { left: { soc: 0.31 }, right: { soc: 0.05 } } });
    expect(ok.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version })).toBe(AckCode.Ok);
  });

  it('can be aborted', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version });
    expect(fw.handle({ op: 'otaAbort' })).toBe(AckCode.Ok);
    expect(fw.takeEvents()).toContainEqual({ type: 'otaFailed', reason: 'aborted' });
    expect(fw.handle({ op: 'setLevel', level: 2 })).toBe(AckCode.Ok);
  });

  it('knows which release is next and what it changes', () => {
    expect(availableUpdate(parseVersion('1.2.0'))?.version).toBe('1.3.0');
    expect(availableUpdate(parseVersion('1.3.0'))).toBeNull();
    expect(latestRelease().version).toBe('1.3.0');
    expect(findRelease('1.3.0')?.sizeBytes).toBe(FIRMWARE_IMAGE_BYTES);
    expect(findRelease('0.0.1')).toBeUndefined();
    expect(featuresFor(parseVersion('1.2.0'))).toMatchObject({ balanceStrategy: 'fixed', sleepEndsCleanly: false });
    expect(featuresFor(parseVersion('1.3.0'))).toMatchObject({ balanceStrategy: 'balanced', sleepEndsCleanly: true });
    expect(featuresFor(parseVersion('1.3.0')).restLearnTauS).toBe(featuresFor(parseVersion('1.2.0')).restLearnTauS / 2);
  });
});

describe('settings and memory', () => {
  it('stores the name, size and preferences', () => {
    const fw = freshFirmware();
    expect(fw.handle({ op: 'setName', name: '  Dan\'s Hoodie ' })).toBe(AckCode.Ok);
    expect(fw.handle({ op: 'setName', name: '   ' })).toBe(AckCode.Invalid);
    fw.handle({ op: 'setSize', size: 'L' });
    fw.handle({ op: 'setPrefs', autoOffWhenStill: false, buttonHaptics: true });
    expect(fw.info()).toMatchObject({ name: 'Dan\'s Hoodie', size: 'L' });
    expect(fw.state.prefs).toEqual({ autoOffWhenStill: false, buttonHaptics: true });
  });

  it('rejects a target outside the allowed range', () => {
    const fw = freshFirmware();
    expect(fw.handle({ op: 'setMode', mode: mode('auto', { targetF: 104 }), start: true })).toBe(AckCode.Invalid);
    expect(fw.telemetry().power).toBe(false);
  });

  it('takes the time from the phone', () => {
    const fw = freshFirmware();
    fw.handle({ op: 'syncTime', epochS: 1_800_000_000, tzOffsetMin: -480 });
    expect(fw.telemetry().rtcEpochS).toBe(1_800_000_000);
    expect(fw.state.tzOffsetMin).toBe(-480);
  });

  it('survives being saved and restored', () => {
    const fw = Firmware.createWorn({ epochS: MONDAY_NOON_S });
    fw.handle({ op: 'setLevel', level: 2 });
    run(fw, 300);
    const copy = Firmware.restore(JSON.parse(JSON.stringify(fw.snapshot())));
    expect(copy).not.toBeNull();
    if (!copy) return;
    run(fw, 300);
    run(copy, 300);
    expect(copy.telemetry()).toEqual(fw.telemetry());
  });

  it('refuses a snapshot it cannot trust', () => {
    expect(Firmware.restore(null)).toBeNull();
    expect(Firmware.restore({ schema: 999 })).toBeNull();
    expect(Firmware.restore({ schema: 1 })).toBeNull();
  });

  it('learns the resting temperature faster on 1.3.0', () => {
    const start = (version: string): Firmware => {
      const fw = freshFirmware({ version });
      fw.state.learnedRestC = 30;
      return fw;
    };
    const old = start('1.2.0');
    const modern = start('1.3.0');
    run(old, 600);
    run(modern, 600);
    const rest = old.telemetry().skinC;
    expect(modern.state.learnedRestC).toBeGreaterThan(old.state.learnedRestC);
    expect(modern.state.learnedRestC).toBeLessThan(rest);
  });

  it('ignores a zero or negative step', () => {
    const fw = freshFirmware();
    const before = fw.snapshot();
    fw.step(0);
    fw.step(-3);
    expect(fw.snapshot()).toEqual(before);
  });
});
