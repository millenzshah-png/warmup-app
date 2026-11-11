/**
 * The heat controller that runs on the hoodie.
 *
 * Input is the collar sensor and a target. Output is a duty between 0 and 1
 * that the firmware multiplies by the level's power cap. Two strategies:
 *
 *   pulse  A PI loop whose output is time-proportioned into bursts. It holds
 *          the target closely and spends only what it needs.
 *   hold   A plain thermostat with hysteresis. It overshoots a little, which
 *          feels the same but costs battery. This is what "Pulse heat: off"
 *          selects in a custom mode.
 *
 * Both are slew limited on the way up so a mode's ramp speed is honoured, and
 * both come down quickly so nothing lingers when the target is reached.
 */
import type { RampSpeed } from '../types';
import { clamp } from '../units';

export interface ControllerTuning {
  /** Proportional gain, duty per °C of error. */
  kp: number;
  /** Integral gain, duty per °C per second. */
  ki: number;
  /** Maximum duty increase per second for each ramp speed. */
  rampUpPerS: Record<RampSpeed, number>;
  /** Maximum duty decrease per second. */
  rampDownPerS: number;
  /** Length of one time-proportioning window, seconds. */
  windowS: number;
  /** Thermostat switches off this far above target, °C. */
  holdAboveC: number;
  /** Thermostat switches back on this far below target, °C. */
  holdBelowC: number;
}

export const DEFAULT_CONTROLLER_TUNING: ControllerTuning = {
  kp: 1.0,
  ki: 0.004,
  rampUpPerS: { slow: 1 / 180, normal: 1 / 60, fast: 1 / 15 },
  rampDownPerS: 1 / 8,
  windowS: 20,
  holdAboveC: 0.35,
  holdBelowC: 0.1,
};

export interface ControllerState {
  /** Integral term of the PI loop, already in duty units. */
  integral: number;
  /** Commanded duty after the slew limit, 0 to 1. */
  duty: number;
  /** Whether the hold thermostat is currently calling for heat. */
  thermostatOn: boolean;
  /** Position inside the current time-proportioning window, seconds. */
  windowPhaseS: number;
}

export interface ControllerInput {
  /** False switches the controller off and clears its memory. */
  enabled: boolean;
  skinC: number;
  targetC: number;
  ramp: RampSpeed;
  pulse: boolean;
  /** Upper bound on duty, used by the Sleep fade. 1 means no cap. */
  dutyCap: number;
}

export function initialControllerState(): ControllerState {
  return { integral: 0, duty: 0, thermostatOn: false, windowPhaseS: 0 };
}

/** A controller that has already settled at a given duty. */
export function settledControllerState(duty: number): ControllerState {
  const d = clamp(duty, 0, 1);
  return { integral: d, duty: d, thermostatOn: d > 0, windowPhaseS: 0 };
}

/** Advance the controller by dt seconds and return its new state. */
export function stepController(
  state: ControllerState,
  input: ControllerInput,
  dtS: number,
  tuning: ControllerTuning = DEFAULT_CONTROLLER_TUNING,
): ControllerState {
  if (!input.enabled) return initialControllerState();
  if (!(dtS > 0)) return state;

  const cap = clamp(input.dutyCap, 0, 1);
  const error = input.targetC - input.skinC;
  let integral = state.integral;
  let thermostatOn = state.thermostatOn;
  let wanted: number;

  if (input.pulse) {
    const unclamped = tuning.kp * error + integral;
    wanted = clamp(unclamped, 0, cap);
    // Conditional integration: only accumulate while the output can still
    // move in the direction the error is pushing, and while the slew limit
    // is not what is holding the output back.
    const saturatedHigh = unclamped >= cap && error > 0;
    const saturatedLow = unclamped <= 0 && error < 0;
    const slewLimited = wanted - state.duty > 0.1 && error > 0;
    if (!saturatedHigh && !saturatedLow && !slewLimited) {
      integral = clamp(integral + tuning.ki * error * dtS, 0, 1);
    }
    thermostatOn = wanted > 0;
  } else {
    if (thermostatOn && error <= -tuning.holdAboveC) thermostatOn = false;
    else if (!thermostatOn && error >= tuning.holdBelowC) thermostatOn = true;
    wanted = thermostatOn ? cap : 0;
    integral = 0;
  }

  const maxUp = tuning.rampUpPerS[input.ramp] * dtS;
  const maxDown = tuning.rampDownPerS * dtS;
  const duty = clamp(state.duty + clamp(wanted - state.duty, -maxDown, maxUp), 0, 1);
  const windowPhaseS = (state.windowPhaseS + dtS) % tuning.windowS;

  return { integral, duty, thermostatOn, windowPhaseS };
}

/**
 * Whether the heaters are energised at this instant. The duty is delivered as
 * one burst per window, so a duty of 0.4 means on for 8 s of every 20 s.
 * Very small and very large duties skip the switching altogether.
 */
export function heaterIsOn(state: ControllerState, tuning: ControllerTuning = DEFAULT_CONTROLLER_TUNING): boolean {
  if (state.duty <= 0.02) return false;
  if (state.duty >= 0.98) return true;
  return state.windowPhaseS < state.duty * tuning.windowS;
}
