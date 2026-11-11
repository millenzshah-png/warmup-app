/**
 * Unit conversion and display formatting.
 *
 * The physics, firmware and telemetry all work in degrees Celsius. Targets are
 * stored in whole degrees Fahrenheit because that is how the product is
 * specified (88 to 99 °F). Conversion happens only at the display edge.
 */
import type { TempUnit } from './types';

export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const cToF = (c: number): number => (c * 9) / 5 + 32;

/** Convert a temperature difference rather than an absolute temperature. */
export const deltaFToC = (df: number): number => (df * 5) / 9;
export const deltaCToF = (dc: number): number => (dc * 9) / 5;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function roundTo(value: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

/** A Celsius reading in the user's unit, as a bare number string: "93.4". */
export function formatTemp(celsius: number, unit: TempUnit, digits = 1): string {
  const value = unit === 'F' ? cToF(celsius) : celsius;
  // Avoid "-0.0".
  const rounded = roundTo(value, digits) + 0;
  return rounded.toFixed(digits);
}

/** "93.4°F" */
export function formatTempWithUnit(celsius: number, unit: TempUnit, digits = 1): string {
  return `${formatTemp(celsius, unit, digits)}°${unit}`;
}

/**
 * A whole-Fahrenheit target in the user's unit. Fahrenheit shows as an integer
 * ("93"), Celsius to one decimal ("33.9") so that each one-degree-Fahrenheit
 * step stays visible.
 */
export function formatTarget(targetF: number, unit: TempUnit): string {
  return unit === 'F' ? String(Math.round(targetF)) : fToC(targetF).toFixed(1);
}

export function formatTargetWithUnit(targetF: number, unit: TempUnit): string {
  return `${formatTarget(targetF, unit)}°${unit}`;
}

/** A panel reading rounded to a whole degree: "102°F". */
export function formatPanelTemp(celsius: number, unit: TempUnit): string {
  return formatTempWithUnit(celsius, unit, 0);
}

/**
 * Minutes as "3h 05m", or "45m" under an hour. Negative and non-finite input
 * formats as an em dash, which is what the UI shows when there is no estimate.
 */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const minutes = Math.round(totalMinutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m < 10 ? '0' : ''}${m}m`;
}

/** Hours as a duration string, so 6.5 becomes "6h 30m". */
export function formatHours(hours: number): string {
  return formatDuration(hours * 60);
}

/** Minutes written out for sentences: "2 hours", "90 minutes", "1 hour". */
export function formatMinutesInWords(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export interface ClockParts {
  /** "7:20" */
  time: string;
  period: 'AM' | 'PM';
}

/** Split a minute-of-day (0 to 1439) into 12-hour clock parts. */
export function clockParts(minuteOfDay: number): ClockParts {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(m / 60);
  const minutes = m % 60;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return {
    time: `${hours12}:${minutes < 10 ? '0' : ''}${minutes}`,
    period: hours24 < 12 ? 'AM' : 'PM',
  };
}

/** "7:20 AM" */
export function formatClock(minuteOfDay: number): string {
  const { time, period } = clockParts(minuteOfDay);
  return `${time} ${period}`;
}

/** A 0..1 fraction as a whole percent, "78". */
export function formatPercent(fraction: number): string {
  return String(Math.round(clamp(fraction, 0, 1) * 100));
}
