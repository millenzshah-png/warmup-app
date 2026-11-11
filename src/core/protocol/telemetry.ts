/**
 * The telemetry frame the hoodie notifies about once a second.
 *
 * Layout of the 42 byte payload, little endian:
 *
 *    0  u32  uptime, seconds
 *    4  u32  real time clock, epoch seconds
 *    8  u16  flags (see TelemetryFlag)
 *   10  u8   mode slot
 *   11  u8   level in bits 0-1, effective level in bits 2-3
 *   12  u8   zones enabled in bits 0-2, zones energised now in bits 4-6
 *   13  u8   safety: two bits per zone, fault code in bits 6-7
 *   14  i16  collar skin temperature, centi °C
 *   16  i16  effective target, centi °C
 *   18  i16  panel temperature L, R, B, centi °C
 *   24  u8   duty L, R, B, half percent
 *   27  u8   left cell charge, half percent
 *   28  u8   right cell charge, half percent
 *   29  u8   cell flags: L present, L docked, R present, R docked
 *   30  u16  left cell millivolts
 *   32  u16  right cell millivolts
 *   34  u16  pack draw, milliwatts
 *   36  u16  runtime estimate, minutes (0xFFFF when there is none)
 *   38  u16  auto-off remaining, minutes (0xFFFF when there is none)
 *   40  i16  learned resting skin temperature, centi °C
 */
import type { FaultCode, ZoneSafetyStatus } from '../thermal/safety';
import { FAULT_NONE, FAULT_PANEL_OVERTEMP, FAULT_SENSOR } from '../thermal/safety';
import { ZONE_IDS, isLevel, maskToZones, zoneMap, zonesToMask, type CellMap, type Level, type ZoneMap } from '../types';
import { ByteReader, ByteWriter, ProtocolError, fromCenti, fromHalfPercent, toCenti, toHalfPercent } from './frames';

export const TELEMETRY_PAYLOAD_BYTES = 42;
const NONE_U16 = 0xffff;

export const TelemetryFlag = {
  Power: 1 << 0,
  Heating: 1 << 1,
  WashLock: 1 << 2,
  Eased: 1 << 3,
  Fading: 1 << 4,
  OtaActive: 1 << 5,
  LowBattery: 1 << 6,
  ScheduleArmed: 1 << 7,
  ContextOutdoors: 1 << 8,
  ContextMoving: 1 << 9,
  Preheating: 1 << 10,
} as const;

export interface CellTelemetry {
  present: boolean;
  docked: boolean;
  /** State of charge, 0 to 1. */
  soc: number;
  millivolts: number;
}

export interface Telemetry {
  uptimeS: number;
  rtcEpochS: number;
  /** The wearer has heating switched on. */
  power: boolean;
  /** At least one panel is being driven. */
  heating: boolean;
  washLock: boolean;
  /** Commute has dropped to Low because the wearer is still indoors. */
  eased: boolean;
  /** A fade-out is in progress. */
  fading: boolean;
  otaActive: boolean;
  lowBattery: boolean;
  scheduleArmed: boolean;
  contextOutdoors: boolean;
  contextMoving: boolean;
  /** Heating was started by the schedule and the departure time is still ahead. */
  preheating: boolean;
  modeSlot: number;
  level: Level;
  effectiveLevel: Level;
  zonesEnabled: ZoneMap<boolean>;
  /** Panels energised at this instant, which pulses in and out while holding. */
  zonesHeating: ZoneMap<boolean>;
  zoneSafety: ZoneMap<ZoneSafetyStatus>;
  fault: FaultCode;
  skinC: number;
  targetC: number;
  panelC: ZoneMap<number>;
  /** Commanded duty per panel, 0 to 1. */
  duty: ZoneMap<number>;
  cells: CellMap<CellTelemetry>;
  drawW: number;
  runtimeMin: number | null;
  autoOffRemainingMin: number | null;
  learnedRestC: number;
}

const SAFETY_CODES: readonly ZoneSafetyStatus[] = ['ok', 'cutoff', 'lockout'];
const FAULT_CODES: readonly FaultCode[] = [FAULT_NONE, FAULT_PANEL_OVERTEMP, FAULT_SENSOR];

export function encodeTelemetry(t: Telemetry): Uint8Array {
  let flags = 0;
  if (t.power) flags |= TelemetryFlag.Power;
  if (t.heating) flags |= TelemetryFlag.Heating;
  if (t.washLock) flags |= TelemetryFlag.WashLock;
  if (t.eased) flags |= TelemetryFlag.Eased;
  if (t.fading) flags |= TelemetryFlag.Fading;
  if (t.otaActive) flags |= TelemetryFlag.OtaActive;
  if (t.lowBattery) flags |= TelemetryFlag.LowBattery;
  if (t.scheduleArmed) flags |= TelemetryFlag.ScheduleArmed;
  if (t.contextOutdoors) flags |= TelemetryFlag.ContextOutdoors;
  if (t.contextMoving) flags |= TelemetryFlag.ContextMoving;
  if (t.preheating) flags |= TelemetryFlag.Preheating;

  let safety = 0;
  ZONE_IDS.forEach((zone, i) => {
    safety |= Math.max(0, SAFETY_CODES.indexOf(t.zoneSafety[zone])) << (i * 2);
  });
  safety |= (t.fault & 0x03) << 6;

  let cellFlags = 0;
  if (t.cells.left.present) cellFlags |= 1;
  if (t.cells.left.docked) cellFlags |= 2;
  if (t.cells.right.present) cellFlags |= 4;
  if (t.cells.right.docked) cellFlags |= 8;

  const w = new ByteWriter(TELEMETRY_PAYLOAD_BYTES);
  w.u32(t.uptimeS).u32(t.rtcEpochS).u16(flags);
  w.u8(t.modeSlot).u8((t.level & 3) | ((t.effectiveLevel & 3) << 2));
  w.u8(zonesToMask(t.zonesEnabled) | (zonesToMask(t.zonesHeating) << 4)).u8(safety);
  w.i16(toCenti(t.skinC)).i16(toCenti(t.targetC));
  for (const zone of ZONE_IDS) w.i16(toCenti(t.panelC[zone]));
  for (const zone of ZONE_IDS) w.u8(toHalfPercent(t.duty[zone]));
  w.u8(toHalfPercent(t.cells.left.soc)).u8(toHalfPercent(t.cells.right.soc)).u8(cellFlags);
  w.u16(t.cells.left.millivolts).u16(t.cells.right.millivolts);
  w.u16(t.drawW * 1000);
  w.u16(t.runtimeMin === null ? NONE_U16 : Math.min(NONE_U16 - 1, t.runtimeMin));
  w.u16(t.autoOffRemainingMin === null ? NONE_U16 : Math.min(NONE_U16 - 1, t.autoOffRemainingMin));
  w.i16(toCenti(t.learnedRestC));
  return w.done();
}

export function decodeTelemetry(payload: Uint8Array): Telemetry {
  if (payload.length !== TELEMETRY_PAYLOAD_BYTES) {
    throw new ProtocolError('bad-payload', `Telemetry payload is ${payload.length} bytes, expected ${TELEMETRY_PAYLOAD_BYTES}`);
  }
  const r = new ByteReader(payload);
  const uptimeS = r.u32();
  const rtcEpochS = r.u32();
  const flags = r.u16();
  const modeSlot = r.u8();
  const levels = r.u8();
  const zoneBits = r.u8();
  const safety = r.u8();
  const skinC = fromCenti(r.i16());
  const targetC = fromCenti(r.i16());
  const panelC = zoneMap(() => 0);
  for (const zone of ZONE_IDS) panelC[zone] = fromCenti(r.i16());
  const duty = zoneMap(() => 0);
  for (const zone of ZONE_IDS) duty[zone] = fromHalfPercent(r.u8());
  const leftSoc = fromHalfPercent(r.u8());
  const rightSoc = fromHalfPercent(r.u8());
  const cellFlags = r.u8();
  const leftMv = r.u16();
  const rightMv = r.u16();
  const drawW = r.u16() / 1000;
  const runtime = r.u16();
  const autoOff = r.u16();
  const learnedRestC = fromCenti(r.i16());

  const level = levels & 3;
  const effectiveLevel = (levels >> 2) & 3;
  if (!isLevel(level) || !isLevel(effectiveLevel)) throw new ProtocolError('bad-payload', 'Telemetry level out of range');
  const zoneSafety = zoneMap((): ZoneSafetyStatus => 'ok');
  ZONE_IDS.forEach((zone, i) => {
    const status = SAFETY_CODES[(safety >> (i * 2)) & 3];
    if (!status) throw new ProtocolError('bad-payload', 'Telemetry safety status out of range');
    zoneSafety[zone] = status;
  });
  const fault = FAULT_CODES[(safety >> 6) & 3];
  if (fault === undefined) throw new ProtocolError('bad-payload', 'Telemetry fault code out of range');
  const has = (flag: number): boolean => (flags & flag) !== 0;

  return {
    uptimeS,
    rtcEpochS,
    power: has(TelemetryFlag.Power),
    heating: has(TelemetryFlag.Heating),
    washLock: has(TelemetryFlag.WashLock),
    eased: has(TelemetryFlag.Eased),
    fading: has(TelemetryFlag.Fading),
    otaActive: has(TelemetryFlag.OtaActive),
    lowBattery: has(TelemetryFlag.LowBattery),
    scheduleArmed: has(TelemetryFlag.ScheduleArmed),
    contextOutdoors: has(TelemetryFlag.ContextOutdoors),
    contextMoving: has(TelemetryFlag.ContextMoving),
    preheating: has(TelemetryFlag.Preheating),
    modeSlot,
    level,
    effectiveLevel,
    zonesEnabled: maskToZones(zoneBits & 7),
    zonesHeating: maskToZones((zoneBits >> 4) & 7),
    zoneSafety,
    fault,
    skinC,
    targetC,
    panelC,
    duty,
    cells: {
      left: { present: (cellFlags & 1) !== 0, docked: (cellFlags & 2) !== 0, soc: leftSoc, millivolts: leftMv },
      right: { present: (cellFlags & 4) !== 0, docked: (cellFlags & 8) !== 0, soc: rightSoc, millivolts: rightMv },
    },
    drawW,
    runtimeMin: runtime === NONE_U16 ? null : runtime,
    autoOffRemainingMin: autoOff === NONE_U16 ? null : autoOff,
    learnedRestC,
  };
}
