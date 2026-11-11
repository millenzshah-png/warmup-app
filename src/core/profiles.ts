/**
 * Profiles: one hoodie, a few people.
 *
 * Each profile keeps its own copy of the modes (so a target tuned for one
 * person does not follow the hoodie to the next), its own active mode and
 * its own level.
 */
import { cloneMode, defaultModes, findMode, type ModeConfig } from './modes';
import type { Level, TempUnit } from './types';
import { formatTargetWithUnit } from './units';

export interface Profile {
  id: string;
  name: string;
  /** Two letters shown in the avatar. */
  initials: string;
  /** The person who paired the hoodie. Cannot be deleted. */
  owner: boolean;
  /** Optional short note shown instead of the mode name, e.g. "Runs warm". */
  tagline: string | null;
  modes: ModeConfig[];
  activeModeId: string;
  level: Level;
}

export const MAX_PROFILES = 6;
export const PROFILE_NAME_MAX_LENGTH = 20;

/** Up to two initials from a name: "Dan Huang" gives DH, "Millen" gives MI. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const second = words[1];
  if (second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return first.slice(0, 2).toUpperCase();
}

function makeProfile(partial: Pick<Profile, 'id' | 'name'> & Partial<Profile>): Profile {
  return {
    initials: initialsOf(partial.name),
    owner: false,
    tagline: null,
    modes: defaultModes(),
    activeModeId: 'auto',
    level: 1,
    ...partial,
  };
}

function withTarget(modes: ModeConfig[], modeId: string, targetF: number): ModeConfig[] {
  return modes.map((m) => (m.id === modeId ? { ...m, targetF } : m));
}

/** The three people a new install starts with. All of them can be edited. */
export function seedProfiles(): Profile[] {
  return [
    makeProfile({ id: 'p-owner', name: 'Millen', initials: 'MS', owner: true }),
    makeProfile({
      id: 'p-2',
      name: 'Aryan',
      initials: 'AS',
      tagline: 'Runs warm',
      modes: withTarget(defaultModes(), 'auto', 91),
    }),
    makeProfile({ id: 'p-3', name: 'Dad', initials: 'PS', tagline: 'Sick mode favorite', activeModeId: 'sick' }),
  ];
}

export function validateProfileName(name: string, existing: readonly Profile[], ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a name.';
  if (trimmed.length > PROFILE_NAME_MAX_LENGTH) return `Keep the name to ${PROFILE_NAME_MAX_LENGTH} characters.`;
  const lower = trimmed.toLowerCase();
  if (existing.some((p) => p.id !== ignoreId && p.name.toLowerCase() === lower)) {
    return `There is already a profile called ${trimmed}.`;
  }
  return null;
}

export type CreateProfileResult = { ok: true; profile: Profile } | { ok: false; error: string };

export function createProfile(name: string, existing: readonly Profile[]): CreateProfileResult {
  const error = validateProfileName(name, existing);
  if (error) return { ok: false, error };
  if (existing.length >= MAX_PROFILES) {
    return { ok: false, error: `A hoodie can hold ${MAX_PROFILES} profiles. Remove one first.` };
  }
  const ids = new Set(existing.map((p) => p.id));
  let n = existing.length + 1;
  while (ids.has(`p-${n}`)) n += 1;
  return { ok: true, profile: makeProfile({ id: `p-${n}`, name: name.trim() }) };
}

/** The mode a profile is currently set to, falling back to its first mode. */
export function activeMode(profile: Profile): ModeConfig {
  const mode = findMode(profile.modes, profile.activeModeId) ?? profile.modes[0];
  if (!mode) throw new Error(`Profile ${profile.id} has no modes`);
  return mode;
}

/** The line under a person's name: "Auto · 93°F" or "Runs warm · 91°F". */
export function profileSummary(profile: Profile, unit: TempUnit): string {
  const mode = activeMode(profile);
  const lead = profile.tagline ?? mode.name;
  const custom = profile.modes.filter((m) => !m.builtIn).length;
  const tail = custom > 0 ? ` · ${custom} custom ${custom === 1 ? 'mode' : 'modes'}` : '';
  return `${lead} · ${formatTargetWithUnit(mode.targetF, unit)}${tail}`;
}

export function cloneProfile(profile: Profile): Profile {
  return { ...profile, modes: profile.modes.map(cloneMode) };
}
