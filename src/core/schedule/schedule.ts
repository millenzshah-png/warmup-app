/**
 * The Commute preheat schedule, as the app stores and describes it.
 *
 * The hoodie keeps its own copy and runs it by its own clock, so a preheat
 * still happens when the phone is asleep in a pocket.
 */
import type { ModeConfig } from '../modes';
import { modeParamsFromConfig, type DeviceSchedule } from '../protocol/commands';
import type { Level } from '../types';
import { formatClock } from '../units';

export type Days = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

export interface Schedule {
  enabled: boolean;
  /** Departure time as a minute of the local day. */
  minuteOfDay: number;
  /** Monday first. */
  days: Days;
  preheatMin: number;
  /** The mode the preheat runs. */
  modeId: string;
}

export const DAY_LETTERS: readonly string[] = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const DAY_NAMES: readonly string[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const PREHEAT_CHOICES_MIN: readonly number[] = [5, 10, 15, 20];

/** Weekdays at 7:20 AM with a ten minute preheat, switched off until the wearer opts in. */
export function defaultSchedule(): Schedule {
  return {
    enabled: false,
    minuteOfDay: 7 * 60 + 20,
    days: [true, true, true, true, true, false, false],
    preheatMin: 10,
    modeId: 'commute',
  };
}

/** Local time as seconds since the epoch, shifted into the wearer's zone. */
export function localSeconds(epochS: number, tzOffsetMin: number): number {
  return epochS + tzOffsetMin * 60;
}

/** Whole local days since the epoch. */
export function localDayNumber(epochS: number, tzOffsetMin: number): number {
  return Math.floor(localSeconds(epochS, tzOffsetMin) / 86400);
}

/** Seconds since local midnight. */
export function localSecondOfDay(epochS: number, tzOffsetMin: number): number {
  const local = localSeconds(epochS, tzOffsetMin);
  return local - Math.floor(local / 86400) * 86400;
}

/** Weekday of a local day number, Monday = 0. The epoch began on a Thursday. */
export function weekdayIndex(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

export interface NextRun {
  /** Local day number of the departure. */
  day: number;
  /** When heating starts, epoch seconds. */
  startEpochS: number;
  /** The departure time itself, epoch seconds. */
  departEpochS: number;
  /** True when the preheat window is open right now. */
  inProgress: boolean;
}

/** The next preheat, or null when the schedule is off or has no days. */
export function nextRun(schedule: Schedule, nowEpochS: number, tzOffsetMin: number): NextRun | null {
  if (!schedule.enabled || !schedule.days.some(Boolean)) return null;
  const today = localDayNumber(nowEpochS, tzOffsetMin);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = today + offset;
    if (!schedule.days[weekdayIndex(day)]) continue;
    const departEpochS = day * 86400 + schedule.minuteOfDay * 60 - tzOffsetMin * 60;
    if (departEpochS <= nowEpochS) continue;
    const startEpochS = departEpochS - schedule.preheatMin * 60;
    return { day, startEpochS, departEpochS, inProgress: nowEpochS >= startEpochS };
  }
  return null;
}

/** "weekdays", "every day", "weekends", "Mon, Wed and Fri" or "no days". */
export function describeDays(days: readonly boolean[]): string {
  const on = days.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  if (on.length === 0) return 'no days';
  if (on.length === 7) return 'every day';
  const key = on.join('');
  if (key === '01234') return 'weekdays';
  if (key === '56') return 'weekends';
  const names = on.map((i) => DAY_SHORT[i] ?? '');
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One line for the Settings row: "Commute, weekdays at 7:20 AM". */
export function scheduleSummary(schedule: Schedule, modeName: string): string {
  const when = `${describeDays(schedule.days)} at ${formatClock(schedule.minuteOfDay)}`;
  return schedule.enabled ? `${modeName}, ${when}` : `Off · ${when}`;
}

/** "today at 7:10 AM", "tomorrow at 7:10 AM" or "Monday at 7:10 AM". */
export function describeWhen(epochS: number, nowEpochS: number, tzOffsetMin: number): string {
  const day = localDayNumber(epochS, tzOffsetMin);
  const today = localDayNumber(nowEpochS, tzOffsetMin);
  const clock = formatClock(Math.floor(localSecondOfDay(epochS, tzOffsetMin) / 60));
  if (day === today) return `today at ${clock}`;
  if (day === today + 1) return `tomorrow at ${clock}`;
  return `${DAY_NAMES[weekdayIndex(day)]} at ${clock}`;
}

/** The form of the schedule that is written to the hoodie. */
export function toDeviceSchedule(schedule: Schedule, mode: ModeConfig, level: Level): DeviceSchedule {
  return {
    enabled: schedule.enabled,
    minuteOfDay: schedule.minuteOfDay,
    days: [...schedule.days] as Days,
    preheatMin: schedule.preheatMin,
    mode: modeParamsFromConfig(mode),
    level,
  };
}

/** Step a clock time by whole minutes, wrapping around midnight. */
export function shiftMinuteOfDay(minuteOfDay: number, deltaMin: number): number {
  return (((minuteOfDay + deltaMin) % 1440) + 1440) % 1440;
}
