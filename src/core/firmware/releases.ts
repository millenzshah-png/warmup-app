/**
 * Firmware releases the app knows about, and what each one changes.
 *
 * `featuresFor` is how the simulated controller decides how to behave, so an
 * update in the app really does change how the hoodie runs afterwards.
 */
import type { BalanceStrategy } from '../battery/pack';
import { FIRMWARE_IMAGE_BYTES, FIRMWARE_LATEST_VERSION, FIRMWARE_MIN_CELL_FRACTION } from '../spec';
import { compareVersions, parseVersion, type Version } from '../types';

export interface FirmwareRelease {
  version: string;
  sizeBytes: number;
  /** One cell must hold at least this fraction before installing. */
  minCellFraction: number;
  notes: readonly string[];
}

export const RELEASES: readonly FirmwareRelease[] = [
  {
    version: '1.2.0',
    sizeBytes: 398 * 1024,
    minCellFraction: FIRMWARE_MIN_CELL_FRACTION,
    notes: [
      'Outdoor mode follows the temperature outside.',
      'Wash mode ignores the hem button.',
    ],
  },
  {
    version: FIRMWARE_LATEST_VERSION,
    sizeBytes: FIRMWARE_IMAGE_BYTES,
    minCellFraction: FIRMWARE_MIN_CELL_FRACTION,
    notes: [
      'Auto mode learns your resting temperature twice as fast.',
      'Cells now balance their load, so both drain at the same rate.',
      'Fixes a case where the back zone stayed on after Sleep mode ended.',
    ],
  },
];

export function findRelease(version: string): FirmwareRelease | undefined {
  return RELEASES.find((r) => r.version === version);
}

export function latestRelease(): FirmwareRelease {
  const latest = RELEASES[RELEASES.length - 1];
  if (!latest) throw new Error('No firmware releases defined');
  return latest;
}

/** The newest release that is newer than what the hoodie runs, if any. */
export function availableUpdate(current: Version): FirmwareRelease | null {
  const latest = latestRelease();
  return compareVersions(parseVersion(latest.version), current) > 0 ? latest : null;
}

export interface FirmwareFeatures {
  /** How the load is shared between the two cells. */
  balanceStrategy: BalanceStrategy;
  /** Time constant for learning the wearer's resting skin temperature, s. */
  restLearnTauS: number;
  /** Whether heating stops completely when a Sleep fade finishes. */
  sleepEndsCleanly: boolean;
}

const V1_3_0: Version = { major: 1, minor: 3, patch: 0 };

export function featuresFor(version: Version): FirmwareFeatures {
  const modern = compareVersions(version, V1_3_0) >= 0;
  return {
    balanceStrategy: modern ? 'balanced' : 'fixed',
    restLearnTauS: modern ? 600 : 1200,
    sleepEndsCleanly: modern,
  };
}
