import { describe, expect, it } from 'vitest';
import {
  cToF,
  clamp,
  clockParts,
  deltaCToF,
  deltaFToC,
  fToC,
  formatClock,
  formatDuration,
  formatHours,
  formatMinutesInWords,
  formatPanelTemp,
  formatPercent,
  formatTarget,
  formatTargetWithUnit,
  formatTemp,
  formatTempWithUnit,
  lerp,
  roundTo,
} from '../src/core/units';
import { compareVersions, formatVersion, maskToZones, parseVersion, zonesToMask, countZones } from '../src/core/types';

describe('temperature conversion', () => {
  it('converts the fixed points', () => {
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBeCloseTo(100, 10);
    expect(cToF(37)).toBeCloseTo(98.6, 10);
  });

  it('round-trips', () => {
    for (const f of [-40, 0, 88, 93, 99, 113]) expect(cToF(fToC(f))).toBeCloseTo(f, 9);
  });

  it('converts differences without the 32 degree offset', () => {
    expect(deltaFToC(9)).toBeCloseTo(5, 10);
    expect(deltaCToF(5)).toBeCloseTo(9, 10);
  });
});

describe('number helpers', () => {
  it('clamps and interpolates', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(roundTo(93.449, 1)).toBe(93.4);
  });
});

describe('temperature formatting', () => {
  it('shows a reading in either unit', () => {
    const c = fToC(93.4);
    expect(formatTemp(c, 'F')).toBe('93.4');
    expect(formatTemp(c, 'C')).toBe('34.1');
    expect(formatTempWithUnit(c, 'F')).toBe('93.4°F');
    expect(formatPanelTemp(fToC(102.4), 'F')).toBe('102°F');
  });

  it('never prints negative zero', () => {
    expect(formatTemp(-0.01, 'C')).toBe('0.0');
  });

  it('shows targets as whole Fahrenheit or tenths of Celsius', () => {
    expect(formatTarget(93, 'F')).toBe('93');
    expect(formatTarget(93, 'C')).toBe('33.9');
    expect(formatTargetWithUnit(95, 'F')).toBe('95°F');
    expect(formatTargetWithUnit(95, 'C')).toBe('35.0°C');
  });
});

describe('duration formatting', () => {
  it('pads minutes under an hour mark', () => {
    expect(formatDuration(195)).toBe('3h 15m');
    expect(formatDuration(185)).toBe('3h 05m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(60)).toBe('1h 00m');
  });

  it('shows a dash when there is no estimate', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('formats hours and spelled-out minutes', () => {
    expect(formatHours(6.5)).toBe('6h 30m');
    expect(formatMinutesInWords(120)).toBe('2 hours');
    expect(formatMinutesInWords(60)).toBe('1 hour');
    expect(formatMinutesInWords(90)).toBe('90 minutes');
    expect(formatMinutesInWords(1)).toBe('1 minute');
  });
});

describe('clock formatting', () => {
  it('handles morning, noon, evening and midnight', () => {
    expect(formatClock(7 * 60 + 20)).toBe('7:20 AM');
    expect(formatClock(12 * 60)).toBe('12:00 PM');
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(23 * 60 + 5)).toBe('11:05 PM');
  });

  it('wraps out-of-range minutes', () => {
    expect(clockParts(1440 + 61)).toEqual({ time: '1:01', period: 'AM' });
    expect(clockParts(-60)).toEqual({ time: '11:00', period: 'PM' });
  });
});

describe('percent', () => {
  it('rounds and clamps', () => {
    expect(formatPercent(0.784)).toBe('78');
    expect(formatPercent(1.4)).toBe('100');
    expect(formatPercent(-1)).toBe('0');
  });
});

describe('zone masks', () => {
  it('round-trips every combination', () => {
    for (let mask = 0; mask < 8; mask += 1) expect(zonesToMask(maskToZones(mask))).toBe(mask);
  });

  it('counts enabled zones', () => {
    expect(countZones({ L: true, R: false, B: true })).toBe(2);
    expect(countZones({ L: false, R: false, B: false })).toBe(0);
  });
});

describe('versions', () => {
  it('parses, formats and compares', () => {
    expect(parseVersion('1.3.0')).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(formatVersion({ major: 1, minor: 2, patch: 10 })).toBe('1.2.10');
    expect(compareVersions(parseVersion('1.3.0'), parseVersion('1.2.9'))).toBeGreaterThan(0);
    expect(compareVersions(parseVersion('1.2.0'), parseVersion('1.2.0'))).toBe(0);
    expect(compareVersions(parseVersion('0.9.9'), parseVersion('1.0.0'))).toBeLessThan(0);
  });

  it('rejects malformed text', () => {
    expect(() => parseVersion('1.2')).toThrow();
    expect(() => parseVersion('a.b.c')).toThrow();
    expect(() => parseVersion('1.2.300')).toThrow();
  });
});
