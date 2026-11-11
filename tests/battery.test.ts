import { describe, expect, it } from 'vitest';
import {
  CELL_EMPTY_SOC,
  HEALTH_LOSS_PER_CYCLE,
  cellCanSupply,
  cellCapacityWh,
  cellEnergyWh,
  chargeCell,
  chargePowerW,
  dischargeCell,
  loadedVoltage,
  minutesToFull,
  newCell,
  openCircuitVoltage,
} from '../src/core/battery/cell';
import {
  FIXED_LEFT_SHARE,
  availableEnergyWh,
  chargeDockedCells,
  dockCell,
  drawFromPack,
  estimateRuntimeMin,
  insertCell,
  leftShare,
  packFraction,
  presentCells,
  removeCell,
  supplyingCells,
  type PackState,
} from '../src/core/battery/pack';
import { levelRuntimeMin, predictedDrawW, runtimeFromFullMin, usableEnergyWh } from '../src/core/battery/runtime';
import {
  BATTERY_RESERVE_FRACTION,
  CELL_ENERGY_WH,
  DOCK_POWER_PER_CELL_W,
  ELECTRONICS_OVERHEAD_W,
  PACK_ENERGY_WH,
  levelPackPowerW,
  levelZonePowerW,
} from '../src/core/spec';
import type { Level } from '../src/core/types';

const pack = (left: number, right: number): PackState => ({ left: newCell({ soc: left }), right: newCell({ soc: right }) });
const all = { L: true, R: true, B: true };

describe('the published numbers', () => {
  it('holds 9.25 Wh per cell and 18.5 Wh per pair', () => {
    expect(CELL_ENERGY_WH).toBeCloseTo(9.25, 10);
    expect(PACK_ENERGY_WH).toBeCloseTo(18.5, 10);
  });

  it('runs 6h 30m, 4h 10m and 2h 50m from full', () => {
    expect(runtimeFromFullMin(0)).toBeCloseTo(390, 6);
    expect(runtimeFromFullMin(1)).toBeCloseTo(250, 6);
    expect(runtimeFromFullMin(2)).toBeCloseTo(170, 6);
  });

  it('splits each level evenly across three panels plus the electronics', () => {
    for (const level of [0, 1, 2] as Level[]) {
      expect(levelZonePowerW(level) * 3 + ELECTRONICS_OVERHEAD_W).toBeCloseTo(levelPackPowerW(level), 10);
      expect(predictedDrawW(level, all)).toBeCloseTo(levelPackPowerW(level), 10);
    }
    expect(levelZonePowerW(0)).toBeLessThan(levelZonePowerW(1));
    expect(levelZonePowerW(1)).toBeLessThan(levelZonePowerW(2));
  });
});

describe('a cell', () => {
  it('has a voltage that rises with charge and sags under load', () => {
    let last = 0;
    for (let soc = 0; soc <= 1.0001; soc += 0.05) {
      const v = openCircuitVoltage(soc);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(openCircuitVoltage(0)).toBeCloseTo(3.0, 6);
    expect(openCircuitVoltage(1)).toBeCloseTo(4.2, 6);
    expect(openCircuitVoltage(5)).toBeCloseTo(4.2, 6);
    const cell = newCell({ soc: 0.5 });
    expect(loadedVoltage(cell, 3)).toBeLessThan(loadedVoltage(cell, 0));
  });

  it('gives up energy, counts the cycle and ages a little', () => {
    const { cell, deliveredWh } = dischargeCell(newCell(), CELL_ENERGY_WH / 2);
    expect(deliveredWh).toBeCloseTo(CELL_ENERGY_WH / 2, 9);
    expect(cell.soc).toBeCloseTo(0.5, 9);
    expect(cell.cycles).toBeCloseTo(0.5, 9);
    expect(cell.health).toBeCloseTo(1 - 0.5 * HEALTH_LOSS_PER_CYCLE, 12);
  });

  it('cannot deliver more than it holds', () => {
    const { cell, deliveredWh } = dischargeCell(newCell({ soc: 0.1 }), 5);
    expect(deliveredWh).toBeCloseTo(0.925, 9);
    expect(cell.soc).toBe(0);
    expect(cellCanSupply(cell)).toBe(false);
  });

  it('delivers nothing when it is out of the hoodie or empty', () => {
    expect(dischargeCell(newCell({ present: false }), 1).deliveredWh).toBe(0);
    expect(dischargeCell(newCell({ soc: CELL_EMPTY_SOC / 2 }), 1).deliveredWh).toBe(0);
    expect(dischargeCell(newCell(), -1).deliveredWh).toBe(0);
  });

  it('holds less when its health has dropped', () => {
    const worn = newCell({ health: 0.8 });
    expect(cellCapacityWh(worn)).toBeCloseTo(7.4, 9);
    expect(cellEnergyWh({ ...worn, soc: 0.5 })).toBeCloseTo(3.7, 9);
  });

  it('charges at full power to 80 % and then tapers', () => {
    expect(chargePowerW(0.2)).toBe(DOCK_POWER_PER_CELL_W);
    expect(chargePowerW(0.8)).toBe(DOCK_POWER_PER_CELL_W);
    expect(chargePowerW(0.9)).toBeLessThan(DOCK_POWER_PER_CELL_W);
    expect(chargePowerW(0.99)).toBeGreaterThan(0);
    expect(chargePowerW(1)).toBe(0);
  });

  it('only charges on the dock', () => {
    const seated = newCell({ soc: 0.3 });
    expect(chargeCell(seated, 600)).toBe(seated);
    const docked = chargeCell({ ...seated, present: false, docked: true }, 600);
    expect(docked.soc).toBeGreaterThan(0.3);
  });

  it('fills from empty in about an hour', () => {
    const minutes = minutesToFull(newCell({ soc: 0, present: false, docked: true }));
    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThan(95);
  });
});

describe('the pack', () => {
  it('reports 78 % for cells at 82 % and 74 %', () => {
    expect(packFraction(pack(0.82, 0.74))).toBeCloseTo(0.78, 9);
  });

  it('reports only the seated cell when one is out', () => {
    const one = removeCell(pack(0.82, 0.74), 'right');
    expect(presentCells(one)).toEqual(['left']);
    expect(packFraction(one)).toBeCloseTo(0.82, 9);
    expect(packFraction(removeCell(one, 'left'))).toBe(0);
  });

  it('leans on the right cell under the 1.2.0 strategy', () => {
    expect(leftShare(pack(0.8, 0.8), 'fixed')).toBe(FIXED_LEFT_SHARE);
    const result = drawFromPack(pack(1, 1), 4, 3600, 'fixed');
    expect(result.pack.left.soc).toBeGreaterThan(result.pack.right.soc);
    expect(result.deliveredW).toBeCloseTo(4, 6);
    expect(result.perCellW.left + result.perCellW.right).toBeCloseTo(4, 6);
  });

  it('pulls the two cells together under the 1.3.0 strategy', () => {
    expect(leftShare(pack(0.82, 0.74), 'balanced')).toBeGreaterThan(0.5);
    expect(leftShare(pack(0.5, 0.5), 'balanced')).toBe(0.5);
    let p = pack(0.82, 0.74);
    for (let i = 0; i < 3600; i += 1) p = drawFromPack(p, 4.3, 1, 'balanced').pack;
    expect(Math.abs(p.left.soc - p.right.soc)).toBeLessThan(0.01);
  });

  it('drifts further apart without balancing', () => {
    let p = pack(0.82, 0.74);
    for (let i = 0; i < 3600; i += 1) p = drawFromPack(p, 4.3, 1, 'fixed').pack;
    expect(p.left.soc - p.right.soc).toBeGreaterThan(0.08);
  });

  it('runs on one cell when the other is out or empty', () => {
    const leftOnly = removeCell(pack(0.5, 0.5), 'right');
    expect(leftShare(leftOnly, 'balanced')).toBe(1);
    const drawn = drawFromPack(leftOnly, 3, 600, 'balanced');
    expect(drawn.deliveredW).toBeCloseTo(3, 6);
    expect(drawn.pack.right.soc).toBe(0.5);
    expect(leftShare(pack(0, 0.5), 'fixed')).toBe(0);
  });

  it('covers one cell running dry from the other', () => {
    const p = pack(0.001 + CELL_EMPTY_SOC, 0.5);
    const drawn = drawFromPack(p, 6, 60, 'fixed');
    expect(drawn.deliveredW).toBeCloseTo(6, 3);
  });

  it('delivers nothing with no cells, no demand or no time', () => {
    const empty = removeCell(removeCell(pack(1, 1), 'left'), 'right');
    expect(drawFromPack(empty, 4, 1, 'fixed').deliveredW).toBe(0);
    expect(drawFromPack(pack(1, 1), 0, 1, 'fixed').deliveredW).toBe(0);
    expect(drawFromPack(pack(1, 1), 4, 0, 'fixed').deliveredW).toBe(0);
    expect(supplyingCells(empty)).toEqual([]);
  });

  it('moves a cell between the hoodie, the dock and the table', () => {
    let p = dockCell(pack(0.4, 0.4), 'left');
    expect(p.left).toMatchObject({ present: false, docked: true });
    const charged = chargeDockedCells(p, 600);
    expect(charged.left.soc).toBeGreaterThan(0.4);
    expect(charged.right.soc).toBe(0.4);
    p = insertCell(charged, 'left');
    expect(p.left).toMatchObject({ present: true, docked: false });
    expect(chargeDockedCells(p, 600)).toBe(p);
  });
});

describe('runtime estimates', () => {
  it('holds back the reserve', () => {
    expect(usableEnergyWh(pack(1, 1))).toBeCloseTo(PACK_ENERGY_WH * (1 - BATTERY_RESERVE_FRACTION), 9);
    expect(usableEnergyWh(pack(BATTERY_RESERVE_FRACTION, BATTERY_RESERVE_FRACTION))).toBeCloseTo(0, 9);
  });

  it('estimates about 3h 13m at Medium from 82 % and 74 %', () => {
    const minutes = levelRuntimeMin(pack(0.82, 0.74), 1, all);
    expect(minutes).not.toBeNull();
    expect(minutes ?? 0).toBeGreaterThan(190);
    expect(minutes ?? 0).toBeLessThan(196);
  });

  it('stretches when zones are switched off', () => {
    const three = levelRuntimeMin(pack(1, 1), 1, all) ?? 0;
    const one = levelRuntimeMin(pack(1, 1), 1, { L: true, R: false, B: false }) ?? 0;
    expect(one).toBeGreaterThan(three * 2.5);
  });

  it('has no estimate with no zones or no charge', () => {
    expect(levelRuntimeMin(pack(1, 1), 1, { L: false, R: false, B: false })).toBeNull();
    expect(levelRuntimeMin(pack(0, 0), 1, all)).toBeNull();
    expect(estimateRuntimeMin(pack(1, 1), 0)).toBeNull();
  });

  it('agrees with a plain energy over power sum', () => {
    expect(estimateRuntimeMin(pack(1, 1), 18.5)).toBeCloseTo(60, 6);
    expect(availableEnergyWh(pack(0.5, 0.5))).toBeCloseTo(9.25, 9);
  });
});
