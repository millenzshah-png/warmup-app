import { describe, expect, it } from 'vitest';
import { PANEL_HARD_LIMIT_C, PANEL_LIMIT_C, PANEL_RESUME_C, TRIP_WINDOW_S } from '../src/core/spec';
import {
  FAULT_NONE,
  FAULT_PANEL_OVERTEMP,
  FAULT_SENSOR,
  clearFault,
  clearLockout,
  initialSafetyState,
  lockoutZone,
  stepSafety,
  zoneMayHeat,
  type SafetyClock,
  type SafetyState,
} from '../src/core/thermal/safety';
import type { ZoneMap } from '../src/core/types';

const MIDNIGHT = 1_000_000;
const clock = (uptimeS: number, epochS = 500_000): SafetyClock => ({ uptimeS, epochS, nextMidnightEpochS: MIDNIGHT });
const panels = (b: number, l = 38, r = 38): ZoneMap<number> => ({ L: l, R: r, B: b });
const read = (b: number, skin = 34) => ({ panelC: panels(b), skinC: skin });

function trip(state: SafetyState, at: number) {
  return stepSafety(state, read(PANEL_LIMIT_C + 0.2), clock(at));
}
function cool(state: SafetyState, at: number) {
  return stepSafety(state, read(PANEL_RESUME_C - 0.5), clock(at));
}

describe('zone cutoff', () => {
  it('does nothing while every panel is under the limit', () => {
    const { state, events } = stepSafety(initialSafetyState(), read(PANEL_LIMIT_C - 0.1), clock(10));
    expect(events).toEqual([]);
    expect(state.zones.B.status).toBe('ok');
    expect(zoneMayHeat(state, 'B')).toBe(true);
  });

  it('cuts a panel off the moment it reaches 113 °F', () => {
    const { state, events } = stepSafety(initialSafetyState(), read(PANEL_LIMIT_C), clock(10));
    expect(events).toEqual([{ type: 'trip', zone: 'B', peakC: PANEL_LIMIT_C }]);
    expect(state.zones.B.status).toBe('cutoff');
    expect(zoneMayHeat(state, 'B')).toBe(false);
    expect(zoneMayHeat(state, 'L')).toBe(true);
  });

  it('stays off until the panel is below 105 °F', () => {
    let { state } = trip(initialSafetyState(), 10);
    let step = stepSafety(state, read(PANEL_RESUME_C + 0.5), clock(20));
    expect(step.state.zones.B.status).toBe('cutoff');
    expect(step.events).toEqual([]);
    step = stepSafety(step.state, read(PANEL_RESUME_C - 0.1), clock(30));
    state = step.state;
    expect(state.zones.B.status).toBe('ok');
    expect(step.events).toEqual([{ type: 'clear', zone: 'B', tempC: PANEL_RESUME_C - 0.1 }]);
  });

  it('remembers the hottest reading of the episode', () => {
    let { state } = trip(initialSafetyState(), 10);
    state = stepSafety(state, read(PANEL_LIMIT_C + 1.5), clock(11)).state;
    state = stepSafety(state, read(PANEL_LIMIT_C - 2), clock(12)).state;
    expect(state.zones.B.peakC).toBeCloseTo(PANEL_LIMIT_C + 1.5, 9);
  });
});

describe('repeat trips', () => {
  it('locks the zone for the day on the third trip in ten minutes', () => {
    let state = initialSafetyState();
    state = cool(trip(state, 10).state, 60).state;
    state = cool(trip(state, 120).state, 180).state;
    const third = trip(state, 240);
    expect(third.events).toEqual([
      { type: 'trip', zone: 'B', peakC: PANEL_LIMIT_C + 0.2 },
      { type: 'lockout', zone: 'B', untilEpochS: MIDNIGHT },
    ]);
    expect(third.state.zones.B.status).toBe('lockout');
    expect(third.state.zones.B.lockoutUntilEpochS).toBe(MIDNIGHT);
    expect(zoneMayHeat(third.state, 'B')).toBe(false);
  });

  it('forgets trips that are more than ten minutes old', () => {
    let state = initialSafetyState();
    state = cool(trip(state, 10).state, 60).state;
    state = cool(trip(state, 120).state, 180).state;
    const late = trip(state, 10 + TRIP_WINDOW_S + 200);
    expect(late.state.zones.B.status).toBe('cutoff');
    expect(late.events.map((e) => e.type)).toEqual(['trip']);
  });

  it('does not come back from a lockout just because it cooled', () => {
    let state = lockoutZone(initialSafetyState(), 'B', MIDNIGHT);
    state = stepSafety(state, read(30), clock(100)).state;
    expect(state.zones.B.status).toBe('lockout');
  });

  it('lifts the lockout at local midnight', () => {
    const locked = lockoutZone(initialSafetyState(), 'B', MIDNIGHT);
    const before = stepSafety(locked, read(30), clock(100, MIDNIGHT - 1));
    expect(before.state.zones.B.status).toBe('lockout');
    const after = stepSafety(locked, read(30), clock(101, MIDNIGHT));
    expect(after.state.zones.B.status).toBe('ok');
    expect(after.events).toEqual([{ type: 'lockout-expired', zone: 'B' }]);
  });

  it('can be lifted early by the wearer', () => {
    const locked = lockoutZone(initialSafetyState(), 'B', MIDNIGHT);
    const cleared = clearLockout(locked, 'B');
    expect(cleared.zones.B.status).toBe('ok');
    expect(cleared.zones.B.lockoutUntilEpochS).toBeNull();
    expect(clearLockout(cleared, 'B')).toBe(cleared);
  });
});

describe('faults', () => {
  it('latches when the collar sensor returns nonsense', () => {
    for (const skin of [Number.NaN, 2, 60]) {
      const { state, events } = stepSafety(initialSafetyState(), read(38, skin), clock(5));
      expect(state.fault).toBe(FAULT_SENSOR);
      expect(events).toEqual([{ type: 'fault', code: FAULT_SENSOR }]);
      expect(zoneMayHeat(state, 'L')).toBe(false);
    }
  });

  it('latches when a panel passes the hard limit', () => {
    const { state } = stepSafety(initialSafetyState(), read(PANEL_HARD_LIMIT_C + 1), clock(5));
    expect(state.fault).toBe(FAULT_PANEL_OVERTEMP);
  });

  it('stays latched after the reading recovers, and reports only once', () => {
    let step = stepSafety(initialSafetyState(), read(38, Number.NaN), clock(5));
    step = stepSafety(step.state, read(38, 34), clock(6));
    expect(step.state.fault).toBe(FAULT_SENSOR);
    expect(step.events).toEqual([]);
    const cleared = clearFault(step.state);
    expect(cleared.fault).toBe(FAULT_NONE);
    expect(zoneMayHeat(cleared, 'L')).toBe(true);
    expect(clearFault(cleared)).toBe(cleared);
  });
});
