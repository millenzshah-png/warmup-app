/**
 * Runtime estimates.
 *
 * The estimate shown on the Home and Battery screens is deliberately the
 * conservative one: the energy left divided by what the enabled zones draw
 * flat out at the chosen level. Auto usually beats it because it pulses.
 */
import { BATTERY_RESERVE_FRACTION, ELECTRONICS_OVERHEAD_W, PACK_ENERGY_WH, levelZonePowerW } from '../spec';
import { countZones, type Level, type ZoneMap } from '../types';
import { cellCapacityWh } from './cell';
import { availableEnergyWh, supplyingCells, type PackState } from './pack';

/** Pack draw with the given zones running continuously at a level, W. */
export function predictedDrawW(level: Level, zones: ZoneMap<boolean>): number {
  return countZones(zones) * levelZonePowerW(level) + ELECTRONICS_OVERHEAD_W;
}

/** Energy the heaters may still use before the reserve is reached, Wh. */
export function usableEnergyWh(pack: PackState): number {
  const capacity = supplyingCells(pack).reduce((sum, id) => sum + cellCapacityWh(pack[id]), 0);
  return Math.max(0, availableEnergyWh(pack) - BATTERY_RESERVE_FRACTION * capacity);
}

/** Minutes left at a level, or null with no zones on or no charge. */
export function levelRuntimeMin(pack: PackState, level: Level, zones: ZoneMap<boolean>): number | null {
  if (countZones(zones) === 0) return null;
  const energy = usableEnergyWh(pack);
  if (energy <= 0) return null;
  return (energy / predictedDrawW(level, zones)) * 60;
}

/** Minutes two new, full cells last at a level with all three zones on. */
export function runtimeFromFullMin(level: Level): number {
  const usable = PACK_ENERGY_WH * (1 - BATTERY_RESERVE_FRACTION);
  return (usable / predictedDrawW(level, { L: true, R: true, B: true })) * 60;
}
