import { describe, expect, it } from 'vitest';
import {
  HISTORY_DAYS_KEPT,
  compareWithPrevious,
  describeAverage,
  emptyHistory,
  recordSample,
  sampleHistory,
  weekSummary,
  type History,
  type HistorySample,
} from '../src/core/insights/history';
import { earlyHighCostMin, pickTip } from '../src/core/insights/tips';
import { defaultSchedule, weekdayIndex } from '../src/core/schedule/schedule';
import { cToF, fToC, formatDuration } from '../src/core/units';

// A Sunday, so a window ending here runs Monday to Sunday.
const SUNDAY = 20_765;

const sample = (over: Partial<HistorySample> = {}): HistorySample => ({
  day: SUNDAY,
  secondOfDay: 8 * 3600,
  dtS: 60,
  heating: true,
  modeId: 'auto',
  level: 1,
  skinC: 34,
  ...over,
});

function fold(history: History, samples: Partial<HistorySample>[]): History {
  return samples.reduce((h, s) => recordSample(h, sample(s)), history);
}

describe('recording', () => {
  it('confirms the fixture really is a Sunday', () => {
    expect(weekdayIndex(SUNDAY)).toBe(6);
  });

  it('adds heating time to the right day, mode and level', () => {
    const h = fold(emptyHistory(), [{}, { modeId: 'sick', level: 2 }, { dtS: 30 }]);
    expect(h.days).toHaveLength(1);
    const day = h.days[0];
    expect(day).toMatchObject({ day: SUNDAY, heatS: 150, modeS: { auto: 90, sick: 60 }, levelS: [0, 90, 60] });
    expect(day?.skinSumCS).toBeCloseTo(34 * 150, 9);
  });

  it('ignores samples with no heat or no time', () => {
    const h = emptyHistory();
    expect(recordSample(h, sample({ heating: false }))).toBe(h);
    expect(recordSample(h, sample({ dtS: 0 }))).toBe(h);
  });

  it('never mutates the history it is given', () => {
    const before = fold(emptyHistory(), [{}]);
    const frozen = JSON.stringify(before);
    fold(before, [{}, { day: SUNDAY + 1 }]);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('keeps days in order even when a late sample arrives for an earlier day', () => {
    const h = fold(emptyHistory(), [{ day: SUNDAY }, { day: SUNDAY + 2 }, { day: SUNDAY + 1 }, { day: SUNDAY - 3 }]);
    expect(h.days.map((d) => d.day)).toEqual([SUNDAY - 3, SUNDAY, SUNDAY + 1, SUNDAY + 2]);
  });

  it('keeps at most sixty days', () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_DAYS_KEPT + 15; i += 1) h = recordSample(h, sample({ day: SUNDAY + i }));
    expect(h.days).toHaveLength(HISTORY_DAYS_KEPT);
    expect(h.days[0]?.day).toBe(SUNDAY + 15);
  });

  it('counts High in the first ten minutes of a morning', () => {
    const start = 7 * 3600;
    const h = fold(emptyHistory(), [
      { secondOfDay: start, level: 2, dtS: 300 },
      { secondOfDay: start + 300, level: 2, dtS: 300 },
      { secondOfDay: start + 600, level: 2, dtS: 300 },
      { secondOfDay: start + 900, level: 1, dtS: 300 },
    ]);
    expect(h.days[0]?.earlyHighS).toBe(600);
    expect(h.days[0]?.firstHeatAtS).toBe(start);
  });

  it('does not count High later in the day or at lower levels', () => {
    const afternoon = fold(emptyHistory(), [{ secondOfDay: 15 * 3600, level: 2, dtS: 300 }]);
    expect(afternoon.days[0]?.earlyHighS).toBe(0);
    const medium = fold(emptyHistory(), [{ secondOfDay: 7 * 3600, level: 1, dtS: 300 }]);
    expect(medium.days[0]?.earlyHighS).toBe(0);
  });
});

describe('the weekly summary', () => {
  it('lays out seven bars ending on the requested day', () => {
    const h = fold(emptyHistory(), [
      { day: SUNDAY - 6, dtS: 3600 },
      { day: SUNDAY - 4, dtS: 7200 },
      { day: SUNDAY, dtS: 1800 },
    ]);
    const week = weekSummary(h, SUNDAY);
    expect(week.bars.map((b) => b.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(week.bars.map((b) => b.hours)).toEqual([1, 0, 2, 0, 0, 0, 0.5]);
    expect(week.peakIndex).toBe(2);
    expect(week.totalS).toBe(12_600);
  });

  it('has no peak in an empty week', () => {
    const week = weekSummary(emptyHistory(), SUNDAY);
    expect(week.peakIndex).toBe(-1);
    expect(week.totalS).toBe(0);
    expect(week.avgSkinC).toBeNull();
    expect(week.modeShares).toEqual([]);
    expect(week.hasPrevious).toBe(false);
  });

  it('weights the average skin temperature by time', () => {
    const h = fold(emptyHistory(), [
      { dtS: 3000, skinC: 34 },
      { dtS: 1000, skinC: 30 },
    ]);
    expect(weekSummary(h, SUNDAY).avgSkinC).toBeCloseTo(33, 9);
  });

  it('ranks modes by share', () => {
    const h = fold(emptyHistory(), [
      { modeId: 'sleep', dtS: 100 },
      { modeId: 'auto', dtS: 600 },
      { modeId: 'sick', dtS: 300 },
    ]);
    const shares = weekSummary(h, SUNDAY).modeShares;
    expect(shares.map((s) => s.modeId)).toEqual(['auto', 'sick', 'sleep']);
    expect(shares[0]?.fraction).toBeCloseTo(0.6, 9);
    expect(shares.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1, 9);
  });

  it('compares with the seven days before', () => {
    const h = fold(emptyHistory(), [
      { day: SUNDAY - 8, dtS: 7200 },
      { day: SUNDAY - 1, dtS: 3600 },
    ]);
    const week = weekSummary(h, SUNDAY);
    expect(week.previousTotalS).toBe(7200);
    expect(week.hasPrevious).toBe(true);
    expect(compareWithPrevious(week, formatDuration)).toBe('1h 00m less than last week');
    expect(compareWithPrevious(weekSummary(h, SUNDAY - 7), formatDuration)).toBe('First week on record');
  });

  it('calls a small difference about the same', () => {
    const h = fold(emptyHistory(), [
      { day: SUNDAY - 8, dtS: 3600 },
      { day: SUNDAY - 1, dtS: 3720 },
    ]);
    expect(compareWithPrevious(weekSummary(h, SUNDAY), formatDuration)).toBe('About the same as last week');
  });

  it('describes the average against a target', () => {
    expect(describeAverage(fToC(93.1), 93, 'Auto')).toBe('Right in your Auto range');
    expect(describeAverage(fToC(95), 93, 'Auto')).toBe('Above your Auto target');
    expect(describeAverage(fToC(90), 93, 'Auto')).toBe('Below your Auto target');
    expect(describeAverage(null, 93, 'Auto')).toBe('No heat recorded yet');
  });
});

describe('the sample fortnight', () => {
  const week = weekSummary(sampleHistory(SUNDAY), SUNDAY);

  it('matches the numbers in the design', () => {
    expect(formatDuration(week.totalS / 60)).toBe('14h 20m');
    expect(compareWithPrevious(week, formatDuration)).toBe('2h 10m less than last week');
    expect(cToF(week.avgSkinC ?? 0)).toBeCloseTo(93.1, 6);
    expect(week.bars.map((b) => Number(b.hours.toFixed(1)))).toEqual([2.4, 1.8, 3.1, 2.2, 2.6, 1.1, 1.1]);
    expect(week.peakIndex).toBe(2);
  });

  it('splits the modes 58, 24, 12 and 6 percent', () => {
    expect(week.modeShares.map((s) => [s.modeId, Math.round(s.fraction * 100)])).toEqual([
      ['auto', 58],
      ['commute', 24],
      ['sick', 12],
      ['sleep', 6],
    ]);
  });

  it('totals the same whichever weekday it ends on', () => {
    for (let offset = 0; offset < 7; offset += 1) {
      const end = SUNDAY + offset;
      expect(Math.round(weekSummary(sampleHistory(end), end).totalS / 60)).toBe(860);
    }
  });

  it('is marked as sample data', () => {
    expect(sampleHistory(SUNDAY).sample).toBe(true);
    expect(emptyHistory().sample).toBe(false);
  });
});

describe('tips', () => {
  const week = weekSummary(sampleHistory(SUNDAY), SUNDAY);
  const off = defaultSchedule();
  const on = { ...defaultSchedule(), enabled: true };

  it('suggests a preheat to someone who starts most mornings on High', () => {
    const tip = pickTip(week, off);
    expect(tip.id).toBe('morning-high');
    expect(tip.body).toMatch(/Commute preheat/);
    expect(tip.body).toMatch(/about \d+ minutes of battery a week/);
    expect(tip.action).toEqual({ label: 'Set up a preheat', route: '/schedule' });
  });

  it('changes its advice once the preheat is on', () => {
    expect(pickTip(week, on).id).toBe('preheat-working');
  });

  it('prices the habit from the level powers', () => {
    expect(earlyHighCostMin(0)).toBe(0);
    const fiftyMinutes = earlyHighCostMin(50 * 60);
    expect(fiftyMinutes).toBeGreaterThan(15);
    expect(fiftyMinutes).toBeLessThan(35);
  });

  it('waits for data before saying anything', () => {
    expect(pickTip(weekSummary(emptyHistory(), SUNDAY), off).id).toBe('no-data');
  });

  it('points out a week spent mostly on High', () => {
    const h = fold(emptyHistory(), [{ secondOfDay: 15 * 3600, level: 2, dtS: 7200 }]);
    expect(pickTip(weekSummary(h, SUNDAY), off).id).toBe('mostly-high');
  });

  it('credits Auto when it did most of the work', () => {
    const h = fold(emptyHistory(), [{ secondOfDay: 15 * 3600, modeId: 'auto', dtS: 7200 }]);
    expect(pickTip(weekSummary(h, SUNDAY), off).id).toBe('auto-efficient');
  });

  it('has nothing to add otherwise', () => {
    const h = fold(emptyHistory(), [{ secondOfDay: 15 * 3600, modeId: 'sick', dtS: 7200 }]);
    expect(pickTip(weekSummary(h, SUNDAY), off).id).toBe('all-good');
  });
});
