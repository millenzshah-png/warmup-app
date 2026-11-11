/**
 * One snap-in cell.
 *
 * Charge is tracked by energy, which is all the runtime estimate needs. The
 * open-circuit voltage curve exists so telemetry carries a believable
 * millivolt reading and so the firmware has something to balance on.
 */
import { CELL_ENERGY_WH, CELL_RATED_CYCLES, DOCK_POWER_PER_CELL_W } from '../spec';
import { clamp } from '../units';

export interface CellState {
  /** Seated on the magnetic connector in the hoodie. */
  present: boolean;
  /** Sitting on the charging dock. A cell is never both present and docked. */
  docked: boolean;
  /** State of charge, 0 to 1, relative to what the cell can hold today. */
  soc: number;
  /** State of health, 0 to 1. Capacity today divided by capacity when new. */
  health: number;
  /** Equivalent full cycles the cell has been through. */
  cycles: number;
}

/** Health lost per equivalent full cycle. Reaches 80 % at the rated 500. */
export const HEALTH_LOSS_PER_CYCLE = 0.2 / CELL_RATED_CYCLES;

/** A cell below this is treated as empty so it is never run flat. */
export const CELL_EMPTY_SOC = 0.005;

/** Internal resistance used for the loaded voltage estimate, ohms. */
const INTERNAL_RESISTANCE_OHM = 0.08;

/** Open-circuit voltage against state of charge for a 3.7 V lithium cell. */
const OCV_TABLE: readonly (readonly [number, number])[] = [
  [0, 3.0],
  [0.05, 3.3],
  [0.1, 3.45],
  [0.2, 3.58],
  [0.5, 3.72],
  [0.8, 3.95],
  [0.9, 4.05],
  [1, 4.2],
];

export function openCircuitVoltage(soc: number): number {
  const s = clamp(soc, 0, 1);
  for (let i = 1; i < OCV_TABLE.length; i += 1) {
    const hi = OCV_TABLE[i];
    const lo = OCV_TABLE[i - 1];
    if (!hi || !lo) break;
    if (s <= hi[0]) {
      const t = (s - lo[0]) / (hi[0] - lo[0]);
      return lo[1] + (hi[1] - lo[1]) * t;
    }
  }
  return 4.2;
}

/** Terminal voltage while delivering the given power. */
export function loadedVoltage(cell: CellState, drawW: number): number {
  const ocv = openCircuitVoltage(cell.soc);
  const current = drawW > 0 ? drawW / ocv : 0;
  return Math.max(2.5, ocv - current * INTERNAL_RESISTANCE_OHM);
}

/** Energy the cell holds when full, at its current health. */
export function cellCapacityWh(cell: CellState): number {
  return CELL_ENERGY_WH * clamp(cell.health, 0, 1);
}

/** Energy left in the cell. */
export function cellEnergyWh(cell: CellState): number {
  return cellCapacityWh(cell) * clamp(cell.soc, 0, 1);
}

/** True when the cell is in the hoodie and has charge to give. */
export function cellCanSupply(cell: CellState): boolean {
  return cell.present && cell.soc > CELL_EMPTY_SOC;
}

/** Take energy out of a cell. Returns the new cell and what it delivered. */
export function dischargeCell(cell: CellState, energyWh: number): { cell: CellState; deliveredWh: number } {
  if (!cellCanSupply(cell) || !(energyWh > 0)) return { cell, deliveredWh: 0 };
  const capacity = cellCapacityWh(cell);
  const deliveredWh = Math.min(energyWh, cellEnergyWh(cell));
  const socDrop = capacity > 0 ? deliveredWh / capacity : 0;
  return {
    deliveredWh,
    cell: {
      ...cell,
      soc: clamp(cell.soc - socDrop, 0, 1),
      cycles: cell.cycles + socDrop,
      health: clamp(cell.health - socDrop * HEALTH_LOSS_PER_CYCLE, 0.5, 1),
    },
  };
}

/**
 * Power the dock pushes into a cell. Constant power up to 80 %, then it
 * tapers so the last stretch is gentle, the way a real charger behaves.
 */
export function chargePowerW(soc: number): number {
  if (soc >= 1) return 0;
  if (soc <= 0.8) return DOCK_POWER_PER_CELL_W;
  const taper = (1 - soc) / 0.2;
  return DOCK_POWER_PER_CELL_W * Math.max(0.12, taper);
}

/** Charge a docked cell for dt seconds. Cells that are not docked are unchanged. */
export function chargeCell(cell: CellState, dtS: number): CellState {
  if (!cell.docked || cell.soc >= 1 || !(dtS > 0)) return cell;
  const capacity = cellCapacityWh(cell);
  if (capacity <= 0) return cell;
  const addedWh = (chargePowerW(cell.soc) * dtS) / 3600;
  return { ...cell, soc: clamp(cell.soc + addedWh / capacity, 0, 1) };
}

/** Minutes for a docked cell to reach full from its current charge. */
export function minutesToFull(cell: CellState): number {
  let probe = { ...cell, docked: true };
  let seconds = 0;
  const step = 15;
  while (probe.soc < 0.999 && seconds < 6 * 3600) {
    probe = chargeCell(probe, step);
    seconds += step;
  }
  return seconds / 60;
}

export function newCell(overrides: Partial<CellState> = {}): CellState {
  return { present: true, docked: false, soc: 1, health: 1, cycles: 0, ...overrides };
}
