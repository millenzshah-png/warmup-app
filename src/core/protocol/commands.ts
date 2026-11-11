/**
 * Commands the app writes to the hoodie.
 *
 * Every command is one frame of type Command. The first payload byte is the
 * opcode, the rest depends on the command. The hoodie answers each one with
 * an Ack frame carrying the same sequence number.
 */
import type { ModeConfig } from '../modes';
import { TARGET_MAX_F, TARGET_MIN_F } from '../spec';
import {
  HOODIE_SIZES,
  RAMP_SPEEDS,
  ZONE_IDS,
  isLevel,
  maskToZones,
  zonesToMask,
  type HoodieSize,
  type Level,
  type RampSpeed,
  type Version,
  type ZoneId,
  type ZoneMap,
} from '../types';
import { ByteReader, ByteWriter, ProtocolError, fromCenti, toCenti } from './frames';

export const Opcode = {
  SetPower: 0x01,
  SetLevel: 0x02,
  SetMode: 0x03,
  SetZones: 0x04,
  SetWashLock: 0x05,
  SetSchedule: 0x06,
  SyncTime: 0x07,
  SetContext: 0x08,
  SafetyAck: 0x09,
  SetName: 0x0a,
  SetPrefs: 0x0b,
  ClearFault: 0x0c,
  SetSize: 0x0d,
  OtaBegin: 0x20,
  OtaChunk: 0x21,
  OtaEnd: 0x22,
  OtaAbort: 0x23,
} as const;

/** The part of a mode the hoodie needs in order to run it. Eight bytes on the wire. */
export interface ModeParams {
  slot: number;
  targetF: number;
  ramp: RampSpeed;
  zones: ZoneMap<boolean>;
  pulse: boolean;
  outdoorBoost: boolean;
  tracksOutdoor: boolean;
  easeIndoors: boolean;
  autoOffMin: number | null;
  fadeOutMin: number | null;
}

export function modeParamsFromConfig(mode: ModeConfig): ModeParams {
  return {
    slot: mode.slot,
    targetF: mode.targetF,
    ramp: mode.ramp,
    zones: { ...mode.zones },
    pulse: mode.pulse,
    outdoorBoost: mode.outdoorBoost,
    tracksOutdoor: mode.tracksOutdoor,
    easeIndoors: mode.easeIndoors,
    autoOffMin: mode.autoOffMin,
    fadeOutMin: mode.fadeOutMin,
  };
}

/** The schedule as stored on the hoodie, so preheat works with the phone asleep. */
export interface DeviceSchedule {
  enabled: boolean;
  /** Departure time as a minute of the local day, 0 to 1439. */
  minuteOfDay: number;
  /** Monday first. */
  days: readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  /** Start heating this many minutes before the departure time. */
  preheatMin: number;
  mode: ModeParams;
  level: Level;
}

export type SafetyAckAction = 'dismiss' | 'lockoutToday' | 'clearLockout';
const SAFETY_ACK_ACTIONS: readonly SafetyAckAction[] = ['dismiss', 'lockoutToday', 'clearLockout'];

export type Command =
  | { op: 'setPower'; on: boolean }
  | { op: 'setLevel'; level: Level }
  | { op: 'setMode'; mode: ModeParams; start: boolean }
  | { op: 'setZones'; zones: ZoneMap<boolean> }
  | { op: 'setWashLock'; on: boolean }
  | { op: 'setSchedule'; schedule: DeviceSchedule }
  | { op: 'syncTime'; epochS: number; tzOffsetMin: number }
  | { op: 'setContext'; outdoors: boolean; moving: boolean; outdoorC: number }
  | { op: 'safetyAck'; zone: ZoneId; action: SafetyAckAction }
  | { op: 'setName'; name: string }
  | { op: 'setPrefs'; autoOffWhenStill: boolean; buttonHaptics: boolean }
  | { op: 'clearFault' }
  | { op: 'setSize'; size: HoodieSize }
  | { op: 'otaBegin'; size: number; crc32: number; version: Version }
  | { op: 'otaChunk'; offset: number; data: Uint8Array }
  | { op: 'otaEnd' }
  | { op: 'otaAbort' };

export type CommandOp = Command['op'];

export const DEVICE_NAME_MAX_BYTES = 24;
/** Largest firmware chunk that fits one frame alongside its header. */
export const OTA_CHUNK_BYTES = 200;

const MODE_FLAG_PULSE = 1;
const MODE_FLAG_OUTDOOR_BOOST = 2;
const MODE_FLAG_TRACKS_OUTDOOR = 4;
const MODE_FLAG_EASE_INDOORS = 8;
const MODE_PARAMS_BYTES = 8;

function writeModeParams(w: ByteWriter, mode: ModeParams): void {
  let flags = 0;
  if (mode.pulse) flags |= MODE_FLAG_PULSE;
  if (mode.outdoorBoost) flags |= MODE_FLAG_OUTDOOR_BOOST;
  if (mode.tracksOutdoor) flags |= MODE_FLAG_TRACKS_OUTDOOR;
  if (mode.easeIndoors) flags |= MODE_FLAG_EASE_INDOORS;
  w.u8(mode.slot)
    .u8(Math.round(mode.targetF * 2))
    .u8(RAMP_SPEEDS.indexOf(mode.ramp))
    .u8(zonesToMask(mode.zones))
    .u8(flags)
    .u16(mode.autoOffMin ?? 0)
    .u8(mode.fadeOutMin ?? 0);
}

function readModeParams(r: ByteReader): ModeParams {
  const slot = r.u8();
  const targetF = r.u8() / 2;
  const ramp = RAMP_SPEEDS[r.u8()];
  const zones = maskToZones(r.u8());
  const flags = r.u8();
  const autoOff = r.u16();
  const fade = r.u8();
  if (!ramp) throw new ProtocolError('bad-payload', 'Unknown ramp speed');
  if (targetF < TARGET_MIN_F || targetF > TARGET_MAX_F) throw new ProtocolError('bad-payload', 'Target out of range');
  return {
    slot,
    targetF,
    ramp,
    zones,
    pulse: (flags & MODE_FLAG_PULSE) !== 0,
    outdoorBoost: (flags & MODE_FLAG_OUTDOOR_BOOST) !== 0,
    tracksOutdoor: (flags & MODE_FLAG_TRACKS_OUTDOOR) !== 0,
    easeIndoors: (flags & MODE_FLAG_EASE_INDOORS) !== 0,
    autoOffMin: autoOff === 0 ? null : autoOff,
    fadeOutMin: fade === 0 ? null : fade,
  };
}

function daysToMask(days: readonly boolean[]): number {
  let mask = 0;
  for (let i = 0; i < 7; i += 1) if (days[i]) mask |= 1 << i;
  return mask;
}

function maskToDays(mask: number): DeviceSchedule['days'] {
  const bit = (i: number): boolean => (mask & (1 << i)) !== 0;
  return [bit(0), bit(1), bit(2), bit(3), bit(4), bit(5), bit(6)];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

/** Encode a name, trimmed to whole characters that fit the byte limit. */
export function encodeName(name: string): Uint8Array {
  let text = name.trim();
  let bytes = textEncoder.encode(text);
  while (bytes.length > DEVICE_NAME_MAX_BYTES) {
    text = Array.from(text).slice(0, -1).join('');
    bytes = textEncoder.encode(text);
  }
  return bytes;
}

export function decodeName(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function encodeCommand(cmd: Command): Uint8Array {
  switch (cmd.op) {
    case 'setPower':
      return new ByteWriter(2).u8(Opcode.SetPower).u8(cmd.on ? 1 : 0).done();
    case 'setLevel':
      return new ByteWriter(2).u8(Opcode.SetLevel).u8(cmd.level).done();
    case 'setMode': {
      const w = new ByteWriter(2 + MODE_PARAMS_BYTES).u8(Opcode.SetMode);
      writeModeParams(w, cmd.mode);
      return w.u8(cmd.start ? 1 : 0).done();
    }
    case 'setZones':
      return new ByteWriter(2).u8(Opcode.SetZones).u8(zonesToMask(cmd.zones)).done();
    case 'setWashLock':
      return new ByteWriter(2).u8(Opcode.SetWashLock).u8(cmd.on ? 1 : 0).done();
    case 'setSchedule': {
      const s = cmd.schedule;
      const w = new ByteWriter(7 + MODE_PARAMS_BYTES).u8(Opcode.SetSchedule);
      w.u8(s.enabled ? 1 : 0).u16(s.minuteOfDay).u8(daysToMask(s.days)).u8(s.preheatMin).u8(s.level);
      writeModeParams(w, s.mode);
      return w.done();
    }
    case 'syncTime':
      return new ByteWriter(7).u8(Opcode.SyncTime).u32(cmd.epochS).i16(cmd.tzOffsetMin).done();
    case 'setContext':
      return new ByteWriter(4)
        .u8(Opcode.SetContext)
        .u8((cmd.outdoors ? 1 : 0) | (cmd.moving ? 2 : 0))
        .i16(toCenti(cmd.outdoorC))
        .done();
    case 'safetyAck':
      return new ByteWriter(3)
        .u8(Opcode.SafetyAck)
        .u8(ZONE_IDS.indexOf(cmd.zone))
        .u8(SAFETY_ACK_ACTIONS.indexOf(cmd.action))
        .done();
    case 'setName': {
      const bytes = encodeName(cmd.name);
      return new ByteWriter(2 + bytes.length).u8(Opcode.SetName).u8(bytes.length).raw(bytes).done();
    }
    case 'setPrefs':
      return new ByteWriter(2)
        .u8(Opcode.SetPrefs)
        .u8((cmd.autoOffWhenStill ? 1 : 0) | (cmd.buttonHaptics ? 2 : 0))
        .done();
    case 'clearFault':
      return new ByteWriter(1).u8(Opcode.ClearFault).done();
    case 'setSize':
      return new ByteWriter(2).u8(Opcode.SetSize).u8(HOODIE_SIZES.indexOf(cmd.size)).done();
    case 'otaBegin':
      return new ByteWriter(12)
        .u8(Opcode.OtaBegin)
        .u32(cmd.size)
        .u32(cmd.crc32)
        .u8(cmd.version.major)
        .u8(cmd.version.minor)
        .u8(cmd.version.patch)
        .done();
    case 'otaChunk':
      return new ByteWriter(5 + cmd.data.length).u8(Opcode.OtaChunk).u32(cmd.offset).raw(cmd.data).done();
    case 'otaEnd':
      return new ByteWriter(1).u8(Opcode.OtaEnd).done();
    case 'otaAbort':
      return new ByteWriter(1).u8(Opcode.OtaAbort).done();
  }
}

export function decodeCommand(payload: Uint8Array): Command {
  const r = new ByteReader(payload);
  const opcode = r.u8();
  switch (opcode) {
    case Opcode.SetPower:
      return { op: 'setPower', on: r.u8() !== 0 };
    case Opcode.SetLevel: {
      const level = r.u8();
      if (!isLevel(level)) throw new ProtocolError('bad-payload', 'Level out of range');
      return { op: 'setLevel', level };
    }
    case Opcode.SetMode: {
      const mode = readModeParams(r);
      return { op: 'setMode', mode, start: r.u8() !== 0 };
    }
    case Opcode.SetZones:
      return { op: 'setZones', zones: maskToZones(r.u8()) };
    case Opcode.SetWashLock:
      return { op: 'setWashLock', on: r.u8() !== 0 };
    case Opcode.SetSchedule: {
      const enabled = r.u8() !== 0;
      const minuteOfDay = r.u16();
      const days = maskToDays(r.u8());
      const preheatMin = r.u8();
      const level = r.u8();
      const mode = readModeParams(r);
      if (minuteOfDay >= 1440) throw new ProtocolError('bad-payload', 'Schedule time out of range');
      if (!isLevel(level)) throw new ProtocolError('bad-payload', 'Level out of range');
      return { op: 'setSchedule', schedule: { enabled, minuteOfDay, days, preheatMin, mode, level } };
    }
    case Opcode.SyncTime:
      return { op: 'syncTime', epochS: r.u32(), tzOffsetMin: r.i16() };
    case Opcode.SetContext: {
      const flags = r.u8();
      return { op: 'setContext', outdoors: (flags & 1) !== 0, moving: (flags & 2) !== 0, outdoorC: fromCenti(r.i16()) };
    }
    case Opcode.SafetyAck: {
      const zone = ZONE_IDS[r.u8()];
      const action = SAFETY_ACK_ACTIONS[r.u8()];
      if (!zone || !action) throw new ProtocolError('bad-payload', 'Unknown zone or action');
      return { op: 'safetyAck', zone, action };
    }
    case Opcode.SetName: {
      const n = r.u8();
      if (n > DEVICE_NAME_MAX_BYTES) throw new ProtocolError('bad-payload', 'Name too long');
      return { op: 'setName', name: decodeName(r.raw(n)) };
    }
    case Opcode.SetPrefs: {
      const flags = r.u8();
      return { op: 'setPrefs', autoOffWhenStill: (flags & 1) !== 0, buttonHaptics: (flags & 2) !== 0 };
    }
    case Opcode.ClearFault:
      return { op: 'clearFault' };
    case Opcode.SetSize: {
      const size = HOODIE_SIZES[r.u8()];
      if (!size) throw new ProtocolError('bad-payload', 'Unknown size');
      return { op: 'setSize', size };
    }
    case Opcode.OtaBegin: {
      const size = r.u32();
      const crc = r.u32();
      return { op: 'otaBegin', size, crc32: crc, version: { major: r.u8(), minor: r.u8(), patch: r.u8() } };
    }
    case Opcode.OtaChunk: {
      const offset = r.u32();
      return { op: 'otaChunk', offset, data: r.rest() };
    }
    case Opcode.OtaEnd:
      return { op: 'otaEnd' };
    case Opcode.OtaAbort:
      return { op: 'otaAbort' };
    default:
      throw new ProtocolError('bad-payload', `Unknown opcode 0x${opcode.toString(16)}`);
  }
}

/** Result codes carried by an Ack frame. */
export const AckCode = {
  Ok: 0,
  /** The command was malformed or its values were out of range. */
  Invalid: 1,
  /** The hoodie is updating or restarting. */
  Busy: 2,
  /** Wash mode is on, so heating cannot start. */
  Locked: 3,
  /** Not enough charge for what was asked. */
  LowBattery: 4,
  /** A safety fault is latched. */
  Fault: 5,
  /** A firmware image failed its checksum. */
  Checksum: 6,
  /** No cell with charge is seated. */
  NoCells: 7,
} as const;

export type AckCodeValue = (typeof AckCode)[keyof typeof AckCode];

const ACK_CODE_VALUES = new Set<number>(Object.values(AckCode));

export function isAckCode(value: number): value is AckCodeValue {
  return ACK_CODE_VALUES.has(value);
}

/** Plain-language reason for each refusal, shown to the wearer. */
export const ACK_MESSAGES: Record<AckCodeValue, string> = {
  [AckCode.Ok]: 'Done',
  [AckCode.Invalid]: 'The hoodie did not understand that.',
  [AckCode.Busy]: 'The hoodie is busy updating. Try again in a moment.',
  [AckCode.Locked]: 'Wash mode is on. Turn it off to heat again.',
  [AckCode.LowBattery]: 'The cells are too low for that.',
  [AckCode.Fault]: 'Heating is disabled until the fault is cleared.',
  [AckCode.Checksum]: 'The update did not arrive intact.',
  [AckCode.NoCells]: 'Snap in a charged cell first.',
};

export interface Ack {
  opcode: number;
  code: AckCodeValue;
}

export function encodeAck(ack: Ack): Uint8Array {
  return new ByteWriter(2).u8(ack.opcode).u8(ack.code).done();
}

export function decodeAck(payload: Uint8Array): Ack {
  const r = new ByteReader(payload);
  const opcode = r.u8();
  const code = r.u8();
  if (!isAckCode(code)) throw new ProtocolError('bad-payload', `Unknown ack code ${code}`);
  return { opcode, code };
}
