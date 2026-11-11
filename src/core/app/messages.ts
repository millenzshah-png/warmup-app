/**
 * Wording for things the hoodie reports.
 *
 * Every device event that deserves the wearer's attention is turned into a
 * short notice here. Events that drive a dedicated screen (an overheat, a
 * fault) are handled by the controller and return null.
 */
import type { DeviceEvent } from '../protocol/events';
import { CELL_NAMES, ZONE_NAMES, type TempUnit } from '../types';
import { formatMinutesInWords } from '../units';
import type { Toast } from './state';

export interface MessageContext {
  unit: TempUnit;
  /** Name of the mode the hoodie is running. */
  modeName: string;
  /** How many cells are still seated after this event. */
  cellsSeated: number;
}

export type Notice = Omit<Toast, 'id'>;

export function noticeForEvent(event: DeviceEvent, ctx: MessageContext): Notice | null {
  switch (event.type) {
    case 'overheatClear':
      return { tone: 'good', title: `${ZONE_NAMES[event.zone]} is heating again`, body: 'The panel cooled below the limit.' };
    case 'zoneLockout':
      return {
        tone: 'warn',
        title: `${ZONE_NAMES[event.zone]} is off for today`,
        body: 'It reached the limit three times. You can switch it back on from Zones.',
      };
    case 'zoneLockoutEnded':
      return { tone: 'info', title: `${ZONE_NAMES[event.zone]} is available again`, body: null };
    case 'lowBattery':
      return { tone: 'warn', title: `Cells at ${event.percent}%`, body: 'Swap in a charged cell soon, or drop a level to stretch it.' };
    case 'criticalBattery':
      return { tone: 'warn', title: 'Heating stopped', body: 'The cells are nearly empty. Snap in a charged one to carry on.' };
    case 'cellRemoved':
      return ctx.cellsSeated > 0
        ? { tone: 'info', title: `${CELL_NAMES[event.cell]} out`, body: 'Running on the other cell.' }
        : null;
    case 'cellInserted':
      return { tone: 'good', title: `${CELL_NAMES[event.cell]} in`, body: null };
    case 'autoOff':
      if (event.reason === 'still') {
        return { tone: 'info', title: 'Heating off', body: 'No movement for 30 minutes.' };
      }
      if (event.reason === 'fade') return { tone: 'info', title: `${ctx.modeName} mode faded out`, body: null };
      return { tone: 'info', title: `${ctx.modeName} mode finished`, body: 'Heating is off.' };
    case 'scheduleStart':
      return {
        tone: 'good',
        title: 'Preheat started',
        body: `Warm in about ${formatMinutesInWords(event.preheatMin)}.`,
      };
    case 'eased':
      return event.on
        ? { tone: 'info', title: 'Eased to Low', body: 'You have been still indoors for five minutes.' }
        : { tone: 'info', title: 'Back to your level', body: 'You are on the move again.' };
    case 'button':
      return { tone: 'info', title: event.power ? 'Heating on' : 'Heating off', body: 'From the button on the hem.' };
    case 'faultCleared':
      return { tone: 'good', title: 'Fault cleared', body: 'Heating is available again.' };
    case 'otaFailed':
      return null;
    case 'overheatTrip':
    case 'fault':
    case 'otaVerified':
    case 'rebooted':
      return null;
  }
}
