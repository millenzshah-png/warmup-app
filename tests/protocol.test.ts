import { describe, expect, it } from 'vitest';
import { builtInMode } from '../src/core/modes';
import {
  AckCode,
  DEVICE_NAME_MAX_BYTES,
  OTA_CHUNK_BYTES,
  decodeAck,
  decodeCommand,
  encodeAck,
  encodeCommand,
  encodeName,
  isAckCode,
  modeParamsFromConfig,
  type Command,
} from '../src/core/protocol/commands';
import { CRC32_INIT, crc16, crc32, crc32Finish, crc32Update } from '../src/core/protocol/crc';
import { EVENT_PAYLOAD_BYTES, decodeEvent, encodeEvent, type DeviceEvent } from '../src/core/protocol/events';
import {
  ByteReader,
  ByteWriter,
  FrameType,
  MAX_PAYLOAD_BYTES,
  ProtocolError,
  decodeFrame,
  encodeFrame,
} from '../src/core/protocol/frames';
import { GATT } from '../src/core/protocol/gatt';
import { decodeInfo, encodeInfo, type DeviceInfo } from '../src/core/protocol/info';
import { TELEMETRY_PAYLOAD_BYTES, decodeTelemetry, encodeTelemetry, type Telemetry } from '../src/core/protocol/telemetry';
import { FAULT_SENSOR } from '../src/core/thermal/safety';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('checksums', () => {
  it('matches the standard check values', () => {
    expect(crc16(ascii('123456789'))).toBe(0x29b1);
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('gives the same CRC-32 fed in pieces', () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 7 + 3) & 0xff);
    let running = CRC32_INIT;
    for (let i = 0; i < data.length; i += 137) running = crc32Update(running, data.subarray(i, i + 137));
    expect(crc32Finish(running)).toBe(crc32(data));
  });
});

describe('frames', () => {
  it('round-trips a frame', () => {
    const payload = new Uint8Array([1, 2, 3, 250]);
    const bytes = encodeFrame({ type: FrameType.Command, seq: 42, payload });
    expect(bytes[0]).toBe(0xa5);
    expect(bytes.length).toBe(payload.length + 6);
    expect(decodeFrame(bytes)).toEqual({ type: FrameType.Command, seq: 42, payload });
  });

  it('round-trips an empty payload and the largest payload', () => {
    expect(decodeFrame(encodeFrame({ type: 1, seq: 0, payload: new Uint8Array(0) })).payload.length).toBe(0);
    const big = new Uint8Array(MAX_PAYLOAD_BYTES).fill(0x5a);
    expect(decodeFrame(encodeFrame({ type: 1, seq: 255, payload: big })).payload).toEqual(big);
  });

  it('refuses an oversized payload', () => {
    expect(() => encodeFrame({ type: 1, seq: 0, payload: new Uint8Array(MAX_PAYLOAD_BYTES + 1) })).toThrow(ProtocolError);
  });

  it('detects every single flipped bit', () => {
    const bytes = encodeFrame({ type: FrameType.Telemetry, seq: 7, payload: new Uint8Array([9, 8, 7, 6, 5]) });
    for (let i = 0; i < bytes.length; i += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        const damaged = bytes.slice();
        damaged[i] = (damaged[i] ?? 0) ^ (1 << bit);
        expect(() => decodeFrame(damaged)).toThrow(ProtocolError);
      }
    }
  });

  it('names what is wrong', () => {
    const good = encodeFrame({ type: 1, seq: 1, payload: new Uint8Array([1]) });
    const code = (bytes: Uint8Array): string => {
      try {
        decodeFrame(bytes);
        return 'ok';
      } catch (error) {
        return error instanceof ProtocolError ? error.code : 'other';
      }
    };
    expect(code(new Uint8Array([0xa5, 1]))).toBe('too-short');
    expect(code(good.slice(0, -1))).toBe('bad-length');
    const wrongStart = good.slice();
    wrongStart[0] = 0x00;
    expect(code(wrongStart)).toBe('bad-start');
    const wrongCrc = good.slice();
    wrongCrc[wrongCrc.length - 1] = (wrongCrc[wrongCrc.length - 1] ?? 0) ^ 0xff;
    expect(code(wrongCrc)).toBe('bad-crc');
  });

  it('reads and writes little endian and refuses to overrun', () => {
    const bytes = new ByteWriter(11).u8(0xab).u16(0x1234).i16(-2).u32(0xdeadbeef).raw(new Uint8Array([7, 8])).done();
    expect([...bytes.slice(0, 3)]).toEqual([0xab, 0x34, 0x12]);
    const r = new ByteReader(bytes);
    expect(r.u8()).toBe(0xab);
    expect(r.u16()).toBe(0x1234);
    expect(r.i16()).toBe(-2);
    expect(r.u32()).toBe(0xdeadbeef);
    expect([...r.rest()]).toEqual([7, 8]);
    expect(() => r.u8()).toThrow(ProtocolError);
  });

  it('saturates values that do not fit', () => {
    const bytes = new ByteWriter(4).u16(70000).i16(-99999).done();
    const r = new ByteReader(bytes);
    expect(r.u16()).toBe(0xffff);
    expect(r.i16()).toBe(-0x8000);
  });
});

const telemetry: Telemetry = {
  uptimeS: 3723,
  rtcEpochS: 1_794_000_000,
  power: true,
  heating: true,
  washLock: false,
  eased: true,
  fading: false,
  otaActive: false,
  lowBattery: true,
  scheduleArmed: true,
  contextOutdoors: false,
  contextMoving: true,
  preheating: true,
  modeSlot: 17,
  level: 2,
  effectiveLevel: 0,
  zonesEnabled: { L: true, R: false, B: true },
  zonesHeating: { L: true, R: false, B: false },
  zoneSafety: { L: 'ok', R: 'lockout', B: 'cutoff' },
  fault: FAULT_SENSOR,
  skinC: 34.12,
  targetC: 33.89,
  panelC: { L: 38.5, R: 31.25, B: 45.01 },
  duty: { L: 0.855, R: 0, B: 1 },
  cells: {
    left: { present: true, docked: false, soc: 0.82, millivolts: 3962 },
    right: { present: false, docked: true, soc: 0.745, millivolts: 3910 },
  },
  drawW: 3.512,
  runtimeMin: 193,
  autoOffRemainingMin: null,
  learnedRestC: 32.56,
};

describe('telemetry', () => {
  it('is exactly 42 bytes', () => {
    expect(encodeTelemetry(telemetry).length).toBe(TELEMETRY_PAYLOAD_BYTES);
  });

  it('round-trips every field', () => {
    expect(decodeTelemetry(encodeTelemetry(telemetry))).toEqual(telemetry);
  });

  it('round-trips the absent values', () => {
    const quiet: Telemetry = { ...telemetry, runtimeMin: null, autoOffRemainingMin: 95, power: false, heating: false };
    const back = decodeTelemetry(encodeTelemetry(quiet));
    expect(back.runtimeMin).toBeNull();
    expect(back.autoOffRemainingMin).toBe(95);
    expect(back.power).toBe(false);
  });

  it('quantises to a hundredth of a degree and half a percent', () => {
    const back = decodeTelemetry(encodeTelemetry({ ...telemetry, skinC: 34.1234, duty: { L: 0.3333, R: 0, B: 0 } }));
    expect(back.skinC).toBeCloseTo(34.12, 9);
    expect(back.duty.L).toBeCloseTo(0.335, 9);
  });

  it('rejects the wrong length', () => {
    expect(() => decodeTelemetry(new Uint8Array(41))).toThrow(ProtocolError);
  });
});

describe('commands', () => {
  const mode = modeParamsFromConfig(builtInMode('sleep'));
  const commands: Command[] = [
    { op: 'setPower', on: true },
    { op: 'setPower', on: false },
    { op: 'setLevel', level: 2 },
    { op: 'setMode', mode, start: true },
    { op: 'setMode', mode: modeParamsFromConfig(builtInMode('auto')), start: false },
    { op: 'setZones', zones: { L: true, R: false, B: true } },
    { op: 'setWashLock', on: true },
    {
      op: 'setSchedule',
      schedule: { enabled: true, minuteOfDay: 440, days: [true, true, true, true, true, false, false], preheatMin: 10, mode, level: 1 },
    },
    { op: 'syncTime', epochS: 1_794_000_000, tzOffsetMin: -480 },
    { op: 'setContext', outdoors: true, moving: false, outdoorC: -3.25 },
    { op: 'safetyAck', zone: 'B', action: 'lockoutToday' },
    { op: 'safetyAck', zone: 'L', action: 'clearLockout' },
    { op: 'setName', name: 'My Hoodie' },
    { op: 'setPrefs', autoOffWhenStill: true, buttonHaptics: false },
    { op: 'clearFault' },
    { op: 'setSize', size: 'XL' },
    { op: 'otaBegin', size: 421_888, crc32: 0xdeadbeef, version: { major: 1, minor: 3, patch: 0 } },
    { op: 'otaChunk', offset: 4000, data: new Uint8Array(OTA_CHUNK_BYTES).fill(0xa5) },
    { op: 'otaEnd' },
    { op: 'otaAbort' },
  ];

  it.each(commands.map((c) => [c.op, c] as const))('round-trips %s', (_op, cmd) => {
    expect(decodeCommand(encodeCommand(cmd))).toEqual(cmd);
  });

  it('fits every command in one frame', () => {
    for (const cmd of commands) expect(encodeCommand(cmd).length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
  });

  it('encodes "never" and "no fade" as zero', () => {
    const auto = modeParamsFromConfig(builtInMode('auto'));
    const back = decodeCommand(encodeCommand({ op: 'setMode', mode: auto, start: false }));
    expect(back).toMatchObject({ mode: { autoOffMin: null, fadeOutMin: null } });
  });

  it('rejects unknown opcodes and out-of-range values', () => {
    expect(() => decodeCommand(new Uint8Array([0x7f]))).toThrow(ProtocolError);
    expect(() => decodeCommand(new Uint8Array([0x02, 9]))).toThrow(ProtocolError);
    expect(() => decodeCommand(new Uint8Array([0x0d, 99]))).toThrow(ProtocolError);
    const hot = encodeCommand({ op: 'setMode', mode, start: false });
    hot[2] = 240; // 120 °F
    expect(() => decodeCommand(hot)).toThrow(ProtocolError);
    expect(() => decodeCommand(new Uint8Array([0x03, 1, 2]))).toThrow(ProtocolError);
  });

  it('trims a name to whole characters within the byte limit', () => {
    const long = 'Fiancé’s extra-long hoodie name 🔥🔥🔥';
    const bytes = encodeName(long);
    expect(bytes.length).toBeLessThanOrEqual(DEVICE_NAME_MAX_BYTES);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    expect(long.startsWith(text)).toBe(true);
  });

  it('round-trips acknowledgements', () => {
    for (const code of Object.values(AckCode)) {
      expect(decodeAck(encodeAck({ opcode: 3, code }))).toEqual({ opcode: 3, code });
      expect(isAckCode(code)).toBe(true);
    }
    expect(isAckCode(99)).toBe(false);
    expect(() => decodeAck(new Uint8Array([3, 99]))).toThrow(ProtocolError);
  });
});

describe('events', () => {
  const events: DeviceEvent[] = [
    { type: 'overheatTrip', zone: 'B', peakC: 45.02 },
    { type: 'overheatClear', zone: 'B', tempC: 40.5 },
    { type: 'zoneLockout', zone: 'L' },
    { type: 'zoneLockoutEnded', zone: 'R' },
    { type: 'lowBattery', percent: 19 },
    { type: 'criticalBattery' },
    { type: 'cellRemoved', cell: 'right' },
    { type: 'cellInserted', cell: 'left' },
    { type: 'autoOff', reason: 'timer' },
    { type: 'autoOff', reason: 'still' },
    { type: 'autoOff', reason: 'fade' },
    { type: 'scheduleStart', preheatMin: 15 },
    { type: 'eased', on: true },
    { type: 'eased', on: false },
    { type: 'otaVerified' },
    { type: 'otaFailed', reason: 'checksum' },
    { type: 'otaFailed', reason: 'battery' },
    { type: 'rebooted', version: { major: 1, minor: 3, patch: 0 } },
    { type: 'fault', code: FAULT_SENSOR },
    { type: 'faultCleared' },
    { type: 'button', power: true },
  ];

  it.each(events.map((e, i) => [`${i} ${e.type}`, e] as const))('round-trips %s', (_name, event) => {
    const bytes = encodeEvent(event);
    expect(bytes.length).toBe(EVENT_PAYLOAD_BYTES);
    expect(decodeEvent(bytes)).toEqual(event);
  });

  it('rejects unknown codes and bad arguments', () => {
    expect(() => decodeEvent(new Uint8Array([99, 0, 0, 0, 0, 0]))).toThrow(ProtocolError);
    expect(() => decodeEvent(new Uint8Array([1, 9, 0, 0, 0, 0]))).toThrow(ProtocolError);
    expect(() => decodeEvent(new Uint8Array([1, 0, 0]))).toThrow(ProtocolError);
  });
});

describe('device info', () => {
  const info: DeviceInfo = {
    version: { major: 1, minor: 2, patch: 0 },
    hardwareRev: 2,
    size: 'M',
    serial: 'WU26M00417',
    name: 'My Hoodie',
    cells: { left: { cycles: 41.3, health: 0.98 }, right: { cycles: 38, health: 0.985 } },
  };

  it('round-trips', () => {
    expect(decodeInfo(encodeInfo(info))).toEqual(info);
  });

  it('keeps a short serial intact', () => {
    expect(decodeInfo(encodeInfo({ ...info, serial: 'AB12' })).serial).toBe('AB12');
  });
});

describe('Bluetooth layout', () => {
  it('uses distinct, well-formed UUIDs', () => {
    const uuids = Object.values(GATT);
    expect(new Set(uuids).size).toBe(uuids.length);
    for (const uuid of uuids) expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
