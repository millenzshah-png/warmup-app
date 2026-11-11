/**
 * The two-cell pack.
 *
 * The hoodie runs on either cell or both. How the load is shared depends on
 * the firmware: 1.2.0 leans on the right cell, which is why the two cells
 * drift apart, and 1.3.0 steers the load towards the fuller cell until they
 * match.
 */
import { CELL_IDS, cellMap, type CellId, type CellMap } from '../types';
import { clamp } from '../units';
import { cellCanSupply, cellCapacityWh, cellEnergyWh, chargeCell, dischargeCell, type CellState } from './cell';

export type PackState = CellMap<CellState>;

/** How the load is divided between two cells that can both supply. */
export type BalanceStrategy = 'fixed' | 'balanced';

/** Share of the load the left cell takes under the fixed strategy. */
export const FIXED_LEFT_SHARE = 0.44;

/** Cells seated in the hoodie. */
export function presentCells(pack: PackState): CellId[] {
  return CELL_IDS.filter((id) => pack[id].present);
}

/** Cells that are seated and have charge. */
export function supplyingCells(pack: PackState): CellId[] {
  return CELL_IDS.filter((id) => cellCanSupply(pack[id]));
}

/** Energy available to the hoodie right now, Wh. */
export function availableEnergyWh(pack: PackState): number {
  return supplyingCells(pack).reduce((sum, id) => sum + cellEnergyWh(pack[id]), 0);
}

/**
 * Combined charge of the cells in the hoodie, 0 to 1. With 82 % and 74 %
 * seated this is 78 %. With one cell out it is simply the other cell.
 */
export function packFraction(pack: PackState): number {
  const seated = presentCells(pack);
  if (seated.length === 0) return 0;
  const capacity = seated.reduce((sum, id) => sum + cellCapacityWh(pack[id]), 0);
  if (capacity <= 0) return 0;
  const energy = seated.reduce((sum, id) => sum + cellEnergyWh(pack[id]), 0);
  return clamp(energy / capacity, 0, 1);
}

/** Share of the load the left cell should carry, 0 to 1. */
export function leftShare(pack: PackState, strategy: BalanceStrategy): number {
  const leftOk = cellCanSupply(pack.left);
  const rightOk = cellCanSupply(pack.right);
  if (leftOk && !rightOk) return 1;
  if (!leftOk) return 0;
  if (strategy === 'fixed') return FIXED_LEFT_SHARE;
  // Lean on the fuller cell. A five point gap moves the split by fifteen points.
  return clamp(0.5 + 3 * (pack.left.soc - pack.right.soc), 0.05, 0.95);
}

export interface DrawResult {
  pack: PackState;
  /** Power the pack actually delivered, W. Less than asked when it runs dry. */
  deliveredW: number;
  /** Power each cell delivered, W. */
  perCellW: CellMap<number>;
}

/** Draw power from the pack for dt seconds. */
export function drawFromPack(pack: PackState, powerW: number, dtS: number, strategy: BalanceStrategy): DrawResult {
  const none: DrawResult = { pack, deliveredW: 0, perCellW: cellMap(() => 0) };
  if (!(powerW > 0) || !(dtS > 0)) return none;
  if (supplyingCells(pack).length === 0) return none;

  const wantedWh = (powerW * dtS) / 3600;
  const share = leftShare(pack, strategy);
  const first = dischargeCell(pack.left, wantedWh * share);
  const second = dischargeCell(pack.right, wantedWh * (1 - share));
  let left = first.cell;
  let right = second.cell;
  let leftWh = first.deliveredWh;
  let rightWh = second.deliveredWh;

  // If one cell came up short, the other covers the gap when it can.
  const shortfall = wantedWh - leftWh - rightWh;
  if (shortfall > 1e-12) {
    if (first.deliveredWh < wantedWh * share) {
      const extra = dischargeCell(right, shortfall);
      right = extra.cell;
      rightWh += extra.deliveredWh;
    } else {
      const extra = dischargeCell(left, shortfall);
      left = extra.cell;
      leftWh += extra.deliveredWh;
    }
  }

  const toW = (wh: number): number => (wh * 3600) / dtS;
  return {
    pack: { left, right },
    deliveredW: toW(leftWh + rightWh),
    perCellW: { left: toW(leftWh), right: toW(rightWh) },
  };
}

/** Charge whichever cells are on the dock. */
export function chargeDockedCells(pack: PackState, dtS: number): PackState {
  const left = chargeCell(pack.left, dtS);
  const right = chargeCell(pack.right, dtS);
  return left === pack.left && right === pack.right ? pack : { left, right };
}

/** Minutes of runtime left at a steady draw, or null when there is no draw. */
export function estimateRuntimeMin(pack: PackState, drawW: number): number | null {
  if (!(drawW > 0)) return null;
  return (availableEnergyWh(pack) / drawW) * 60;
}

/** Pull a cell off its connector. It keeps its charge. */
export function removeCell(pack: PackState, id: CellId): PackState {
  return { ...pack, [id]: { ...pack[id], present: false, docked: false } };
}

/** Snap a cell back onto its connector. */
export function insertCell(pack: PackState, id: CellId): PackState {
  return { ...pack, [id]: { ...pack[id], present: true, docked: false } };
}

/** Put a cell on the charging dock, which also takes it out of the hoodie. */
export function dockCell(pack: PackState, id: CellId): PackState {
  return { ...pack, [id]: { ...pack[id], present: false, docked: true } };
}
