import { describe, expect, it } from 'vitest';
import { PANEL_LIMIT_C, levelZonePowerW } from '../src/core/spec';
import {
  DEFAULT_CONTROLLER_TUNING,
  heaterIsOn,
  initialControllerState,
  settledControllerState,
  stepController,
  type ControllerInput,
  type ControllerState,
} from '../src/core/thermal/controller';
import {
  DEFAULT_THERMAL_PARAMS,
  coverage,
  initialThermalState,
  panelBaselineC,
  panelTemps,
  restingSkinC,
  steadyStateThermal,
  stepThermal,
  type ThermalInputs,
} from '../src/core/thermal/model';
import { ZONE_IDS, zoneMap, type Level } from '../src/core/types';
import { cToF, fToC } from '../src/core/units';

const none = zoneMap(() => false);

function atLevel(level: Level, ambientC = 19, covered = none): ThermalInputs {
  const p = levelZonePowerW(level);
  return { ambientC, powerW: { L: p, R: p, B: p }, covered };
}

describe('resting state', () => {
  it('reads 90.6 °F at the collar in a 66 °F room', () => {
    expect(cToF(restingSkinC(19))).toBeCloseTo(90.6, 1);
  });

  it('follows the air, within limits', () => {
    expect(restingSkinC(5)).toBeLessThan(restingSkinC(19));
    expect(restingSkinC(-40)).toBe(DEFAULT_THERMAL_PARAMS.restSkinMinC);
    expect(restingSkinC(60)).toBe(DEFAULT_THERMAL_PARAMS.restSkinMaxC);
  });

  it('starts with cold panels sitting between skin and air', () => {
    const state = initialThermalState(19);
    const panels = panelTemps(state, 19);
    for (const zone of ZONE_IDS) {
      expect(panels[zone]).toBeLessThan(state.skinC);
      expect(panels[zone]).toBeGreaterThan(19);
      expect(panels[zone]).toBeCloseTo(panelBaselineC(state.skinC, 19), 9);
    }
  });
});

describe('steady state against the published behaviour', () => {
  it('tops out near 92.8, 94.4 and 96.5 °F at Low, Medium and High', () => {
    const skinF = ([0, 1, 2] as Level[]).map((level) => cToF(steadyStateThermal(atLevel(level)).skinC));
    expect(skinF[0]).toBeCloseTo(92.8, 0);
    expect(skinF[1]).toBeCloseTo(94.4, 0);
    expect(skinF[2]).toBeCloseTo(96.5, 0);
    expect(skinF[0]).toBeLessThan(skinF[1] ?? 0);
    expect(skinF[1]).toBeLessThan(skinF[2] ?? 0);
  });

  it('lets Auto reach 93 °F at Medium but not at Low', () => {
    expect(cToF(steadyStateThermal(atLevel(0)).skinC)).toBeLessThan(93);
    expect(cToF(steadyStateThermal(atLevel(1)).skinC)).toBeGreaterThan(93);
  });

  it('keeps uncovered panels under the limit, flat out at High in an 80 °F room', () => {
    const state = steadyStateThermal(atLevel(2, fToC(80)));
    const panels = panelTemps(state, fToC(80));
    for (const zone of ZONE_IDS) expect(panels[zone]).toBeLessThan(PANEL_LIMIT_C - 0.5);
  });

  it('pushes a covered back panel past the limit at Medium', () => {
    const state = steadyStateThermal(atLevel(1, 19, { L: false, R: false, B: true }));
    const panels = panelTemps(state, 19);
    expect(panels.B).toBeGreaterThan(PANEL_LIMIT_C + 2);
    expect(panels.L).toBeLessThan(PANEL_LIMIT_C);
  });

  it('does not let a hot covered panel fool the collar sensor', () => {
    const open = steadyStateThermal(atLevel(1));
    const covered = steadyStateThermal(atLevel(1, 19, { L: false, R: false, B: true }));
    expect(covered.skinC).toBeCloseTo(open.skinC, 6);
  });

  it('warms less with fewer zones', () => {
    const p = levelZonePowerW(1);
    const all = steadyStateThermal(atLevel(1));
    const chestOnly = steadyStateThermal({ ambientC: 19, powerW: { L: p, R: p, B: 0 }, covered: none });
    expect(chestOnly.skinC).toBeLessThan(all.skinC);
    expect(chestOnly.skinC).toBeGreaterThan(restingSkinC(19));
  });
});

describe('stepping', () => {
  it('converges on the steady state', () => {
    const inputs = atLevel(1);
    let state = initialThermalState(19);
    for (let i = 0; i < 3600; i += 1) state = stepThermal(state, inputs, 1);
    const target = steadyStateThermal(inputs);
    expect(state.skinC).toBeCloseTo(target.skinC, 2);
    expect(state.fluxRiseC.B).toBeCloseTo(target.fluxRiseC.B, 3);
  });

  it('gives nearly the same answer for one long step as for many short ones', () => {
    const inputs = atLevel(2);
    let fine = initialThermalState(19);
    for (let i = 0; i < 120; i += 1) fine = stepThermal(fine, inputs, 1);
    let coarse = initialThermalState(19);
    for (let i = 0; i < 12; i += 1) coarse = stepThermal(coarse, inputs, 10);
    expect(coarse.fluxRiseC.L).toBeCloseTo(fine.fluxRiseC.L, 6);
    expect(Math.abs(coarse.skinC - fine.skinC)).toBeLessThan(0.05);
  });

  it('ignores a zero or negative time step', () => {
    const state = initialThermalState(19);
    expect(stepThermal(state, atLevel(2), 0)).toBe(state);
    expect(stepThermal(state, atLevel(2), -1)).toBe(state);
  });

  it('cools back to rest when the power is cut', () => {
    let state = steadyStateThermal(atLevel(2));
    const off: ThermalInputs = { ambientC: 19, powerW: zoneMap(() => 0), covered: none };
    for (let i = 0; i < 3600; i += 1) state = stepThermal(state, off, 1);
    expect(state.skinC).toBeCloseTo(restingSkinC(19), 2);
    expect(state.fluxRiseC.L).toBeLessThan(0.001);
  });

  it('builds insulation gradually when a panel is covered', () => {
    let state = steadyStateThermal(atLevel(1));
    expect(coverage(state.insulation.B)).toBe(0);
    const covered = atLevel(1, 19, { L: false, R: false, B: true });
    state = stepThermal(state, covered, 10);
    const early = coverage(state.insulation.B);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.5);
    for (let i = 0; i < 600; i += 1) state = stepThermal(state, covered, 1);
    expect(coverage(state.insulation.B)).toBeCloseTo(1, 3);
  });
});

describe('heat controller', () => {
  const base: ControllerInput = { enabled: true, skinC: 32.5, targetC: 34, ramp: 'normal', pulse: true, dutyCap: 1 };

  function runFor(input: ControllerInput, seconds: number, start: ControllerState = initialControllerState()): ControllerState {
    let state = start;
    for (let i = 0; i < seconds; i += 1) state = stepController(state, input, 1);
    return state;
  }

  it('is silent when disabled and forgets what it knew', () => {
    const state = stepController(settledControllerState(0.7), { ...base, enabled: false }, 1);
    expect(state).toEqual(initialControllerState());
    expect(heaterIsOn(state)).toBe(false);
  });

  it('honours each ramp speed on the way up', () => {
    for (const ramp of ['slow', 'normal', 'fast'] as const) {
      const after10 = runFor({ ...base, ramp }, 10);
      expect(after10.duty).toBeCloseTo(DEFAULT_CONTROLLER_TUNING.rampUpPerS[ramp] * 10, 6);
    }
    expect(runFor({ ...base, ramp: 'fast' }, 20).duty).toBe(1);
    expect(runFor({ ...base, ramp: 'slow' }, 60).duty).toBeLessThan(0.4);
  });

  it('comes down quickly once the target is passed', () => {
    const hot = { ...base, skinC: 35 };
    const state = runFor(hot, 10, settledControllerState(1));
    expect(state.duty).toBe(0);
  });

  it('never exceeds the duty cap', () => {
    const state = runFor({ ...base, ramp: 'fast', dutyCap: 0.4 }, 60);
    expect(state.duty).toBeCloseTo(0.4, 6);
  });

  it('settles on a partial duty when the skin sits just under the target', () => {
    const state = runFor({ ...base, skinC: 33.9 }, 600);
    expect(state.duty).toBeGreaterThan(0.1);
    expect(state.duty).toBeLessThanOrEqual(1);
    expect(state.integral).toBeGreaterThan(0);
  });

  it('does not wind up while the ramp is holding it back', () => {
    const state = runFor({ ...base, ramp: 'slow' }, 60);
    expect(state.integral).toBe(0);
  });

  it('holds with hysteresis when pulse is off', () => {
    const hold = { ...base, pulse: false, ramp: 'fast' as const };
    let state = runFor({ ...hold, skinC: 33.5 }, 30);
    expect(state.thermostatOn).toBe(true);
    expect(state.duty).toBe(1);
    // Slightly above target: still on, inside the band.
    state = runFor({ ...hold, skinC: 34.2 }, 5, state);
    expect(state.thermostatOn).toBe(true);
    // Past the top of the band: off.
    state = runFor({ ...hold, skinC: 34.4 }, 20, state);
    expect(state.thermostatOn).toBe(false);
    expect(state.duty).toBe(0);
    // Back at target: stays off until it falls below the bottom of the band.
    state = runFor({ ...hold, skinC: 34.0 }, 5, state);
    expect(state.thermostatOn).toBe(false);
    state = runFor({ ...hold, skinC: 33.85 }, 5, state);
    expect(state.thermostatOn).toBe(true);
  });

  it('delivers duty as one burst per window', () => {
    let state = settledControllerState(0.4);
    let on = 0;
    const steady = { ...base, skinC: 34, targetC: 34 };
    for (let i = 0; i < DEFAULT_CONTROLLER_TUNING.windowS; i += 1) {
      // Hold the duty fixed so only the window phase moves.
      state = { ...stepController(state, steady, 1), duty: 0.4, integral: 0.4 };
      if (heaterIsOn(state)) on += 1;
    }
    expect(on).toBe(8);
  });

  it('skips the switching at the extremes', () => {
    expect(heaterIsOn({ ...settledControllerState(1), windowPhaseS: 19 })).toBe(true);
    expect(heaterIsOn({ ...settledControllerState(0.01), windowPhaseS: 0 })).toBe(false);
  });
});
