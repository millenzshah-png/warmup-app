/**
 * Events the hoodie pushes to the app the moment something happens.
 *
 * Each event is one frame of type Event with a six byte payload:
 *
 *   0  u8   event code
 *   1  u8   first argument (zone index, cell index, reason, ...)
 *   2  i16  second argument (usually a temperature in centi °C)
 *   4  i16  third argument
 */
import type { FaultCode } from '../thermal/safety';
import { FAULT_NONE, FAULT_PANEL_OVERTEMP, FAULT_SENSOR } from '../thermal/safety';
import { CELL_IDS, ZONE_IDS, type CellId, type Version, type ZoneId } from '../types';
import { ByteReader, ByteWriter, ProtocolError, fromCenti, toCenti } from './frames';

export type AutoOffReason = 'timer' | 'still' | 'fade';
export type OtaFailureReason = 'checksum' | 'size' | 'battery' | 'aborted';

export type DeviceEvent =
  | { type: 'overheatTrip'; zone: ZoneId; peakC: number }
  | { type: 'overheatClear'; zone: ZoneId; tempC: number }
  | { type: 'zoneLockout'; zone: ZoneId }
  | { type: 'zoneLockoutEnded'; zone: ZoneId }
  | { type: 'lowBattery'; percent: number }
  | { type: 'criticalBattery' }
  | { type: 'cellRemoved'; cell: CellId }
  | { type: 'cellInserted'; cell: CellId }
  | { type: 'autoOff'; reason: AutoOffReason }
  | { type: 'scheduleStart'; preheatMin: number }
  | { type: 'eased'; on: boolean }
  | { type: 'otaVerified' }
  | { type: 'otaFailed'; reason: OtaFailureReason }
  | { type: 'rebooted'; version: Version }
  | { type: 'fault'; code: FaultCode }
  | { type: 'faultCleared' }
  | { type: 'button'; power: boolean };

export type DeviceEventType = DeviceEvent['type'];

const EventCode = {
  OverheatTrip: 1,
  OverheatClear: 2,
  ZoneLockout: 3,
  ZoneLockoutEnded: 4,
  LowBattery: 5,
  CriticalBattery: 6,
  CellRemoved: 7,
  CellInserted: 8,
  AutoOff: 9,
  ScheduleStart: 10,
  Eased: 11,
  OtaVerified: 12,
  OtaFailed: 13,
  Rebooted: 14,
  Fault: 15,
  FaultCleared: 16,
  Button: 17,
} as const;

export const EVENT_PAYLOAD_BYTES = 6;

const AUTO_OFF_REASONS: readonly AutoOffReason[] = ['timer', 'still', 'fade'];
const OTA_FAILURE_REASONS: readonly OtaFailureReason[] = ['checksum', 'size', 'battery', 'aborted'];
const FAULT_CODES: readonly FaultCode[] = [FAULT_NONE, FAULT_PANEL_OVERTEMP, FAULT_SENSOR];

function pack(code: number, a = 0, b = 0, c = 0): Uint8Array {
  return new ByteWriter(EVENT_PAYLOAD_BYTES).u8(code).u8(a).i16(b).i16(c).done();
}

export function encodeEvent(event: DeviceEvent): Uint8Array {
  switch (event.type) {
    case 'overheatTrip':
      return pack(EventCode.OverheatTrip, ZONE_IDS.indexOf(event.zone), toCenti(event.peakC));
    case 'overheatClear':
      return pack(EventCode.OverheatClear, ZONE_IDS.indexOf(event.zone), toCenti(event.tempC));
    case 'zoneLockout':
      return pack(EventCode.ZoneLockout, ZONE_IDS.indexOf(event.zone));
    case 'zoneLockoutEnded':
      return pack(EventCode.ZoneLockoutEnded, ZONE_IDS.indexOf(event.zone));
    case 'lowBattery':
      return pack(EventCode.LowBattery, Math.round(event.percent));
    case 'criticalBattery':
      return pack(EventCode.CriticalBattery);
    case 'cellRemoved':
      return pack(EventCode.CellRemoved, CELL_IDS.indexOf(event.cell));
    case 'cellInserted':
      return pack(EventCode.CellInserted, CELL_IDS.indexOf(event.cell));
    case 'autoOff':
      return pack(EventCode.AutoOff, AUTO_OFF_REASONS.indexOf(event.reason));
    case 'scheduleStart':
      return pack(EventCode.ScheduleStart, event.preheatMin);
    case 'eased':
      return pack(EventCode.Eased, event.on ? 1 : 0);
    case 'otaVerified':
      return pack(EventCode.OtaVerified);
    case 'otaFailed':
      return pack(EventCode.OtaFailed, OTA_FAILURE_REASONS.indexOf(event.reason));
    case 'rebooted':
      return pack(EventCode.Rebooted, event.version.major, event.version.minor, event.version.patch);
    case 'fault':
      return pack(EventCode.Fault, event.code);
    case 'faultCleared':
      return pack(EventCode.FaultCleared);
    case 'button':
      return pack(EventCode.Button, event.power ? 1 : 0);
  }
}

function zoneAt(index: number): ZoneId {
  const zone = ZONE_IDS[index];
  if (!zone) throw new ProtocolError('bad-payload', `Unknown zone index ${index}`);
  return zone;
}

function cellAt(index: number): CellId {
  const cell = CELL_IDS[index];
  if (!cell) throw new ProtocolError('bad-payload', `Unknown cell index ${index}`);
  return cell;
}

export function decodeEvent(payload: Uint8Array): DeviceEvent {
  if (payload.length !== EVENT_PAYLOAD_BYTES) {
    throw new ProtocolError('bad-payload', `Event payload is ${payload.length} bytes, expected ${EVENT_PAYLOAD_BYTES}`);
  }
  const r = new ByteReader(payload);
  const code = r.u8();
  const a = r.u8();
  const b = r.i16();
  const c = r.i16();
  switch (code) {
    case EventCode.OverheatTrip:
      return { type: 'overheatTrip', zone: zoneAt(a), peakC: fromCenti(b) };
    case EventCode.OverheatClear:
      return { type: 'overheatClear', zone: zoneAt(a), tempC: fromCenti(b) };
    case EventCode.ZoneLockout:
      return { type: 'zoneLockout', zone: zoneAt(a) };
    case EventCode.ZoneLockoutEnded:
      return { type: 'zoneLockoutEnded', zone: zoneAt(a) };
    case EventCode.LowBattery:
      return { type: 'lowBattery', percent: a };
    case EventCode.CriticalBattery:
      return { type: 'criticalBattery' };
    case EventCode.CellRemoved:
      return { type: 'cellRemoved', cell: cellAt(a) };
    case EventCode.CellInserted:
      return { type: 'cellInserted', cell: cellAt(a) };
    case EventCode.AutoOff: {
      const reason = AUTO_OFF_REASONS[a];
      if (!reason) throw new ProtocolError('bad-payload', 'Unknown auto-off reason');
      return { type: 'autoOff', reason };
    }
    case EventCode.ScheduleStart:
      return { type: 'scheduleStart', preheatMin: a };
    case EventCode.Eased:
      return { type: 'eased', on: a !== 0 };
    case EventCode.OtaVerified:
      return { type: 'otaVerified' };
    case EventCode.OtaFailed: {
      const reason = OTA_FAILURE_REASONS[a];
      if (!reason) throw new ProtocolError('bad-payload', 'Unknown update failure reason');
      return { type: 'otaFailed', reason };
    }
    case EventCode.Rebooted:
      return { type: 'rebooted', version: { major: a, minor: b, patch: c } };
    case EventCode.Fault: {
      const fault = FAULT_CODES[a];
      if (fault === undefined) throw new ProtocolError('bad-payload', 'Unknown fault code');
      return { type: 'fault', code: fault };
    }
    case EventCode.FaultCleared:
      return { type: 'faultCleared' };
    case EventCode.Button:
      return { type: 'button', power: a !== 0 };
    default:
      throw new ProtocolError('bad-payload', `Unknown event code ${code}`);
  }
}
