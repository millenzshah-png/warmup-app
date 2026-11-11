/**
 * Lumped thermal model of a worn Warmup hoodie.
 *
 * This is what stands in for the real garment while the hardware is being
 * built. It is deliberately small: three first-order lags per zone and one for
 * the skin under the collar sensor. The constants are tuned so the model
 * reproduces the published behaviour:
 *
 *   - resting collar skin temperature of 90.6 °F in a 66 °F room
 *   - at most about 92.8, 94.4 and 96.5 °F at Low, Medium and High with all
 *     zones running flat out, so Auto holds 93 °F from Medium upwards
 *   - panels near 103 °F flat out at Medium and under 110 °F at High
 *   - a panel pressed against the body (backpack, chair) overshoots the
 *     113 °F limit, while an uncovered panel never does in a room up to 80 °F
 *
 * See docs/THERMAL_MODEL.md for the derivation.
 */
import { ZONE_IDS, zoneMap, type ZoneId, type ZoneMap } from '../types';
import { clamp } from '../units';

export interface ThermalParams {
  /** Resting skin temperature at the collar in the reference room, °C. */
  restSkinAtRefC: number;
  /** The reference room temperature, °C. */
  refAmbientC: number;
  /** How far resting skin temperature follows the air, °C per °C. */
  restSkinPerAmbientC: number;
  restSkinMinC: number;
  restSkinMaxC: number;
  /**
   * An unheated panel sits between skin and air. This is the skin share:
   * 0.95 means the fleece keeps it very close to body temperature.
   */
  panelSkinWeight: number;
  /** Steady temperature rise per watt for an uncovered panel, °C/W. */
  panelResistanceCPerW: ZoneMap<number>;
  /** How much a pressed or covered panel multiplies its temperature rise. */
  coveredFactor: number;
  /** A fully covered, unheated panel sits this far above skin temperature, °C. */
  coveredBaselineLiftC: number;
  /** Time constant of a panel warming or cooling, seconds. */
  panelTauS: number;
  /** Time constant of heat building up behind a covered panel, seconds. */
  insulationTauS: number;
  /** Time constant of the skin under the collar sensor, seconds. */
  skinTauS: number;
  /** How strongly each panel's warmth shows up at the collar sensor. */
  skinCoupling: ZoneMap<number>;
}

export const DEFAULT_THERMAL_PARAMS: ThermalParams = {
  restSkinAtRefC: 32.556,
  refAmbientC: 19,
  restSkinPerAmbientC: 0.12,
  restSkinMinC: 28,
  restSkinMaxC: 34.5,
  panelSkinWeight: 0.95,
  panelResistanceCPerW: { L: 3.7, R: 3.7, B: 3.85 },
  coveredFactor: 3.6,
  coveredBaselineLiftC: 3,
  panelTauS: 75,
  insulationTauS: 40,
  skinTauS: 240,
  skinCoupling: { L: 0.096, R: 0.096, B: 0.128 },
};

export interface ThermalState {
  /** Skin temperature under the collar sensor, °C. */
  skinC: number;
  /**
   * How far each panel's heater has lifted it above its unheated baseline,
   * measured as if the panel were uncovered, °C. This lags the heater power.
   */
  fluxRiseC: ZoneMap<number>;
  /** Insulation multiplier per panel. 1 in open air, rising when covered. */
  insulation: ZoneMap<number>;
}

export interface ThermalInputs {
  /** Air temperature around the wearer, °C. */
  ambientC: number;
  /** Electrical power going into each panel right now, W. */
  powerW: ZoneMap<number>;
  /** True while something is pressing a panel against the body. */
  covered: ZoneMap<boolean>;
}

/** Skin temperature at the collar with no heating at all. */
export function restingSkinC(ambientC: number, p: ThermalParams = DEFAULT_THERMAL_PARAMS): number {
  const rest = p.restSkinAtRefC + p.restSkinPerAmbientC * (ambientC - p.refAmbientC);
  return clamp(rest, p.restSkinMinC, p.restSkinMaxC);
}

/** Temperature of an uncovered panel that is not being heated. */
export function panelBaselineC(skinC: number, ambientC: number, p: ThermalParams = DEFAULT_THERMAL_PARAMS): number {
  return p.panelSkinWeight * skinC + (1 - p.panelSkinWeight) * ambientC;
}

/** How covered a panel is, 0 in open air to 1 fully pressed against the body. */
export function coverage(insulation: number, p: ThermalParams = DEFAULT_THERMAL_PARAMS): number {
  if (p.coveredFactor <= 1) return 0;
  return clamp((insulation - 1) / (p.coveredFactor - 1), 0, 1);
}

/** What the panel's own thermistor reads. */
export function panelTempC(
  state: ThermalState,
  zone: ZoneId,
  ambientC: number,
  p: ThermalParams = DEFAULT_THERMAL_PARAMS,
): number {
  // Body heat gets trapped behind a covered panel, so its unheated baseline
  // climbs from "between skin and air" to a few degrees above the skin.
  const open = panelBaselineC(state.skinC, ambientC, p);
  const pressed = state.skinC + p.coveredBaselineLiftC;
  const baseline = open + (pressed - open) * coverage(state.insulation[zone], p);
  return baseline + state.fluxRiseC[zone] * state.insulation[zone];
}

export function panelTemps(
  state: ThermalState,
  ambientC: number,
  p: ThermalParams = DEFAULT_THERMAL_PARAMS,
): ZoneMap<number> {
  return zoneMap((zone) => panelTempC(state, zone, ambientC, p));
}

/** A hoodie that has been worn, unheated, long enough to settle. */
export function initialThermalState(ambientC: number, p: ThermalParams = DEFAULT_THERMAL_PARAMS): ThermalState {
  return {
    skinC: restingSkinC(ambientC, p),
    fluxRiseC: zoneMap(() => 0),
    insulation: zoneMap(() => 1),
  };
}

/** Skin temperature the current panel warmth is pulling towards. */
export function skinEquilibriumC(
  state: ThermalState,
  ambientC: number,
  p: ThermalParams = DEFAULT_THERMAL_PARAMS,
): number {
  const rest = restingSkinC(ambientC, p);
  const baseline = panelBaselineC(state.skinC, ambientC, p);
  let gain = 0;
  for (const zone of ZONE_IDS) {
    // The collar feels the heat a panel delivers, not how hot a covered
    // panel gets, so the insulation multiplier is left out on purpose.
    const riseOverRest = baseline + state.fluxRiseC[zone] - rest;
    if (riseOverRest > 0) gain += p.skinCoupling[zone] * riseOverRest;
  }
  return rest + gain;
}

/** Fraction of the way a first-order lag moves in dt. Exact for any dt. */
function lagFraction(dtS: number, tauS: number): number {
  return 1 - Math.exp(-dtS / tauS);
}

/** Advance the model by dt seconds. Stable for any positive dt. */
export function stepThermal(
  state: ThermalState,
  inputs: ThermalInputs,
  dtS: number,
  p: ThermalParams = DEFAULT_THERMAL_PARAMS,
): ThermalState {
  if (!(dtS > 0)) return state;
  const panelK = lagFraction(dtS, p.panelTauS);
  const insulationK = lagFraction(dtS, p.insulationTauS);
  const skinK = lagFraction(dtS, p.skinTauS);

  const fluxRiseC = zoneMap((zone) => {
    const target = Math.max(0, inputs.powerW[zone]) * p.panelResistanceCPerW[zone];
    return state.fluxRiseC[zone] + (target - state.fluxRiseC[zone]) * panelK;
  });
  const insulation = zoneMap((zone) => {
    const target = inputs.covered[zone] ? p.coveredFactor : 1;
    return state.insulation[zone] + (target - state.insulation[zone]) * insulationK;
  });
  const next: ThermalState = { skinC: state.skinC, fluxRiseC, insulation };
  const skinTarget = skinEquilibriumC(next, inputs.ambientC, p);
  next.skinC = state.skinC + (skinTarget - state.skinC) * skinK;
  return next;
}

/**
 * Where the model settles if the inputs are held forever. Solved by fixed
 * point iteration, which converges because the skin to panel feedback gain
 * is well below one.
 */
export function steadyStateThermal(inputs: ThermalInputs, p: ThermalParams = DEFAULT_THERMAL_PARAMS): ThermalState {
  const state: ThermalState = {
    skinC: restingSkinC(inputs.ambientC, p),
    fluxRiseC: zoneMap((zone) => Math.max(0, inputs.powerW[zone]) * p.panelResistanceCPerW[zone]),
    insulation: zoneMap((zone) => (inputs.covered[zone] ? p.coveredFactor : 1)),
  };
  for (let i = 0; i < 200; i += 1) {
    const next = skinEquilibriumC(state, inputs.ambientC, p);
    const moved = Math.abs(next - state.skinC);
    state.skinC = next;
    if (moved < 1e-9) break;
  }
  return state;
}
