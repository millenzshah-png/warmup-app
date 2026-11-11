import { afterEach, describe, expect, it } from 'vitest';
import { activeProfile, combinedCharge, currentMode, homeStatus, isConnected, nowEpochS, runtimeLabel, updateReadiness, zoneReading } from '../src/core/app/selectors';
import { APP_STORAGE_KEY } from '../src/core/app/state';
import { Firmware } from '../src/core/firmware/firmware';
import { memoryStorage } from '../src/core/store/persistence';
import { FAULT_SENSOR } from '../src/core/thermal/safety';
import { MONDAY_NOON_S, disposeRigs, makeRig, pairedRig } from './helpers';

afterEach(disposeRigs);

describe('first run', () => {
  it('starts with nothing paired', () => {
    const { app } = makeRig();
    app.start();
    const s = app.store.get();
    expect(s).toMatchObject({ onboarded: false, hoodie: null, link: 'idle' });
    expect(homeStatus(s).line).toBe('No hoodie paired');
    expect(isConnected(s)).toBe(false);
    expect(runtimeLabel(s)).toBe('—');
  });

  it('finds the hoodie, connects and finishes setup', async () => {
    const { app, sim, settle } = makeRig();
    app.start();
    await app.scan();
    const found = app.store.get().found;
    expect(found).toHaveLength(1);
    expect(app.store.get().link).toBe('idle');

    const result = await app.connect(found[0]!.id);
    expect(result.ok).toBe(true);
    expect(app.store.get().link).toBe('connected');
    expect(app.store.get().hoodie).toMatchObject({ serial: 'WU26M00417', version: '1.2.0', size: 'M' });

    await app.completeSetup({ name: 'Study Hoodie', size: 'L', unit: 'C' });
    await settle();
    const s = app.store.get();
    expect(s.onboarded).toBe(true);
    expect(s.settings.unit).toBe('C');
    expect(s.hoodie).toMatchObject({ name: 'Study Hoodie', size: 'L' });
    expect(sim.firmware.state.name).toBe('Study Hoodie');
    expect(sim.firmware.state.size).toBe('L');
    expect(s.history.sample).toBe(true);
    expect(s.history.days).toHaveLength(14);
  });

  it('seeds the sample history even when pairing took a while', async () => {
    const { app, sim, settle } = makeRig();
    app.start();
    await app.scan();
    await app.connect(app.store.get().found[0]!.id);
    for (let i = 0; i < 90; i += 1) sim.advance(1);
    await settle();
    expect(app.store.get().history.days).toEqual([]);
    await app.completeSetup({ name: 'My Hoodie', size: 'M', unit: 'F' });
    expect(app.store.get().history.sample).toBe(true);
    expect(app.store.get().history.days).toHaveLength(14);
  });

  it('gives the hoodie the time, the preferences and the schedule on connecting', async () => {
    const { sim } = await pairedRig();
    const fw = sim.firmware.state;
    expect(fw.rtcEpochS).toBeGreaterThanOrEqual(MONDAY_NOON_S);
    expect(fw.prefs).toEqual({ autoOffWhenStill: true, buttonHaptics: false });
    expect(fw.schedule).toMatchObject({ enabled: false, minuteOfDay: 440, preheatMin: 10 });
    expect(fw.schedule?.mode.slot).toBe(2);
    expect(fw.context.valid).toBe(true);
  });

  it('falls back to a default name when setup leaves it blank', async () => {
    const { app, sim } = makeRig();
    app.start();
    await app.scan();
    await app.connect(app.store.get().found[0]!.id);
    await app.completeSetup({ name: '   ', size: 'M', unit: 'F' });
    expect(sim.firmware.state.name).toBe('My Hoodie');
  });

  it('reports a failed scan and a failed connection in words', async () => {
    const { app, sim } = makeRig();
    app.start();
    sim.setCell('left', 'out');
    sim.setCell('right', 'out');
    await app.scan();
    expect(app.store.get().found).toEqual([]);
    expect(app.store.get().scanMessage).toMatch(/No hoodie found/);
    const result = await app.connect('WU26M00417');
    expect(result.ok).toBe(false);
    expect(app.store.get().link).toBe('idle');
    expect(app.store.get().scanMessage).toMatch(/not responding/);
  });

  it('can be used without pairing', () => {
    const { app } = makeRig();
    app.start();
    app.skipSetup();
    expect(app.store.get()).toMatchObject({ onboarded: true, hoodie: null, link: 'idle' });
  });
});

describe('coming back later', () => {
  it('remembers the setup and reconnects by itself', async () => {
    const first = await pairedRig();
    first.app.setUnit('C');
    first.app.dispose();
    await first.sim.disconnect();

    const second = makeRig({ storage: first.storage });
    expect(second.app.store.get().onboarded).toBe(true);
    expect(second.app.store.get().settings.unit).toBe('C');
    second.app.start();
    expect(second.app.store.get().link).toBe('connecting');
    await second.settle();
    await second.settle();
    expect(second.app.store.get().link).toBe('connected');
    second.sim.advance(1);
    expect(second.app.store.get().telemetry).not.toBeNull();
  });

  it('starts clean if the saved state is damaged', () => {
    const storage = memoryStorage({ [APP_STORAGE_KEY]: '{"schema":1,"data":"garbage"}' });
    const { app } = makeRig({ storage });
    expect(app.store.get().onboarded).toBe(false);
  });

  it('forgets everything on request', async () => {
    const { app, sim, storage } = await pairedRig();
    app.addToBag({ color: 'black', graphic: 'plain', size: 'M', power: 'standard' });
    await app.forgetHoodie();
    const s = app.store.get();
    expect(s).toMatchObject({ onboarded: false, hoodie: null, link: 'idle', telemetry: null, bag: [] });
    expect(sim.connected).toBe(false);
    expect(makeRig({ storage }).app.store.get().onboarded).toBe(false);
  });
});

describe('heat controls', () => {
  it('shows what the hoodie is doing', async () => {
    const { app } = await pairedRig();
    const s = app.store.get();
    expect(isConnected(s)).toBe(true);
    expect(homeStatus(s)).toMatchObject({ line: 'Auto · Medium', tone: 'hot' });
    expect(runtimeLabel(s)).toMatch(/^3h \d\dm$/);
    expect(combinedCharge(s.telemetry)).toBeCloseTo(0.78, 2);
    expect(zoneReading(s, 'L')).toMatch(/^Panel at \d+°F$/);
    expect(currentMode(s).id).toBe('auto');
    expect(nowEpochS(s)).toBe(s.telemetry?.rtcEpochS);
  });

  it('switches heat off and on', async () => {
    const { app } = await pairedRig();
    await app.togglePower();
    expect(app.store.get().telemetry?.power).toBe(false);
    expect(homeStatus(app.store.get())).toMatchObject({ line: 'Heating off', tone: 'muted' });
    expect(runtimeLabel(app.store.get())).toBe('—');
    expect(zoneReading(app.store.get(), 'B')).toMatch(/^Standing by/);
    await app.togglePower();
    expect(app.store.get().telemetry?.power).toBe(true);
  });

  it('turns heat on when a level is picked', async () => {
    const { app } = await pairedRig();
    await app.setPower(false);
    await app.setLevel(2);
    const t = app.store.get().telemetry;
    expect(t?.level).toBe(2);
    expect(t?.power).toBe(true);
    expect(activeProfile(app.store.get()).level).toBe(2);
    expect(homeStatus(app.store.get()).line).toBe('Auto · High');
  });

  it('switches mode and applies that mode\'s target and zones', async () => {
    const { app, sim } = await pairedRig();
    const result = await app.selectMode('sick');
    expect(result.ok).toBe(true);
    const s = app.store.get();
    expect(s.telemetry?.modeSlot).toBe(1);
    expect(currentMode(s).id).toBe('sick');
    expect(activeProfile(s).activeModeId).toBe('sick');
    expect(sim.firmware.state.mode).toMatchObject({ targetF: 95, ramp: 'slow', autoOffMin: 120 });
    expect(homeStatus(s).hint).toBe('Off in 2h 00m');
    expect((await app.selectMode('nope')).ok).toBe(false);
  });

  it('toggles zones one at a time', async () => {
    const { app } = await pairedRig();
    await app.toggleZone('B');
    expect(app.store.get().telemetry?.zonesEnabled).toEqual({ L: true, R: true, B: false });
    expect(zoneReading(app.store.get(), 'B')).toBe('Off');
    await app.toggleZone('B');
    expect(app.store.get().telemetry?.zonesEnabled.B).toBe(true);
    await app.setZone('L', false);
    await app.setZone('R', false);
    await app.setZone('B', false);
    expect(homeStatus(app.store.get()).line).toBe('Auto · No zones on');
  });

  it('follows the hoodie when the hem button is pressed', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.pressButton();
    await settle();
    expect(app.store.get().telemetry?.power).toBe(false);
    expect(app.store.get().toasts.at(-1)).toMatchObject({ title: 'Heating off', body: 'From the button on the hem.' });
  });

  it('explains a refusal instead of failing silently', async () => {
    const { app } = await pairedRig();
    await app.setWashLock(true);
    expect(homeStatus(app.store.get())).toMatchObject({ line: 'Wash mode', tone: 'muted' });
    const result = await app.setPower(true);
    expect(result).toEqual({ ok: false, error: 'Wash mode is on. Turn it off to heat again.' });
    expect(app.store.get().toasts.at(-1)).toMatchObject({ tone: 'warn', title: 'Wash mode is on. Turn it off to heat again.' });
    await app.setWashLock(false);
    expect((await app.setPower(true)).ok).toBe(true);
  });

  it('keeps at most three notices and lets them be dismissed', async () => {
    const { app } = await pairedRig();
    for (let i = 0; i < 5; i += 1) app.notify({ tone: 'info', title: `Notice ${i}`, body: null });
    const toasts = app.store.get().toasts;
    expect(toasts.map((t) => t.title)).toEqual(['Notice 2', 'Notice 3', 'Notice 4']);
    app.dismissToast(toasts[1]!.id);
    expect(app.store.get().toasts.map((t) => t.title)).toEqual(['Notice 2', 'Notice 4']);
  });

  it('hints when the level is the limit', async () => {
    const { app, sim, settle } = await pairedRig();
    await app.selectMode('sick');
    expect(homeStatus(app.store.get()).hint).toBe('Off in 2h 00m');
    for (let i = 0; i < 60; i += 1) sim.advance(30);
    await settle();
    const status = homeStatus(app.store.get());
    expect(status.line).toBe('Sick · Medium');
    expect(status.hint).toBe("At Medium's limit. High gets closer to 95°F.");
    await app.setLevel(2);
    for (let i = 0; i < 60; i += 1) sim.advance(30);
    await settle();
    expect(homeStatus(app.store.get()).hint).toMatch(/^Off in/);
  });
});

describe('modes', () => {
  it('saves an edit to the running mode and tells the hoodie', async () => {
    const { app, sim } = await pairedRig();
    const draft = app.draftMode('auto')!;
    draft.targetF = 95;
    draft.ramp = 'fast';
    await app.saveMode(draft, false);
    expect(sim.firmware.state.mode).toMatchObject({ targetF: 95, ramp: 'fast' });
    expect(activeProfile(app.store.get()).modes.find((m) => m.id === 'auto')?.targetF).toBe(95);
  });

  it('saves an edit to another mode without disturbing the hoodie', async () => {
    const { app, sim } = await pairedRig();
    const draft = app.draftMode('sleep')!;
    draft.targetF = 90;
    await app.saveMode(draft, false);
    expect(sim.firmware.state.mode.slot).toBe(0);
    expect(activeProfile(app.store.get()).modes.find((m) => m.id === 'sleep')?.targetF).toBe(90);
  });

  it('starts a mode straight from its detail screen', async () => {
    const { app, sim } = await pairedRig();
    const draft = app.draftMode('sick')!;
    draft.targetF = 96;
    draft.zones = { L: true, R: true, B: false };
    await app.saveMode(draft, true);
    expect(sim.firmware.state.mode).toMatchObject({ slot: 1, targetF: 96 });
    expect(app.store.get().telemetry?.zonesEnabled).toEqual({ L: true, R: true, B: false });
    expect(activeProfile(app.store.get()).activeModeId).toBe('sick');
  });

  it('keeps edits out of reach of the saved copy until they are saved', async () => {
    const { app } = await pairedRig();
    const draft = app.draftMode('auto')!;
    draft.targetF = 88;
    draft.zones.L = false;
    const saved = activeProfile(app.store.get()).modes.find((m) => m.id === 'auto');
    expect(saved?.targetF).toBe(93);
    expect(saved?.zones.L).toBe(true);
    expect(app.draftMode('ghost')).toBeNull();
  });

  it('creates a custom mode and switches to it', async () => {
    const { app, sim } = await pairedRig();
    const result = await app.createMode({
      name: 'Library',
      targetF: 94,
      zones: { L: true, R: true, B: false },
      pulse: true,
      outdoorBoost: false,
      autoOffMin: 90,
    });
    expect(result.ok).toBe(true);
    const s = app.store.get();
    expect(currentMode(s).name).toBe('Library');
    expect(s.telemetry?.modeSlot).toBe(16);
    expect(sim.firmware.state.mode).toMatchObject({ targetF: 94, autoOffMin: 90 });
    expect(homeStatus(s).line).toBe('Library · Medium');
  });

  it('refuses a duplicate name without touching anything', async () => {
    const { app } = await pairedRig();
    const before = app.store.get().profiles;
    const result = await app.createMode({ name: 'Sleep', targetF: 94, zones: { L: true, R: true, B: true }, pulse: true, outdoorBoost: false, autoOffMin: null });
    expect(result.ok).toBe(false);
    expect(app.store.get().profiles).toBe(before);
  });

  it('deletes a custom mode and falls back to Auto if it was running', async () => {
    const { app, sim } = await pairedRig();
    const created = await app.createMode({ name: 'Library', targetF: 94, zones: { L: true, R: true, B: true }, pulse: true, outdoorBoost: false, autoOffMin: null });
    if (!created.ok) throw new Error(created.error);
    expect((await app.deleteMode(created.mode.id)).ok).toBe(true);
    const s = app.store.get();
    expect(activeProfile(s).modes.some((m) => m.id === created.mode.id)).toBe(false);
    expect(sim.firmware.state.mode.slot).toBe(0);
    expect(currentMode(s).id).toBe('auto');
    expect(s.telemetry?.power).toBe(true);
  });

  it('will not delete a built-in mode', async () => {
    const { app } = await pairedRig();
    expect(await app.deleteMode('sick')).toEqual({ ok: false, error: 'Built-in modes cannot be deleted.' });
    expect(activeProfile(app.store.get()).modes).toHaveLength(5);
  });
});

describe('schedule and settings', () => {
  it('pushes schedule changes to the hoodie', async () => {
    const { app, sim } = await pairedRig();
    await app.updateSchedule({ enabled: true, minuteOfDay: 8 * 60, preheatMin: 15 });
    expect(sim.firmware.state.schedule).toMatchObject({ enabled: true, minuteOfDay: 480, preheatMin: 15 });
    expect(app.store.get().schedule).toMatchObject({ enabled: true, minuteOfDay: 480, preheatMin: 15 });
    expect(app.store.get().telemetry?.scheduleArmed).toBe(true);
  });

  it('sends the edited Commute mode along with the schedule', async () => {
    const { app, sim } = await pairedRig();
    const draft = app.draftMode('commute')!;
    draft.targetF = 94;
    await app.saveMode(draft, false);
    expect(sim.firmware.state.schedule?.mode.targetF).toBe(94);
  });

  it('runs the preheat the hoodie was given', async () => {
    const { app, sim, settle } = await pairedRig();
    await app.setPower(false);
    await app.updateSchedule({ enabled: true });
    sim.jumpClockTo(7 * 60 + 9);
    sim.advance(90);
    await settle();
    const s = app.store.get();
    expect(s.telemetry?.preheating).toBe(true);
    expect(homeStatus(s).line).toBe('Commute · Preheating');
    expect(s.toasts.some((t) => t.title === 'Preheat started')).toBe(true);
    expect(activeProfile(s).activeModeId).toBe('commute');
  });

  it('changes the unit without talking to the hoodie', async () => {
    const { app } = await pairedRig();
    app.setUnit('C');
    expect(app.store.get().settings.unit).toBe('C');
    expect(zoneReading(app.store.get(), 'L')).toMatch(/°C$/);
  });

  it('sends hoodie preferences but keeps notification choice to itself', async () => {
    const { app, sim } = await pairedRig();
    await app.setSetting('autoOffWhenStill', false);
    await app.setSetting('buttonHaptics', true);
    expect(sim.firmware.state.prefs).toEqual({ autoOffWhenStill: false, buttonHaptics: true });
    await app.setSetting('notifications', false);
    expect(app.store.get().settings.notifications).toBe(false);
  });

  it('stays quiet when notifications are off', async () => {
    const { app, sim, settle } = await pairedRig();
    await app.setSetting('notifications', false);
    const before = app.store.get().toasts.length;
    sim.pressButton();
    await settle();
    expect(app.store.get().toasts.length).toBe(before);
  });

  it('renames the hoodie', async () => {
    const { app, sim } = await pairedRig();
    expect((await app.renameHoodie('  Gym Hoodie ')).ok).toBe(true);
    expect(sim.firmware.state.name).toBe('Gym Hoodie');
    expect(app.store.get().hoodie?.name).toBe('Gym Hoodie');
    expect((await app.renameHoodie('  ')).ok).toBe(false);
  });

  it('tracks the wash checklist', async () => {
    const { app } = await pairedRig();
    app.toggleWashStep(0);
    app.toggleWashStep(2);
    expect(app.store.get().washChecklist).toEqual([true, false, true, false]);
    app.toggleWashStep(0);
    expect(app.store.get().washChecklist).toEqual([false, false, true, false]);
  });
});

describe('profiles', () => {
  it('hands the hoodie to someone else and applies their mode', async () => {
    const { app, sim } = await pairedRig();
    await app.selectProfile('p-3');
    const s = app.store.get();
    expect(s.activeProfileId).toBe('p-3');
    expect(sim.firmware.state.mode).toMatchObject({ slot: 1, targetF: 95 });
    expect(currentMode(s).id).toBe('sick');
    await app.selectProfile('p-2');
    expect(sim.firmware.state.mode).toMatchObject({ slot: 0, targetF: 91 });
  });

  it('keeps each person\'s edits to themselves', async () => {
    const { app } = await pairedRig();
    const draft = app.draftMode('auto')!;
    draft.targetF = 96;
    await app.saveMode(draft, false);
    await app.selectProfile('p-3');
    expect(activeProfile(app.store.get()).modes.find((m) => m.id === 'auto')?.targetF).toBe(93);
    await app.selectProfile('p-owner');
    expect(activeProfile(app.store.get()).modes.find((m) => m.id === 'auto')?.targetF).toBe(96);
  });

  it('does not start heating just because the profile changed', async () => {
    const { app } = await pairedRig();
    await app.setPower(false);
    await app.selectProfile('p-3');
    expect(app.store.get().telemetry?.power).toBe(false);
  });

  it('adds, renames and removes people', async () => {
    const { app } = await pairedRig();
    expect(app.addProfile('Dan').ok).toBe(true);
    expect(app.addProfile('dan')).toMatchObject({ ok: false });
    const dan = app.store.get().profiles.find((p) => p.name === 'Dan')!;
    expect(app.renameProfile(dan.id, 'Dan Huang').ok).toBe(true);
    expect(app.store.get().profiles.find((p) => p.id === dan.id)).toMatchObject({ name: 'Dan Huang', initials: 'DH' });
    expect(app.renameProfile(dan.id, 'Dad').ok).toBe(false);
    expect((await app.deleteProfile(dan.id)).ok).toBe(true);
    expect(app.store.get().profiles).toHaveLength(3);
  });

  it('never removes the owner, and falls back to them when the active person goes', async () => {
    const { app } = await pairedRig();
    expect((await app.deleteProfile('p-owner')).ok).toBe(false);
    await app.selectProfile('p-2');
    await app.deleteProfile('p-2');
    expect(app.store.get().activeProfileId).toBe('p-owner');
    expect(app.store.get().profiles.map((p) => p.id)).toEqual(['p-owner', 'p-3']);
  });
});

describe('safety', () => {
  it('raises the overheat sheet and marks it cleared when the panel cools', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setCovered('B', true);
    sim.advance(60);
    await settle();
    let s = app.store.get();
    expect(s.overheat).toMatchObject({ zone: 'B', cleared: false });
    expect(s.overheat?.peakC).toBeGreaterThanOrEqual(45);
    expect(zoneReading(s, 'B')).toMatch(/^Cooling down/);
    expect(homeStatus(s).line).toBe('Auto · Medium');

    sim.setCovered('B', false);
    sim.advance(200);
    await settle();
    s = app.store.get();
    expect(s.overheat).toMatchObject({ zone: 'B', cleared: true });

    await app.resolveOverheat('resume');
    expect(app.store.get().overheat).toBeNull();
    expect(app.store.get().telemetry?.zoneSafety.B).toBe('ok');
  });

  it('switches the zone off for the day when asked, and back on from Zones', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setCovered('B', true);
    sim.advance(60);
    await settle();
    await app.resolveOverheat('offToday');
    sim.setCovered('B', false);
    sim.advance(5);
    await settle();
    expect(app.store.get().telemetry?.zoneSafety.B).toBe('lockout');
    expect(zoneReading(app.store.get(), 'B')).toBe('Off for today');
    expect(app.store.get().toasts.some((t) => t.title === 'Upper back is off for today')).toBe(true);

    await app.setZone('B', true);
    sim.advance(2);
    await settle();
    expect(app.store.get().telemetry?.zoneSafety.B).toBe('ok');
  });

  it('says "heat paused" when every enabled zone is cut off', async () => {
    const { app, sim, settle } = await pairedRig();
    await app.setZone('L', false);
    await app.setZone('R', false);
    sim.setCovered('B', true);
    sim.advance(90);
    await settle();
    expect(homeStatus(app.store.get())).toMatchObject({ line: 'Heat paused', tone: 'warn' });
  });

  it('surfaces a fault and clears it', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setWorld({ sensorFault: true });
    sim.advance(3);
    await settle();
    expect(app.store.get().fault).toBe(FAULT_SENSOR);
    expect(homeStatus(app.store.get())).toMatchObject({ line: 'Heating disabled', tone: 'warn' });
    sim.setWorld({ sensorFault: false });
    await app.clearFault();
    sim.advance(2);
    await settle();
    expect(app.store.get().fault).toBeNull();
    expect(app.store.get().toasts.some((t) => t.title === 'Fault cleared')).toBe(true);
  });
});

describe('cells and the link', () => {
  it('announces a pulled cell and carries on', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setCell('left', 'out');
    await settle();
    const s = app.store.get();
    expect(s.toasts.at(-1)).toMatchObject({ title: 'Left cell out', body: 'Running on the other cell.' });
    expect(s.telemetry?.cells.left.present).toBe(false);
    expect(combinedCharge(s.telemetry)).toBeCloseTo(0.74, 2);
    expect(s.link).toBe('connected');
  });

  it('reconnects by itself after losing both cells', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setCell('left', 'out');
    sim.setCell('right', 'out');
    await settle();
    expect(app.store.get().link).toBe('reconnecting');
    expect(homeStatus(app.store.get())).toMatchObject({ line: 'Reconnecting', hint: 'Check that a cell is snapped in.' });
    expect(zoneReading(app.store.get(), 'L')).toBe('Not connected');
    sim.setCell('right', 'in');
    for (let i = 0; i < 10; i += 1) await settle();
    expect(app.store.get().link).toBe('connected');
    sim.advance(1);
    expect(app.store.get().telemetry?.power).toBe(false);
  });

  it('refuses commands politely while disconnected', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setCell('left', 'out');
    sim.setCell('right', 'out');
    await settle();
    const result = await app.setPower(true);
    expect(result).toEqual({ ok: false, error: 'The hoodie is not connected.' });
    expect(combinedCharge(null)).toBeNull();
  });

  it('warns when the cells run low', async () => {
    const { app, sim, settle } = await pairedRig();
    sim.setCellCharge('left', 0.19);
    sim.setCellCharge('right', 0.19);
    sim.advance(2);
    await settle();
    expect(app.store.get().toasts.some((t) => t.title === 'Cells at 19%')).toBe(true);
    expect(app.store.get().telemetry?.lowBattery).toBe(true);
  });
});

describe('history', () => {
  it('records heating time as it happens', async () => {
    const { app, sim, settle } = await pairedRig();
    const dayTotal = (): number => app.store.get().history.days.at(-1)?.heatS ?? 0;
    const before = dayTotal();
    for (let i = 0; i < 600; i += 1) sim.advance(1);
    await settle();
    expect(dayTotal() - before).toBeGreaterThan(590);
    expect(dayTotal() - before).toBeLessThan(605);
  });

  it('records nothing while heat is off', async () => {
    const { app, sim, settle } = await pairedRig();
    await app.setPower(false);
    sim.advance(30);
    const before = app.store.get().history;
    for (let i = 0; i < 300; i += 1) sim.advance(1);
    await settle();
    expect(app.store.get().history).toBe(before);
  });

  it('can drop the sample data', async () => {
    const { app } = await pairedRig();
    app.clearHistory();
    expect(app.store.get().history).toEqual({ days: [], sample: false });
  });
});

describe('firmware update', () => {
  it('knows when an update is available and when it cannot start', async () => {
    const { app, sim, settle } = await pairedRig();
    expect(updateReadiness(app.store.get())).toMatchObject({ release: { version: '1.3.0' }, blocker: null });
    sim.setCellCharge('left', 0.2);
    sim.setCellCharge('right', 0.25);
    sim.advance(1);
    await settle();
    expect(updateReadiness(app.store.get()).blocker).toBe('One cell needs at least 30% to install.');
    const result = await app.startUpdate();
    expect(result.ok).toBe(false);
    expect(app.store.get().update.stage).toBe('idle');
  });

  it('downloads, installs, restarts and ends on the new version', async () => {
    const { app, sim } = await pairedRig();
    const stages: string[] = [];
    app.store.subscribe(() => {
      const stage = app.store.get().update.stage;
      if (stages.at(-1) !== stage) stages.push(stage);
    });
    const result = await app.startUpdate();
    expect(result).toEqual({ ok: true });
    expect(stages).toEqual(['downloading', 'installing', 'verifying', 'restarting', 'done']);
    const s = app.store.get();
    expect(s.update).toMatchObject({ stage: 'done', percent: 100, error: null, targetVersion: '1.3.0' });
    expect(s.hoodie?.version).toBe('1.3.0');
    expect(s.link).toBe('connected');
    expect(sim.firmware.features.balanceStrategy).toBe('balanced');
    expect(updateReadiness(s).release).toBeNull();
    expect(s.toasts.at(-1)).toMatchObject({ tone: 'good', title: 'Firmware 1.3.0 installed' });
    expect((await app.startUpdate()).ok).toBe(false);
    app.resetUpdate();
    expect(app.store.get().update.stage).toBe('idle');
  });

  it('only ever moves the progress ring forward', async () => {
    const { app } = await pairedRig();
    const seen: number[] = [];
    app.store.subscribe(() => seen.push(app.store.get().update.percent));
    await app.startUpdate();
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] ?? 0);
    expect(seen.at(-1)).toBe(100);
  });

  it('reports a failure and leaves the hoodie on the old version', async () => {
    const { app, sim } = await pairedRig();
    const off = app.store.subscribe(() => {
      const u = app.store.get().update;
      if (u.stage === 'installing' && u.percent >= 50 && sim.firmware.state.ota) {
        off();
        sim.setCell('left', 'out');
        sim.setCell('right', 'out');
      }
    });
    const result = await app.startUpdate();
    expect(result.ok).toBe(false);
    expect(app.store.get().update).toMatchObject({ stage: 'failed' });
    expect(app.store.get().update.error).toMatch(/still on 1\.2\.0/);
    expect(sim.firmware.info().version).toEqual({ major: 1, minor: 2, patch: 0 });
  });
});

describe('the bag', () => {
  it('adds, changes and removes lines and saves them', async () => {
    const { app, storage } = await pairedRig();
    const config = { color: 'bone', graphic: 'orbit', size: 'L', power: 'spare' } as const;
    app.addToBag(config);
    app.addToBag(config);
    const line = app.store.get().bag[0]!;
    expect(line.quantity).toBe(2);
    app.setBagQuantity(line.id, 5);
    expect(app.store.get().bag[0]?.quantity).toBe(5);
    expect(makeRig({ storage }).app.store.get().bag[0]?.quantity).toBe(5);
    app.removeBagLine(line.id);
    expect(app.store.get().bag).toEqual([]);
  });
});

describe('a different starting hoodie', () => {
  it('pairs with a brand new one that is switched off', async () => {
    const firmware = Firmware.create({ epochS: MONDAY_NOON_S });
    const { app } = await pairedRig({ firmware });
    const s = app.store.get();
    expect(s.telemetry?.power).toBe(false);
    expect(combinedCharge(s.telemetry)).toBe(1);
    expect(homeStatus(s).line).toBe('Heating off');
  });
});
