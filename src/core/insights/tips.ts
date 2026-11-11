/**
 * The tip at the bottom of the Insights screen.
 *
 * Tips are plain rules over the week's summary. The first rule that applies
 * wins, so the order below is the order of usefulness.
 */
import { ELECTRONICS_OVERHEAD_W, levelPackPowerW } from '../spec';
import type { Schedule } from '../schedule/schedule';
import type { WeekSummary } from './history';

export interface Tip {
  id: 'morning-high' | 'mostly-high' | 'preheat-working' | 'auto-efficient' | 'no-data' | 'all-good';
  body: string;
  /** An optional shortcut to the screen that acts on the tip. */
  action: { label: string; route: string } | null;
}

/** Round to the nearest five, never below five. */
function roundToFive(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

/**
 * Minutes of Medium runtime a week that running High for the first minutes
 * of the morning costs, compared with arriving already warm.
 */
export function earlyHighCostMin(earlyHighS: number): number {
  const extraW = levelPackPowerW(2) - levelPackPowerW(1);
  const extraWh = (extraW * earlyHighS) / 3600;
  return (extraWh / (levelPackPowerW(1) - ELECTRONICS_OVERHEAD_W)) * 60;
}

export function pickTip(summary: WeekSummary, schedule: Schedule): Tip {
  if (summary.totalS < 10 * 60) {
    return {
      id: 'no-data',
      body: 'Wear the hoodie with heat on for a few days and tips will show up here.',
      action: null,
    };
  }

  if (summary.earlyHighDays >= 3 && !schedule.enabled) {
    const saved = roundToFive(earlyHighCostMin(summary.earlyHighS));
    return {
      id: 'morning-high',
      body: `You run High for the first 10 minutes most mornings. A Commute preheat would cover that and save about ${saved} minutes of battery a week.`,
      action: { label: 'Set up a preheat', route: '/schedule' },
    };
  }

  const highShare = summary.totalS > 0 ? summary.levelS[2] / summary.totalS : 0;
  if (highShare > 0.4) {
    return {
      id: 'mostly-high',
      body: 'You spent most of the week on High. Medium holds the same target in most rooms and adds over an hour of runtime.',
      action: null,
    };
  }

  if (schedule.enabled && summary.earlyHighDays >= 3) {
    return {
      id: 'preheat-working',
      body: 'Your Commute preheat is on, so the hoodie is warm before you leave. You can start those mornings on Medium now.',
      action: null,
    };
  }

  const autoShare = summary.modeShares.find((m) => m.modeId === 'auto')?.fraction ?? 0;
  if (autoShare >= 0.5) {
    return {
      id: 'auto-efficient',
      body: 'Auto did most of the work this week. It pulses heat instead of holding it, which is why your cells last longer than the level suggests.',
      action: null,
    };
  }

  return {
    id: 'all-good',
    body: 'Nothing to change. Your week looks efficient.',
    action: null,
  };
}
