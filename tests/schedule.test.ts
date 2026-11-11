import { describe, expect, it } from 'vitest';
import { builtInMode } from '../src/core/modes';
import {
  DAY_LETTERS,
  DAY_NAMES,
  PREHEAT_CHOICES_MIN,
  defaultSchedule,
  describeDays,
  describeWhen,
  localDayNumber,
  localSecondOfDay,
  nextRun,
  scheduleSummary,
  shiftMinuteOfDay,
  toDeviceSchedule,
  weekdayIndex,
  type Schedule,
} from '../src/core/schedule/schedule';

const utc = (y: number, m: number, d: number, h = 0, min = 0): number => Date.UTC(y, m - 1, d, h, min) / 1000;
const on = (over: Partial<Schedule> = {}): Schedule => ({ ...defaultSchedule(), enabled: true, ...over });

describe('local time', () => {
  it('knows the weekday of a date', () => {
    // 2 November 2026 is a Monday.
    expect(weekdayIndex(localDayNumber(utc(2026, 11, 2, 12), 0))).toBe(0);
    expect(weekdayIndex(localDayNumber(utc(2026, 11, 8, 12), 0))).toBe(6);
    expect(weekdayIndex(0)).toBe(3);
    expect(weekdayIndex(-1)).toBe(2);
    expect(DAY_LETTERS).toHaveLength(7);
    expect(DAY_NAMES[0]).toBe('Monday');
  });

  it('shifts the day boundary with the time zone', () => {
    const t = utc(2026, 11, 3, 2, 30);
    expect(localDayNumber(t, 0)).toBe(localDayNumber(t, -480) + 1);
    expect(localSecondOfDay(t, 0)).toBe(2.5 * 3600);
    expect(localSecondOfDay(t, -480)).toBe(18.5 * 3600);
    expect(localSecondOfDay(t, 330)).toBe(8 * 3600);
  });
});

describe('the next preheat', () => {
  it('is today when the departure is still ahead', () => {
    const now = utc(2026, 11, 3, 6, 0);
    const next = nextRun(on(), now, 0);
    expect(next).toMatchObject({ departEpochS: utc(2026, 11, 3, 7, 20), startEpochS: utc(2026, 11, 3, 7, 10), inProgress: false });
  });

  it('is in progress during the preheat window', () => {
    expect(nextRun(on(), utc(2026, 11, 3, 7, 15), 0)?.inProgress).toBe(true);
  });

  it('moves to tomorrow once the departure has passed', () => {
    const next = nextRun(on(), utc(2026, 11, 3, 7, 20), 0);
    expect(next?.departEpochS).toBe(utc(2026, 11, 4, 7, 20));
  });

  it('skips the weekend on a weekday schedule', () => {
    const fridayEvening = utc(2026, 11, 6, 18, 0);
    expect(nextRun(on(), fridayEvening, 0)?.departEpochS).toBe(utc(2026, 11, 9, 7, 20));
  });

  it('finds the same weekday a week later when only one day is on', () => {
    const tuesdayOnly = on({ days: [false, true, false, false, false, false, false] });
    expect(nextRun(tuesdayOnly, utc(2026, 11, 3, 9, 0), 0)?.departEpochS).toBe(utc(2026, 11, 10, 7, 20));
  });

  it('works in the wearer\'s zone', () => {
    // 14:00 UTC on Tuesday is 06:00 in a zone eight hours behind.
    const next = nextRun(on(), utc(2026, 11, 3, 14, 0), -480);
    expect(next?.departEpochS).toBe(utc(2026, 11, 3, 15, 20));
  });

  it('is nothing when off or with no days', () => {
    expect(nextRun(defaultSchedule(), utc(2026, 11, 3, 6), 0)).toBeNull();
    expect(nextRun(on({ days: [false, false, false, false, false, false, false] }), utc(2026, 11, 3, 6), 0)).toBeNull();
  });
});

describe('wording', () => {
  it('describes sets of days', () => {
    expect(describeDays([true, true, true, true, true, false, false])).toBe('weekdays');
    expect(describeDays([true, true, true, true, true, true, true])).toBe('every day');
    expect(describeDays([false, false, false, false, false, true, true])).toBe('weekends');
    expect(describeDays([true, false, true, false, true, false, false])).toBe('Mon, Wed and Fri');
    expect(describeDays([false, false, false, true, false, false, false])).toBe('Thu');
    expect(describeDays([false, false, false, false, false, false, false])).toBe('no days');
  });

  it('summarises the schedule for the Settings row', () => {
    expect(scheduleSummary(on(), 'Commute')).toBe('Commute, weekdays at 7:20 AM');
    expect(scheduleSummary(defaultSchedule(), 'Commute')).toBe('Off · weekdays at 7:20 AM');
  });

  it('says when in plain words', () => {
    const now = utc(2026, 11, 3, 6, 0);
    expect(describeWhen(utc(2026, 11, 3, 7, 10), now, 0)).toBe('today at 7:10 AM');
    expect(describeWhen(utc(2026, 11, 4, 7, 10), now, 0)).toBe('tomorrow at 7:10 AM');
    expect(describeWhen(utc(2026, 11, 9, 7, 10), now, 0)).toBe('Monday at 7:10 AM');
  });
});

describe('helpers', () => {
  it('starts switched off, weekdays at 7:20 with a ten minute preheat', () => {
    expect(defaultSchedule()).toEqual({
      enabled: false,
      minuteOfDay: 440,
      days: [true, true, true, true, true, false, false],
      preheatMin: 10,
      modeId: 'commute',
    });
    expect(PREHEAT_CHOICES_MIN).toEqual([5, 10, 15, 20]);
  });

  it('wraps the clock around midnight', () => {
    expect(shiftMinuteOfDay(1435, 10)).toBe(5);
    expect(shiftMinuteOfDay(5, -10)).toBe(1435);
    expect(shiftMinuteOfDay(440, 60)).toBe(500);
  });

  it('packs itself for the hoodie', () => {
    const device = toDeviceSchedule(on(), builtInMode('commute'), 2);
    expect(device).toMatchObject({ enabled: true, minuteOfDay: 440, preheatMin: 10, level: 2 });
    expect(device.mode).toMatchObject({ slot: 2, targetF: 96, easeIndoors: true });
    expect(device.days).toEqual([true, true, true, true, true, false, false]);
  });
});
