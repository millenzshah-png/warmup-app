import { describe, expect, it } from 'vitest';
import {
  AUTO_OFF_CHOICES_MIN,
  BUILT_IN_MODES,
  FIRST_CUSTOM_SLOT,
  MAX_CUSTOM_MODES,
  autoOffLabel,
  builtInMode,
  clampTargetF,
  createCustomMode,
  defaultModes,
  describeCustomMode,
  findMode,
  findModeBySlot,
  modeSummary,
  nextAutoOffChoice,
  normalizeMode,
  validateModeName,
  type CustomModeInput,
} from '../src/core/modes';
import { TARGET_MAX_F, TARGET_MIN_F } from '../src/core/spec';

const input = (over: Partial<CustomModeInput> = {}): CustomModeInput => ({
  name: 'Library',
  targetF: 94,
  zones: { L: true, R: true, B: false },
  pulse: true,
  outdoorBoost: false,
  autoOffMin: 90,
  ...over,
});

describe('built-in modes', () => {
  it('ships the five modes with the published targets', () => {
    const targets = Object.fromEntries(BUILT_IN_MODES.map((m) => [m.id, m.targetF]));
    expect(targets).toEqual({ auto: 93, sick: 95, commute: 96, outdoor: 97, sleep: 91 });
  });

  it('gives every built-in a unique slot below the custom range', () => {
    const slots = BUILT_IN_MODES.map((m) => m.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(Math.max(...slots)).toBeLessThan(FIRST_CUSTOM_SLOT);
  });

  it('keeps every target inside the allowed range', () => {
    for (const mode of BUILT_IN_MODES) {
      expect(mode.targetF).toBeGreaterThanOrEqual(TARGET_MIN_F);
      expect(mode.targetF).toBeLessThanOrEqual(TARGET_MAX_F);
    }
  });

  it('hands out independent copies', () => {
    const a = defaultModes();
    const b = defaultModes();
    const first = a[0];
    if (!first) throw new Error('no modes');
    first.targetF = 88;
    first.zones.L = false;
    expect(b[0]?.targetF).toBe(93);
    expect(b[0]?.zones.L).toBe(true);
    expect(builtInMode('auto').targetF).toBe(93);
  });

  it('gives Sleep a fade and Sick a slow ramp with a two hour limit', () => {
    expect(builtInMode('sleep').fadeOutMin).toBe(30);
    expect(builtInMode('sick').ramp).toBe('slow');
    expect(builtInMode('sick').autoOffMin).toBe(120);
    expect(builtInMode('commute').easeIndoors).toBe(true);
    expect(builtInMode('outdoor').tracksOutdoor).toBe(true);
  });
});

describe('normalizing a mode', () => {
  it('clamps the target', () => {
    expect(clampTargetF(120)).toBe(TARGET_MAX_F);
    expect(clampTargetF(10)).toBe(TARGET_MIN_F);
    expect(clampTargetF(93.4)).toBe(93);
  });

  it('drops a fade that has nothing to fade towards', () => {
    const mode = normalizeMode({ ...builtInMode('sleep'), autoOffMin: null });
    expect(mode.fadeOutMin).toBeNull();
  });

  it('never lets a fade outlast the session', () => {
    const mode = normalizeMode({ ...builtInMode('sleep'), autoOffMin: 20, fadeOutMin: 30 });
    expect(mode.fadeOutMin).toBe(20);
  });

  it('trims the name', () => {
    expect(normalizeMode({ ...builtInMode('auto'), name: '  Desk  ' }).name).toBe('Desk');
  });
});

describe('custom modes', () => {
  it('creates a mode in the first free slot', () => {
    const result = createCustomMode(input(), defaultModes());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode.id).toBe('custom-1');
    expect(result.mode.slot).toBe(FIRST_CUSTOM_SLOT);
    expect(result.mode.builtIn).toBe(false);
    expect(result.mode.zones).toEqual({ L: true, R: true, B: false });
    expect(result.mode.autoOffMin).toBe(90);
  });

  it('reuses a slot freed by a deleted mode', () => {
    const modes = defaultModes();
    const a = createCustomMode(input({ name: 'A' }), modes);
    if (!a.ok) throw new Error(a.error);
    const b = createCustomMode(input({ name: 'B' }), [...modes, a.mode]);
    if (!b.ok) throw new Error(b.error);
    expect(b.mode.slot).toBe(FIRST_CUSTOM_SLOT + 1);
    const c = createCustomMode(input({ name: 'C' }), [...modes, b.mode]);
    if (!c.ok) throw new Error(c.error);
    expect(c.mode.slot).toBe(FIRST_CUSTOM_SLOT);
    expect(c.mode.id).toBe('custom-1');
  });

  it('refuses an empty or duplicate name', () => {
    expect(createCustomMode(input({ name: '   ' }), defaultModes())).toEqual({ ok: false, error: 'Give the mode a name.' });
    const duplicate = createCustomMode(input({ name: 'auto' }), defaultModes());
    expect(duplicate.ok).toBe(false);
  });

  it('refuses a mode with no zones', () => {
    const result = createCustomMode(input({ zones: { L: false, R: false, B: false } }), defaultModes());
    expect(result).toEqual({ ok: false, error: 'Switch on at least one zone.' });
  });

  it('caps the number of custom modes', () => {
    let modes = defaultModes();
    for (let i = 0; i < MAX_CUSTOM_MODES; i += 1) {
      const result = createCustomMode(input({ name: `Mode ${i}` }), modes);
      if (!result.ok) throw new Error(result.error);
      modes = [...modes, result.mode];
    }
    expect(createCustomMode(input({ name: 'One more' }), modes).ok).toBe(false);
  });

  it('describes itself', () => {
    expect(describeCustomMode(input())).toBe('Two zones, pulse heat, off after 90 minutes.');
    expect(
      describeCustomMode(input({ zones: { L: true, R: true, B: true }, pulse: false, outdoorBoost: true, autoOffMin: null })),
    ).toBe('All three zones, outdoor boost.');
  });
});

describe('mode helpers', () => {
  it('validates names against the others but not itself', () => {
    const modes = defaultModes();
    expect(validateModeName('Sick', modes)).toMatch(/already/);
    expect(validateModeName('Sick', modes, 'sick')).toBeNull();
    expect(validateModeName('A name that is far too long', modes)).toMatch(/16/);
  });

  it('labels and cycles the auto-off choices', () => {
    expect(autoOffLabel(null)).toBe('Never');
    expect(autoOffLabel(120)).toBe('After 2 hours');
    expect(autoOffLabel(90)).toBe('After 90 minutes');
    let value: number | null = null;
    const seen: (number | null)[] = [];
    for (let i = 0; i < AUTO_OFF_CHOICES_MIN.length; i += 1) {
      value = nextAutoOffChoice(value);
      seen.push(value);
    }
    expect(seen[seen.length - 1]).toBeNull();
    expect(new Set(seen).size).toBe(AUTO_OFF_CHOICES_MIN.length);
  });

  it('finds modes by id and slot and summarises them', () => {
    const modes = defaultModes();
    expect(findMode(modes, 'sleep')?.name).toBe('Sleep');
    expect(findModeBySlot(modes, 2)?.id).toBe('commute');
    expect(findMode(modes, 'nope')).toBeUndefined();
    expect(modeSummary(builtInMode('auto'), 'F')).toBe('Auto · 93°F');
    expect(modeSummary(builtInMode('auto'), 'C')).toBe('Auto · 33.9°C');
  });
});
