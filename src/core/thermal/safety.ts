/**
 * Over-temperature protection.
 *
 * This runs on the hoodie, below the heat controller, and nothing the app
 * sends can switch it off. Each panel has its own state machine:
 *
 *   ok ── panel reaches 113 °F ──▶ cutoff ── cools below 105 °F ──▶ ok
 *                                     │
 *                      third trip in ten minutes
 *                                     ▼
 *                                  lockout (until local midnight)
 *
 * On top of that a latching fault disables all heating when a sensor reads
 * something impossible or a panel passes the hard limit.
 */
import {
  PANEL_HARD_LIMIT_C,
  PANEL_LIMIT_C,
  PANEL_RESUME_C,
  TRIPS_BEFORE_LOCKOUT,
  TRIP_WINDOW_S,
} from '../spec';
import { ZONE_IDS, zoneMap, type ZoneId, type ZoneMap } from '../types';

export type ZoneSafetyStatus = 'ok' | 'cutoff' | 'lockout';

export const FAULT_NONE = 0;
/** A panel passed the hard limit. Heating stays off until the fault is cleared. */
export const FAULT_PANEL_OVERTEMP = 1;
/** A temperature sensor returned an impossible reading. */
export const FAULT_SENSOR = 2;
export type FaultCode = typeof FAULT_NONE | typeof FAULT_PANEL_OVERTEMP | typeof FAULT_SENSOR;

export const FAULT_LABELS: Record<FaultCode, string> = {
  [FAULT_NONE]: 'No fault',
  [FAULT_PANEL_OVERTEMP]: 'A panel went past its hard limit',
  [FAULT_SENSOR]: 'A temperature sensor is not reading correctly',
};

export interface ZoneSafety {
  status: ZoneSafetyStatus;
  /** Uptime of recent trips, used to count repeats inside the window. */
  tripTimesS: number[];
  /** Highest reading seen during the current or most recent cutoff, °C. */
  peakC: number;
  /** Epoch seconds when a lockout ends, or null when not locked out. */
  lockoutUntilEpochS: number | null;
}

export interface SafetyState {
  zones: ZoneMap<ZoneSafety>;
  fault: FaultCode;
}

export type SafetyEvent =
  | { type: 'trip'; zone: ZoneId; peakC: number }
  | { type: 'clear'; zone: ZoneId; tempC: number }
  | { type: 'lockout'; zone: ZoneId; untilEpochS: number }
  | { type: 'lockout-expired'; zone: ZoneId }
  | { type: 'fault'; code: FaultCode };

export interface SafetyReadings {
  panelC: ZoneMap<number>;
  skinC: number;
}

export interface SafetyClock {
  /** Seconds since the controller booted. */
  uptimeS: number;
  /** Wall clock, epoch seconds. */
  epochS: number;
  /** Epoch seconds of the next local midnight, where day lockouts end. */
  nextMidnightEpochS: number;
}

export function initialSafetyState(): SafetyState {
  return {
    zones: zoneMap(() => ({ status: 'ok', tripTimesS: [], peakC: 0, lockoutUntilEpochS: null })),
    fault: FAULT_NONE,
  };
}

function plausible(tempC: number, min: number, max: number): boolean {
  return Number.isFinite(tempC) && tempC >= min && tempC <= max;
}

/** True when a panel is allowed to draw power right now. */
export function zoneMayHeat(state: SafetyState, zone: ZoneId): boolean {
  return state.fault === FAULT_NONE && state.zones[zone].status === 'ok';
}

/** Evaluate one tick of the safety logic. Pure: returns a new state. */
export function stepSafety(
  state: SafetyState,
  readings: SafetyReadings,
  clock: SafetyClock,
): { state: SafetyState; events: SafetyEvent[] } {
  const events: SafetyEvent[] = [];
  let fault = state.fault;

  if (fault === FAULT_NONE) {
    const sensorsOk =
      plausible(readings.skinC, 5, 45) && ZONE_IDS.every((zone) => plausible(readings.panelC[zone], -20, 90));
    if (!sensorsOk) fault = FAULT_SENSOR;
    else if (ZONE_IDS.some((zone) => readings.panelC[zone] >= PANEL_HARD_LIMIT_C)) fault = FAULT_PANEL_OVERTEMP;
    if (fault !== FAULT_NONE) events.push({ type: 'fault', code: fault });
  }

  const zones = zoneMap((zone): ZoneSafety => {
    const previous = state.zones[zone];
    const tempC = readings.panelC[zone];
    const tripTimesS = previous.tripTimesS.filter((t) => clock.uptimeS - t <= TRIP_WINDOW_S);

    if (previous.status === 'lockout') {
      if (previous.lockoutUntilEpochS !== null && clock.epochS >= previous.lockoutUntilEpochS) {
        events.push({ type: 'lockout-expired', zone });
        return { status: 'ok', tripTimesS: [], peakC: previous.peakC, lockoutUntilEpochS: null };
      }
      return { ...previous, tripTimesS };
    }

    if (previous.status === 'cutoff') {
      const peakC = Number.isFinite(tempC) ? Math.max(previous.peakC, tempC) : previous.peakC;
      if (Number.isFinite(tempC) && tempC < PANEL_RESUME_C) {
        events.push({ type: 'clear', zone, tempC });
        return { status: 'ok', tripTimesS, peakC, lockoutUntilEpochS: null };
      }
      return { status: 'cutoff', tripTimesS, peakC, lockoutUntilEpochS: null };
    }

    if (Number.isFinite(tempC) && tempC >= PANEL_LIMIT_C) {
      const trips = [...tripTimesS, clock.uptimeS];
      events.push({ type: 'trip', zone, peakC: tempC });
      if (trips.length >= TRIPS_BEFORE_LOCKOUT) {
        events.push({ type: 'lockout', zone, untilEpochS: clock.nextMidnightEpochS });
        return { status: 'lockout', tripTimesS: trips, peakC: tempC, lockoutUntilEpochS: clock.nextMidnightEpochS };
      }
      return { status: 'cutoff', tripTimesS: trips, peakC: tempC, lockoutUntilEpochS: null };
    }

    return { ...previous, tripTimesS };
  });

  return { state: { zones, fault }, events };
}

/** Lock a zone out by request, for example "turn the back zone off for today". */
export function lockoutZone(state: SafetyState, zone: ZoneId, untilEpochS: number): SafetyState {
  return {
    ...state,
    zones: { ...state.zones, [zone]: { ...state.zones[zone], status: 'lockout', lockoutUntilEpochS: untilEpochS } },
  };
}

/** Lift a lockout early. The zone still has to be under the limit to heat. */
export function clearLockout(state: SafetyState, zone: ZoneId): SafetyState {
  const current = state.zones[zone];
  if (current.status !== 'lockout') return state;
  return {
    ...state,
    zones: { ...state.zones, [zone]: { ...current, status: 'ok', tripTimesS: [], lockoutUntilEpochS: null } },
  };
}

export function clearFault(state: SafetyState): SafetyState {
  return state.fault === FAULT_NONE ? state : { ...state, fault: FAULT_NONE };
}
