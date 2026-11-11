/**
 * Shared domain types for the Warmup hoodie.
 *
 * Everything in `src/core` is plain TypeScript with no React and no browser
 * globals, so it can be unit tested in Node and reused by a native shell later.
 */

/** The three graphene heat panels. */
export type ZoneId = 'L' | 'R' | 'B';

export const ZONE_IDS: readonly ZoneId[] = ['L', 'R', 'B'];

export const ZONE_NAMES: Record<ZoneId, string> = {
  L: 'Chest left',
  R: 'Chest right',
  B: 'Upper back',
};

/** Short names used where three chips have to share one row. */
export const ZONE_SHORT_NAMES: Record<ZoneId, string> = {
  L: 'Chest left',
  R: 'Chest right',
  B: 'Back',
};

export type ZoneMap<T> = Record<ZoneId, T>;

export function zoneMap<T>(make: (zone: ZoneId) => T): ZoneMap<T> {
  return { L: make('L'), R: make('R'), B: make('B') };
}

export const ALL_ZONES_ON: ZoneMap<boolean> = { L: true, R: true, B: true };

const ZONE_BITS: Record<ZoneId, number> = { L: 1, R: 2, B: 4 };

export function zonesToMask(zones: ZoneMap<boolean>): number {
  let mask = 0;
  for (const id of ZONE_IDS) if (zones[id]) mask |= ZONE_BITS[id];
  return mask;
}

export function maskToZones(mask: number): ZoneMap<boolean> {
  return zoneMap((id) => (mask & ZONE_BITS[id]) !== 0);
}

export function countZones(zones: ZoneMap<boolean>): number {
  return ZONE_IDS.reduce((n, id) => n + (zones[id] ? 1 : 0), 0);
}

/** Heat level. It caps how much power each panel may draw. */
export type Level = 0 | 1 | 2;

export const LEVELS: readonly Level[] = [0, 1, 2];
export const LEVEL_NAMES: readonly [string, string, string] = ['Low', 'Medium', 'High'];

export function isLevel(value: number): value is Level {
  return value === 0 || value === 1 || value === 2;
}

/** How quickly a mode is allowed to raise panel power. */
export type RampSpeed = 'slow' | 'normal' | 'fast';

export const RAMP_SPEEDS: readonly RampSpeed[] = ['slow', 'normal', 'fast'];
export const RAMP_NAMES: Record<RampSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

export type TempUnit = 'F' | 'C';

export type HoodieSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const HOODIE_SIZES: readonly HoodieSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** The two snap-in cells, named for the side seam they sit in. */
export type CellId = 'left' | 'right';
export const CELL_IDS: readonly CellId[] = ['left', 'right'];
export const CELL_NAMES: Record<CellId, string> = { left: 'Left cell', right: 'Right cell' };

export type CellMap<T> = Record<CellId, T>;

export function cellMap<T>(make: (cell: CellId) => T): CellMap<T> {
  return { left: make('left'), right: make('right') };
}

/** Semantic version of the hoodie firmware. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(text: string): Version {
  const parts = text.trim().split('.').map((p) => Number.parseInt(p, 10));
  const [major = 0, minor = 0, patch = 0] = parts;
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid version "${text}"`);
  }
  return { major, minor, patch };
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
