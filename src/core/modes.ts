/**
 * Heat modes.
 *
 * A mode is a recipe: a target skin temperature plus rules for how the hoodie
 * gets there and when it stops. The five built-in modes ship with every hoodie
 * and can be tuned per profile. Custom modes are created in the app.
 */
import { TARGET_DEFAULT_F, TARGET_MAX_F, TARGET_MIN_F } from './spec';
import { ALL_ZONES_ON, countZones, type RampSpeed, type TempUnit, type ZoneMap } from './types';
import { clamp, formatMinutesInWords, formatTargetWithUnit } from './units';

export type BuiltInModeId = 'auto' | 'sick' | 'commute' | 'outdoor' | 'sleep';

/** Icon names are resolved to SVG paths by the UI layer. */
export type ModeIconName = 'sun' | 'heart' | 'bus' | 'mountain' | 'moon' | 'spark';

export interface ModeConfig {
  /** Stable id. Built-in ids are fixed, custom ids look like "custom-3". */
  id: string;
  /** Number the hoodie echoes back in telemetry. Built-ins use 0 to 4. */
  slot: number;
  name: string;
  builtIn: boolean;
  icon: ModeIconName;
  /** One line shown in the mode list. */
  description: string;
  /** Slightly longer copy shown under the target on the detail screen. */
  blurb: string;
  /** Optional small print, for example the Sick mode medical note. */
  finePrint: string | null;
  /** Target skin temperature in whole °F. */
  targetF: number;
  ramp: RampSpeed;
  /** Panels this mode switches on when it starts. */
  zones: ZoneMap<boolean>;
  /** Modulate heat precisely around the target instead of holding it. */
  pulse: boolean;
  /** Add two degrees while the phone reports that the wearer is outside. */
  outdoorBoost: boolean;
  /** Lower the target as the outside temperature rises. */
  tracksOutdoor: boolean;
  /** Drop to Low after five still minutes indoors. */
  easeIndoors: boolean;
  /** Switch off this many minutes after the mode starts. Null never does. */
  autoOffMin: number | null;
  /** Fade the heat out over the last minutes before auto-off. */
  fadeOutMin: number | null;
}

export const BUILT_IN_MODE_IDS: readonly BuiltInModeId[] = ['auto', 'sick', 'commute', 'outdoor', 'sleep'];

/** Slots 0 to 15 are reserved for built-ins. Custom modes start here. */
export const FIRST_CUSTOM_SLOT = 16;
export const MAX_CUSTOM_MODES = 12;
export const MODE_NAME_MAX_LENGTH = 16;

export const AUTO_OFF_CHOICES_MIN: readonly (number | null)[] = [null, 30, 60, 90, 120, 240];
export const DEFAULT_CUSTOM_AUTO_OFF_MIN = 90;

function builtIn(mode: Omit<ModeConfig, 'builtIn' | 'zones'> & { zones?: ZoneMap<boolean> }): ModeConfig {
  return { ...mode, builtIn: true, zones: mode.zones ?? { ...ALL_ZONES_ON } };
}

export const BUILT_IN_MODES: readonly ModeConfig[] = [
  builtIn({
    id: 'auto',
    slot: 0,
    name: 'Auto',
    icon: 'sun',
    description: 'Holds a comfortable skin temperature using the collar sensor.',
    blurb: 'Reads the collar sensor every few seconds and pulses heat to keep you level.',
    finePrint: null,
    targetF: TARGET_DEFAULT_F,
    ramp: 'normal',
    pulse: true,
    outdoorBoost: false,
    tracksOutdoor: false,
    easeIndoors: false,
    autoOffMin: null,
    fadeOutMin: null,
  }),
  builtIn({
    id: 'sick',
    slot: 1,
    name: 'Sick',
    icon: 'heart',
    description: 'Steady, gentle warmth for chills. Slow ramp, no spikes.',
    blurb: 'Gentle, steady warmth for chills. The hoodie ramps up slowly and never spikes.',
    finePrint: 'Comfort, not treatment. See a doctor if a fever lasts more than two days.',
    targetF: 95,
    ramp: 'slow',
    pulse: true,
    outdoorBoost: false,
    tracksOutdoor: false,
    easeIndoors: false,
    autoOffMin: 120,
    fadeOutMin: null,
  }),
  builtIn({
    id: 'commute',
    slot: 2,
    name: 'Commute',
    icon: 'bus',
    description: 'Preheats before you leave, then eases off indoors.',
    blurb: 'Warm by the time you step out. Once you have been still indoors for five minutes it drops to Low.',
    finePrint: null,
    targetF: 96,
    ramp: 'fast',
    pulse: true,
    outdoorBoost: false,
    tracksOutdoor: false,
    easeIndoors: true,
    autoOffMin: 90,
    fadeOutMin: null,
  }),
  builtIn({
    id: 'outdoor',
    slot: 3,
    name: 'Outdoor',
    icon: 'mountain',
    description: 'Tracks the outside temperature from your phone.',
    blurb: 'Uses the outside temperature from your phone. The colder it is out there, the closer it holds to your target.',
    finePrint: null,
    targetF: 97,
    ramp: 'normal',
    pulse: true,
    outdoorBoost: false,
    tracksOutdoor: true,
    easeIndoors: false,
    autoOffMin: null,
    fadeOutMin: null,
  }),
  builtIn({
    id: 'sleep',
    slot: 4,
    name: 'Sleep',
    icon: 'moon',
    description: 'Low, even heat that fades out over 30 minutes.',
    blurb: 'Low, even heat while you settle. It fades out on its own and switches off.',
    finePrint: null,
    targetF: 91,
    ramp: 'slow',
    pulse: true,
    outdoorBoost: false,
    tracksOutdoor: false,
    easeIndoors: false,
    autoOffMin: 30,
    fadeOutMin: 30,
  }),
];

export function builtInMode(id: BuiltInModeId): ModeConfig {
  const mode = BUILT_IN_MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`Unknown built-in mode "${id}"`);
  return cloneMode(mode);
}

/** A fresh, independent copy of the factory mode list. */
export function defaultModes(): ModeConfig[] {
  return BUILT_IN_MODES.map(cloneMode);
}

export function cloneMode(mode: ModeConfig): ModeConfig {
  return { ...mode, zones: { ...mode.zones } };
}

export function clampTargetF(value: number): number {
  return clamp(Math.round(value), TARGET_MIN_F, TARGET_MAX_F);
}

/** Keep a mode internally consistent after any edit. */
export function normalizeMode(mode: ModeConfig): ModeConfig {
  const autoOffMin = mode.autoOffMin === null ? null : clamp(Math.round(mode.autoOffMin), 5, 12 * 60);
  let fadeOutMin = mode.fadeOutMin === null ? null : clamp(Math.round(mode.fadeOutMin), 1, 120);
  // A fade needs an end to fade towards, and cannot outlast the session.
  if (fadeOutMin !== null && autoOffMin === null) fadeOutMin = null;
  if (fadeOutMin !== null && autoOffMin !== null) fadeOutMin = Math.min(fadeOutMin, autoOffMin);
  return {
    ...mode,
    name: mode.name.trim().slice(0, MODE_NAME_MAX_LENGTH),
    targetF: clampTargetF(mode.targetF),
    zones: { ...mode.zones },
    autoOffMin,
    fadeOutMin,
  };
}

/** Returns a message when the name cannot be used, otherwise null. */
export function validateModeName(name: string, existing: readonly ModeConfig[], ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the mode a name.';
  if (trimmed.length > MODE_NAME_MAX_LENGTH) return `Keep the name to ${MODE_NAME_MAX_LENGTH} characters.`;
  const lower = trimmed.toLowerCase();
  if (existing.some((m) => m.id !== ignoreId && m.name.toLowerCase() === lower)) {
    return `You already have a mode called ${trimmed}.`;
  }
  return null;
}

export interface CustomModeInput {
  name: string;
  targetF: number;
  zones: ZoneMap<boolean>;
  pulse: boolean;
  outdoorBoost: boolean;
  /** Minutes until auto-off, or null to keep heating until switched off. */
  autoOffMin: number | null;
}

export type CreateModeResult = { ok: true; mode: ModeConfig } | { ok: false; error: string };

/** Build a custom mode, allocating the lowest free slot. */
export function createCustomMode(input: CustomModeInput, existing: readonly ModeConfig[]): CreateModeResult {
  const nameError = validateModeName(input.name, existing);
  if (nameError) return { ok: false, error: nameError };
  if (countZones(input.zones) === 0) return { ok: false, error: 'Switch on at least one zone.' };
  const custom = existing.filter((m) => !m.builtIn);
  if (custom.length >= MAX_CUSTOM_MODES) {
    return { ok: false, error: `You can keep up to ${MAX_CUSTOM_MODES} custom modes. Delete one first.` };
  }
  const usedSlots = new Set(existing.map((m) => m.slot));
  let slot = FIRST_CUSTOM_SLOT;
  while (usedSlots.has(slot)) slot += 1;
  const usedIds = new Set(existing.map((m) => m.id));
  let n = 1;
  while (usedIds.has(`custom-${n}`)) n += 1;
  const mode = normalizeMode({
    id: `custom-${n}`,
    slot,
    name: input.name,
    builtIn: false,
    icon: 'spark',
    description: describeCustomMode(input),
    blurb: 'Your own mix of target, zones and behavior.',
    finePrint: null,
    targetF: input.targetF,
    ramp: 'normal',
    zones: { ...input.zones },
    pulse: input.pulse,
    outdoorBoost: input.outdoorBoost,
    tracksOutdoor: false,
    easeIndoors: false,
    autoOffMin: input.autoOffMin,
    fadeOutMin: null,
  });
  return { ok: true, mode };
}

/** The one-line description a custom mode gets in the mode list. */
export function describeCustomMode(input: Pick<CustomModeInput, 'zones' | 'pulse' | 'outdoorBoost' | 'autoOffMin'>): string {
  const zoneCount = countZones(input.zones);
  const parts: string[] = [zoneCount === 3 ? 'All three zones' : zoneCount === 1 ? 'One zone' : 'Two zones'];
  if (input.pulse) parts.push('pulse heat');
  if (input.outdoorBoost) parts.push('outdoor boost');
  if (input.autoOffMin !== null) parts.push(`off after ${formatMinutesInWords(input.autoOffMin)}`);
  return `${parts.join(', ')}.`;
}

/** "After 2 hours" or "Never". */
export function autoOffLabel(minutes: number | null): string {
  return minutes === null ? 'Never' : `After ${formatMinutesInWords(minutes)}`;
}

/** The next choice in the auto-off cycle, wrapping at the end. */
export function nextAutoOffChoice(current: number | null): number | null {
  const index = AUTO_OFF_CHOICES_MIN.indexOf(current);
  const next = AUTO_OFF_CHOICES_MIN[(index + 1) % AUTO_OFF_CHOICES_MIN.length];
  return next === undefined ? null : next;
}

/** "Auto · 93°F" style summary used on profile cards. */
export function modeSummary(mode: ModeConfig, unit: TempUnit): string {
  return `${mode.name} · ${formatTargetWithUnit(mode.targetF, unit)}`;
}

export function findMode(modes: readonly ModeConfig[], id: string): ModeConfig | undefined {
  return modes.find((m) => m.id === id);
}

export function findModeBySlot(modes: readonly ModeConfig[], slot: number): ModeConfig | undefined {
  return modes.find((m) => m.slot === slot);
}
