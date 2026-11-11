/**
 * Usage history and the weekly summary on the Insights screen.
 *
 * The app folds each telemetry frame into one small record per local day.
 * Sixty days are kept, which is plenty for week-over-week comparisons and
 * small enough to live in local storage.
 */
import { weekdayIndex, DAY_LETTERS } from '../schedule/schedule';
import { fToC } from '../units';
import type { Level } from '../types';

export interface DayRecord {
  /** Local day number (days since the epoch in the wearer's zone). */
  day: number;
  /** Seconds with at least one panel heating. */
  heatS: number;
  /** Heating seconds per mode id. */
  modeS: Record<string, number>;
  /** Heating seconds per level. */
  levelS: [number, number, number];
  /** Sum of skin temperature times seconds, for a time-weighted mean, °C·s. */
  skinSumCS: number;
  /** Second of the day when heating first started, or null if it has not. */
  firstHeatAtS: number | null;
  /** Seconds at High within ten minutes of the day's first morning heat. */
  earlyHighS: number;
}

export interface History {
  /** Oldest first. */
  days: DayRecord[];
  /** True while the records include the built-in sample fortnight. */
  sample: boolean;
}

export const HISTORY_DAYS_KEPT = 60;
const MORNING_ENDS_AT_S = 11 * 3600;
const EARLY_WINDOW_S = 10 * 60;

export function emptyHistory(): History {
  return { days: [], sample: false };
}

function emptyDay(day: number): DayRecord {
  return { day, heatS: 0, modeS: {}, levelS: [0, 0, 0], skinSumCS: 0, firstHeatAtS: null, earlyHighS: 0 };
}

export interface HistorySample {
  day: number;
  secondOfDay: number;
  /** Seconds this sample covers. */
  dtS: number;
  heating: boolean;
  modeId: string;
  level: Level;
  skinC: number;
}

/** Fold one telemetry sample into the history. Returns a new History. */
export function recordSample(history: History, sample: HistorySample): History {
  if (!(sample.dtS > 0) || !sample.heating) return history;
  const days = history.days.slice();
  let index = days.length - 1;
  while (index >= 0 && (days[index]?.day ?? 0) > sample.day) index -= 1;
  let record = days[index];
  if (!record || record.day !== sample.day) {
    record = emptyDay(sample.day);
    days.splice(index + 1, 0, record);
    index += 1;
  }
  const firstHeatAtS = record.firstHeatAtS ?? sample.secondOfDay;
  const early =
    sample.level === 2 &&
    firstHeatAtS < MORNING_ENDS_AT_S &&
    sample.secondOfDay >= firstHeatAtS &&
    sample.secondOfDay - firstHeatAtS < EARLY_WINDOW_S;
  const levelS: [number, number, number] = [...record.levelS];
  levelS[sample.level] += sample.dtS;
  days[index] = {
    ...record,
    heatS: record.heatS + sample.dtS,
    modeS: { ...record.modeS, [sample.modeId]: (record.modeS[sample.modeId] ?? 0) + sample.dtS },
    levelS,
    skinSumCS: record.skinSumCS + sample.skinC * sample.dtS,
    firstHeatAtS,
    earlyHighS: record.earlyHighS + (early ? sample.dtS : 0),
  };
  const trimmed = days.length > HISTORY_DAYS_KEPT ? days.slice(days.length - HISTORY_DAYS_KEPT) : days;
  return { days: trimmed, sample: history.sample };
}

export interface DayBar {
  day: number;
  /** One-letter weekday label. */
  label: string;
  hours: number;
}

export interface ModeShare {
  modeId: string;
  /** Share of the week's heating time, 0 to 1. */
  fraction: number;
}

export interface WeekSummary {
  /** Seven bars, oldest first, ending on the requested day. */
  bars: DayBar[];
  /** Index of the tallest bar, or -1 when the week is empty. */
  peakIndex: number;
  totalS: number;
  /** Heating time in the seven days before this window. */
  previousTotalS: number;
  /** Whether there is anything recorded for the previous window. */
  hasPrevious: boolean;
  /** Time-weighted mean skin temperature while heating, or null. */
  avgSkinC: number | null;
  /** Modes by share of heating time, largest first. */
  modeShares: ModeShare[];
  levelS: [number, number, number];
  /** Days in the window with at least five early minutes at High. */
  earlyHighDays: number;
  earlyHighS: number;
}

function recordsBetween(history: History, firstDay: number, lastDay: number): DayRecord[] {
  return history.days.filter((d) => d.day >= firstDay && d.day <= lastDay);
}

/** Summarise the seven local days ending on `endDay`. */
export function weekSummary(history: History, endDay: number): WeekSummary {
  const firstDay = endDay - 6;
  const records = recordsBetween(history, firstDay, endDay);
  const byDay = new Map(records.map((r) => [r.day, r]));
  const bars: DayBar[] = [];
  for (let day = firstDay; day <= endDay; day += 1) {
    bars.push({ day, label: DAY_LETTERS[weekdayIndex(day)] ?? '', hours: (byDay.get(day)?.heatS ?? 0) / 3600 });
  }
  let peakIndex = -1;
  bars.forEach((bar, i) => {
    if (bar.hours > 0 && (peakIndex < 0 || bar.hours > (bars[peakIndex]?.hours ?? 0))) peakIndex = i;
  });

  const totalS = records.reduce((sum, r) => sum + r.heatS, 0);
  const previous = recordsBetween(history, firstDay - 7, firstDay - 1);
  const previousTotalS = previous.reduce((sum, r) => sum + r.heatS, 0);
  const skinSum = records.reduce((sum, r) => sum + r.skinSumCS, 0);

  const modeTotals = new Map<string, number>();
  const levelS: [number, number, number] = [0, 0, 0];
  let earlyHighDays = 0;
  let earlyHighS = 0;
  for (const r of records) {
    for (const [modeId, seconds] of Object.entries(r.modeS)) modeTotals.set(modeId, (modeTotals.get(modeId) ?? 0) + seconds);
    levelS[0] += r.levelS[0];
    levelS[1] += r.levelS[1];
    levelS[2] += r.levelS[2];
    earlyHighS += r.earlyHighS;
    if (r.earlyHighS >= 5 * 60) earlyHighDays += 1;
  }
  const modeShares: ModeShare[] = [...modeTotals.entries()]
    .filter(([, seconds]) => seconds > 0)
    .map(([modeId, seconds]) => ({ modeId, fraction: totalS > 0 ? seconds / totalS : 0 }))
    .sort((a, b) => b.fraction - a.fraction);

  return {
    bars,
    peakIndex,
    totalS,
    previousTotalS,
    hasPrevious: previous.length > 0,
    avgSkinC: totalS > 0 ? skinSum / totalS : null,
    modeShares,
    levelS,
    earlyHighDays,
    earlyHighS,
  };
}

/** Heating hours by weekday in the sample week, Monday first. */
const SAMPLE_WEEKDAY_MIN: readonly number[] = [144, 108, 186, 132, 158, 66, 66];
/** The week before the sample week ran this much longer in total, minutes. */
const SAMPLE_PREVIOUS_EXTRA_MIN = 130;
const SAMPLE_MODE_SHARES: Readonly<Record<string, number>> = { auto: 0.58, commute: 0.24, sick: 0.12, sleep: 0.06 };
const SAMPLE_AVG_SKIN_C = fToC(93.1);

/**
 * A believable fortnight of use ending on `today`, so the Insights screen has
 * something to show on first launch. Real use is added on top of it, and it
 * can be cleared from Settings.
 */
export function sampleHistory(today: number): History {
  const days: DayRecord[] = [];
  const perDayExtraS = (SAMPLE_PREVIOUS_EXTRA_MIN * 60) / 7;
  for (let day = today - 13; day <= today; day += 1) {
    const weekday = weekdayIndex(day);
    const inPreviousWeek = day <= today - 7;
    const heatS = (SAMPLE_WEEKDAY_MIN[weekday] ?? 0) * 60 + (inPreviousWeek ? perDayExtraS : 0);
    const modeS: Record<string, number> = {};
    for (const [modeId, share] of Object.entries(SAMPLE_MODE_SHARES)) modeS[modeId] = heatS * share;
    // Weekday mornings start on High for the first ten minutes.
    const earlyHighS = weekday < 5 ? 600 : 0;
    days.push({
      day,
      heatS,
      modeS,
      levelS: [heatS * 0.3, heatS * 0.7 - earlyHighS, earlyHighS],
      skinSumCS: SAMPLE_AVG_SKIN_C * heatS,
      firstHeatAtS: 7 * 3600 + 15 * 60,
      earlyHighS,
    });
  }
  return { days, sample: true };
}

/** "2h 10m less than last week", for the Heat time card. */
export function compareWithPrevious(summary: WeekSummary, formatDuration: (minutes: number) => string): string {
  if (!summary.hasPrevious) return 'First week on record';
  const deltaMin = Math.round((summary.totalS - summary.previousTotalS) / 60);
  if (Math.abs(deltaMin) < 5) return 'About the same as last week';
  return `${formatDuration(Math.abs(deltaMin))} ${deltaMin < 0 ? 'less' : 'more'} than last week`;
}

/** How the week's average skin temperature sits against a target, in words. */
export function describeAverage(avgSkinC: number | null, targetF: number, modeName: string): string {
  if (avgSkinC === null) return 'No heat recorded yet';
  const deltaC = avgSkinC - fToC(targetF);
  if (Math.abs(deltaC) <= fToC(33) - fToC(32)) return `Right in your ${modeName} range`;
  return deltaC > 0 ? `Above your ${modeName} target` : `Below your ${modeName} target`;
}
