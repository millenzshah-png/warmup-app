import { describe, expect, it } from 'vitest';
import { noticeForEvent } from '../src/core/app/messages';
import {
  APP_SCHEMA,
  WASH_STEP_COUNT,
  defaultPersistedState,
  initialAppState,
  persistedChanged,
  selectPersisted,
  validatePersisted,
} from '../src/core/app/state';
import {
  MAX_PROFILES,
  activeMode,
  cloneProfile,
  createProfile,
  initialsOf,
  profileSummary,
  seedProfiles,
  validateProfileName,
} from '../src/core/profiles';
import { MAX_LINE_QUANTITY, addToBag, bagCount, bagTotalUsd, lineTotalUsd, removeLine, setQuantity } from '../src/core/shop/bag';
import {
  BASE_PRICE_USD,
  COLORS,
  GRAPHICS,
  POWER_OPTIONS,
  SHOP_SIZES,
  configurationSummary,
  defaultConfiguration,
  findColor,
  findGraphic,
  findPower,
  priceLabel,
  priceOf,
} from '../src/core/shop/catalog';
import { createPersistence, memoryStorage } from '../src/core/store/persistence';
import { createStore, shallowEqual } from '../src/core/store/store';

describe('profiles', () => {
  it('starts with an owner and two others', () => {
    const profiles = seedProfiles();
    expect(profiles.map((p) => p.name)).toEqual(['Millen', 'Aryan', 'Dad']);
    expect(profiles.filter((p) => p.owner)).toHaveLength(1);
    expect(profileSummary(profiles[0]!, 'F')).toBe('Auto · 93°F');
    expect(profileSummary(profiles[1]!, 'F')).toBe('Runs warm · 91°F');
    expect(profileSummary(profiles[2]!, 'F')).toBe('Sick mode favorite · 95°F');
    expect(profileSummary(profiles[0]!, 'C')).toBe('Auto · 33.9°C');
  });

  it('gives each profile its own modes', () => {
    const [a, b] = seedProfiles();
    a!.modes[0]!.targetF = 99;
    expect(b!.modes[0]!.targetF).toBe(91);
    const copy = cloneProfile(a!);
    copy.modes[0]!.zones.L = false;
    expect(a!.modes[0]!.zones.L).toBe(true);
  });

  it('makes initials from one or two words', () => {
    expect(initialsOf('Dan Huang')).toBe('DH');
    expect(initialsOf('millen')).toBe('MI');
    expect(initialsOf('  Mary Jane Watson ')).toBe('MJ');
    expect(initialsOf('')).toBe('?');
  });

  it('adds a profile with factory modes', () => {
    const result = createProfile('  Dan ', seedProfiles());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({ name: 'Dan', initials: 'DA', owner: false, activeModeId: 'auto', level: 1 });
    expect(activeMode(result.profile).targetF).toBe(93);
    expect(seedProfiles().some((p) => p.id === result.profile.id)).toBe(false);
  });

  it('refuses blank, duplicate and overlong names', () => {
    const profiles = seedProfiles();
    expect(validateProfileName('', profiles)).toBe('Enter a name.');
    expect(validateProfileName('dad', profiles)).toMatch(/already/);
    expect(validateProfileName('Dad', profiles, 'p-3')).toBeNull();
    expect(validateProfileName('x'.repeat(21), profiles)).toMatch(/20/);
    expect(createProfile('Aryan', profiles).ok).toBe(false);
  });

  it('stops at six profiles', () => {
    let profiles = seedProfiles();
    for (let i = profiles.length; i < MAX_PROFILES; i += 1) {
      const result = createProfile(`Guest ${i}`, profiles);
      if (!result.ok) throw new Error(result.error);
      profiles = [...profiles, result.profile];
    }
    expect(createProfile('One more', profiles).ok).toBe(false);
    expect(new Set(profiles.map((p) => p.id)).size).toBe(MAX_PROFILES);
  });

  it('mentions custom modes in the summary', () => {
    const [owner] = seedProfiles();
    owner!.modes.push({ ...owner!.modes[0]!, id: 'custom-1', slot: 16, builtIn: false, name: 'Library' });
    expect(profileSummary(owner!, 'F')).toBe('Auto · 93°F · 1 custom mode');
  });
});

describe('the shop', () => {
  it('prices the base hoodie at $199', () => {
    expect(priceOf(defaultConfiguration())).toEqual({ baseUsd: 199, graphicUsd: 0, powerUsd: 0, totalUsd: 199 });
    expect(BASE_PRICE_USD).toBe(199);
  });

  it('adds the graphic and the spare cells', () => {
    expect(priceOf({ color: 'bone', graphic: 'orbit', size: 'L', power: 'standard' }).totalUsd).toBe(219);
    expect(priceOf({ color: 'rust', graphic: 'custom', size: 'S', power: 'spare' }).totalUsd).toBe(264);
    expect(priceOf(defaultConfiguration(), 149).totalUsd).toBe(149);
  });

  it('offers four colours, four graphics, six sizes and two power options', () => {
    expect(COLORS.map((c) => c.name)).toEqual(['Black', 'Heather', 'Bone', 'Rust']);
    expect(GRAPHICS).toHaveLength(4);
    expect(SHOP_SIZES).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(POWER_OPTIONS.map((p) => p.priceUsd)).toEqual([0, 35]);
    expect(POWER_OPTIONS[0]?.detail).toBe('Included · 2,500 mAh and 50 g each, up to 6.5 h');
    expect(POWER_OPTIONS[1]?.detail).toBe('Add-on · swap in seconds for an all-day 13 h');
  });

  it('looks options up and labels prices', () => {
    expect(findColor('rust').hex).toBe('#B4412A');
    expect(findGraphic('orbit').showsBack).toBe(true);
    expect(findPower('spare').name).toBe('Spare cell pair');
    expect(priceLabel(0)).toBe('Included');
    expect(priceLabel(20)).toBe('+$20');
    expect(configurationSummary({ color: 'heather', graphic: 'tonal', size: 'XL', power: 'standard' })).toBe('Heather · Tonal mark · XL');
  });

  it('merges identical items in the bag and keeps different ones apart', () => {
    const a = defaultConfiguration();
    let bag = addToBag([], a);
    bag = addToBag(bag, { ...a });
    bag = addToBag(bag, { ...a, size: 'L' });
    expect(bag).toHaveLength(2);
    expect(bag[0]?.quantity).toBe(2);
    expect(bagCount(bag)).toBe(3);
    expect(bagTotalUsd(bag)).toBe(597);
    expect(lineTotalUsd(bag[0]!)).toBe(398);
  });

  it('changes quantities, removes lines and caps a line at nine', () => {
    let bag = addToBag([], defaultConfiguration());
    const id = bag[0]!.id;
    bag = setQuantity(bag, id, 4);
    expect(bag[0]?.quantity).toBe(4);
    bag = setQuantity(bag, id, 50);
    expect(bag[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    for (let i = 0; i < 5; i += 1) bag = addToBag(bag, defaultConfiguration());
    expect(bag[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(setQuantity(bag, id, 0)).toEqual([]);
    expect(removeLine(bag, id)).toEqual([]);
    expect(removeLine(bag, 'nope')).toEqual(bag);
  });

  it('gives new lines ids that never collide', () => {
    let bag = addToBag([], defaultConfiguration());
    bag = addToBag(bag, { ...defaultConfiguration(), size: 'S' });
    bag = removeLine(bag, bag[0]!.id);
    bag = addToBag(bag, { ...defaultConfiguration(), size: 'XL' });
    expect(new Set(bag.map((l) => l.id)).size).toBe(bag.length);
  });
});

describe('the store', () => {
  it('notifies subscribers on change and only on change', () => {
    const store = createStore({ a: 1, b: 'x' });
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.patch({ a: 2 });
    expect(store.get()).toEqual({ a: 2, b: 'x' });
    store.set((s) => s);
    expect(calls).toBe(1);
    store.set({ a: 3, b: 'y' });
    expect(calls).toBe(2);
    off();
    store.patch({ a: 4 });
    expect(calls).toBe(2);
  });

  it('lets a listener unsubscribe during a notification', () => {
    const store = createStore({ n: 0 });
    const seen: string[] = [];
    const offA = store.subscribe(() => {
      seen.push('a');
      offA();
    });
    store.subscribe(() => seen.push('b'));
    store.patch({ n: 1 });
    store.patch({ n: 2 });
    expect(seen).toEqual(['a', 'b', 'b']);
  });

  it('compares flat objects by their fields', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual(1, 1)).toBe(true);
  });
});

describe('persistence', () => {
  interface V2 {
    name: string;
    count: number;
  }
  const validate = (data: unknown): V2 | null => {
    const d = data as Partial<V2> | null;
    return d && typeof d.name === 'string' && typeof d.count === 'number' ? { name: d.name, count: d.count } : null;
  };

  it('saves and loads', () => {
    const storage = memoryStorage();
    const p = createPersistence<V2>({ storage, key: 'k', schema: 2, validate, now: () => 123 });
    expect(p.load()).toBeNull();
    expect(p.save({ name: 'a', count: 1 })).toBe(true);
    expect(p.load()).toEqual({ name: 'a', count: 1 });
    expect(JSON.parse(storage.dump().k ?? '')).toMatchObject({ schema: 2, savedAt: 123 });
    p.clear();
    expect(p.load()).toBeNull();
  });

  it('runs migrations in order', () => {
    const storage = memoryStorage({ k: JSON.stringify({ schema: 0, savedAt: 0, data: { title: 'old' } }) });
    const p = createPersistence<V2>({
      storage,
      key: 'k',
      schema: 2,
      validate,
      migrations: {
        0: (d) => ({ name: (d as { title: string }).title }),
        1: (d) => ({ ...(d as object), count: 7 }),
      },
    });
    expect(p.load()).toEqual({ name: 'old', count: 7 });
  });

  it('discards what it cannot read', () => {
    const cases = [
      '{broken',
      JSON.stringify({ schema: 9, data: { name: 'future', count: 1 } }),
      JSON.stringify({ schema: 1, data: { name: 'no migration', count: 1 } }),
      JSON.stringify({ schema: 2, data: { name: 5 } }),
      JSON.stringify('just a string'),
    ];
    for (const raw of cases) {
      const p = createPersistence<V2>({ storage: memoryStorage({ k: raw }), key: 'k', schema: 2, validate });
      expect(p.load()).toBeNull();
    }
  });

  it('copes with no storage and with storage that throws', () => {
    const none = createPersistence<V2>({ storage: null, key: 'k', schema: 2, validate });
    expect(none.load()).toBeNull();
    expect(none.save({ name: 'a', count: 1 })).toBe(false);
    const broken = createPersistence<V2>({
      storage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('full');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
      key: 'k',
      schema: 2,
      validate,
    });
    expect(broken.load()).toBeNull();
    expect(broken.save({ name: 'a', count: 1 })).toBe(false);
    expect(() => broken.clear()).not.toThrow();
  });
});

describe('app state', () => {
  it('starts un-onboarded with the schedule off', () => {
    const state = initialAppState();
    expect(state).toMatchObject({ onboarded: false, hoodie: null, link: 'idle', telemetry: null, overheat: null });
    expect(state.schedule.enabled).toBe(false);
    expect(state.washChecklist).toHaveLength(WASH_STEP_COUNT);
    expect(state.settings).toEqual({ unit: 'F', notifications: true, autoOffWhenStill: true, buttonHaptics: false });
    expect(APP_SCHEMA).toBe(1);
  });

  it('separates what is saved from what is live', () => {
    const state = initialAppState();
    const saved = selectPersisted(state);
    expect(Object.keys(saved)).not.toContain('telemetry');
    expect(Object.keys(saved)).not.toContain('toasts');
    expect(persistedChanged(state, { ...state, link: 'connected' })).toBe(false);
    expect(persistedChanged(state, { ...state, settings: { ...state.settings } })).toBe(true);
  });

  it('round-trips through validation', () => {
    const saved = defaultPersistedState();
    const back = validatePersisted(JSON.parse(JSON.stringify(saved)));
    expect(back).toEqual(saved);
  });

  it('fills gaps from the defaults', () => {
    const back = validatePersisted({ onboarded: true });
    expect(back).not.toBeNull();
    expect(back?.onboarded).toBe(true);
    expect(back?.profiles).toHaveLength(3);
    expect(back?.settings.unit).toBe('F');
    expect(back?.schedule.minuteOfDay).toBe(440);
  });

  it('repairs individual bad fields', () => {
    const saved = JSON.parse(JSON.stringify(defaultPersistedState())) as Record<string, unknown>;
    saved.activeProfileId = 'ghost';
    saved.settings = { unit: 'K', notifications: 'yes' };
    saved.schedule = { enabled: true, minuteOfDay: 5000, days: [true], preheatMin: 500 };
    saved.washChecklist = [true];
    saved.bag = [{ id: 'line-1', config: {}, quantity: 1 }, 'junk'];
    saved.hoodie = { id: 'X', name: 'Mine', size: 'HUGE' };
    const back = validatePersisted(saved);
    expect(back?.activeProfileId).toBe('p-owner');
    expect(back?.settings.unit).toBe('F');
    expect(back?.schedule).toMatchObject({ enabled: true, minuteOfDay: 440, preheatMin: 10 });
    expect(back?.schedule.days).toHaveLength(7);
    expect(back?.washChecklist).toHaveLength(WASH_STEP_COUNT);
    expect(back?.bag).toHaveLength(1);
    expect(back?.hoodie).toMatchObject({ id: 'X', serial: 'X', size: 'M', version: '1.2.0' });
  });

  it('adds a built-in mode that an older save does not have', () => {
    const saved = JSON.parse(JSON.stringify(defaultPersistedState())) as { profiles: { modes: { id: string }[] }[] };
    saved.profiles[0]!.modes = saved.profiles[0]!.modes.filter((m) => m.id !== 'sleep');
    const back = validatePersisted(saved);
    expect(back?.profiles[0]?.modes.some((m) => m.id === 'sleep')).toBe(true);
  });

  it('rejects data that is not an object or has a broken profile', () => {
    expect(validatePersisted(null)).toBeNull();
    expect(validatePersisted('text')).toBeNull();
    expect(validatePersisted([])).toBeNull();
    expect(validatePersisted({ profiles: [{ id: 'p', name: 'x', modes: [] }] })).toBeNull();
  });
});

describe('wording of notices', () => {
  const ctx = { unit: 'F' as const, modeName: 'Sick', cellsSeated: 1 };

  it('explains each event in plain words', () => {
    expect(noticeForEvent({ type: 'lowBattery', percent: 19 }, ctx)).toMatchObject({ tone: 'warn', title: 'Cells at 19%' });
    expect(noticeForEvent({ type: 'cellRemoved', cell: 'left' }, ctx)).toMatchObject({ title: 'Left cell out', body: 'Running on the other cell.' });
    expect(noticeForEvent({ type: 'cellInserted', cell: 'right' }, ctx)).toMatchObject({ tone: 'good', title: 'Right cell in' });
    expect(noticeForEvent({ type: 'autoOff', reason: 'timer' }, ctx)).toMatchObject({ title: 'Sick mode finished' });
    expect(noticeForEvent({ type: 'autoOff', reason: 'fade' }, ctx)).toMatchObject({ title: 'Sick mode faded out' });
    expect(noticeForEvent({ type: 'autoOff', reason: 'still' }, ctx)?.body).toMatch(/30 minutes/);
    expect(noticeForEvent({ type: 'scheduleStart', preheatMin: 10 }, ctx)?.body).toBe('Warm in about 10 minutes.');
    expect(noticeForEvent({ type: 'eased', on: true }, ctx)?.title).toBe('Eased to Low');
    expect(noticeForEvent({ type: 'eased', on: false }, ctx)?.title).toBe('Back to your level');
    expect(noticeForEvent({ type: 'button', power: true }, ctx)?.title).toBe('Heating on');
    expect(noticeForEvent({ type: 'zoneLockout', zone: 'B' }, ctx)?.title).toBe('Upper back is off for today');
    expect(noticeForEvent({ type: 'overheatClear', zone: 'B', tempC: 40 }, ctx)?.title).toBe('Upper back is heating again');
    expect(noticeForEvent({ type: 'criticalBattery' }, ctx)?.title).toBe('Heating stopped');
  });

  it('stays quiet for events that have their own screen', () => {
    expect(noticeForEvent({ type: 'overheatTrip', zone: 'B', peakC: 45 }, ctx)).toBeNull();
    expect(noticeForEvent({ type: 'fault', code: 2 }, ctx)).toBeNull();
    expect(noticeForEvent({ type: 'otaVerified' }, ctx)).toBeNull();
    expect(noticeForEvent({ type: 'rebooted', version: { major: 1, minor: 3, patch: 0 } }, ctx)).toBeNull();
  });

  it('says nothing about the last cell leaving, because the link is about to drop', () => {
    expect(noticeForEvent({ type: 'cellRemoved', cell: 'left' }, { ...ctx, cellsSeated: 0 })).toBeNull();
  });
});
