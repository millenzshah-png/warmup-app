/**
 * Frame envelope shared by every message between the app and the hoodie.
 *
 *   byte 0      0xA5 start of frame
 *   byte 1      frame type
 *   byte 2      sequence number, wraps at 255
 *   byte 3      payload length N (0 to 240)
 *   byte 4..    payload
 *   last two    CRC-16/CCITT-FALSE of everything before it, little endian
 *
 * The same bytes travel over Bluetooth LE to a real controller and over an
 * in-memory link to the simulator, so the app has exactly one code path.
 */
import { crc16 } from './crc';

export const START_OF_FRAME = 0xa5;
export const MAX_PAYLOAD_BYTES = 240;
const HEADER_BYTES = 4;
const TRAILER_BYTES = 2;

export const FrameType = {
  Telemetry: 0x01,
  Event: 0x02,
  Ack: 0x03,
  Command: 0x10,
  Info: 0x20,
} as const;

export type FrameTypeCode = (typeof FrameType)[keyof typeof FrameType];

export interface Frame {
  type: number;
  seq: number;
  payload: Uint8Array;
}

export type ProtocolErrorCode = 'too-short' | 'bad-start' | 'bad-length' | 'bad-crc' | 'bad-payload' | 'too-long';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export function encodeFrame(frame: Frame): Uint8Array {
  const n = frame.payload.length;
  if (n > MAX_PAYLOAD_BYTES) throw new ProtocolError('too-long', `Payload of ${n} bytes exceeds ${MAX_PAYLOAD_BYTES}`);
  const out = new Uint8Array(HEADER_BYTES + n + TRAILER_BYTES);
  out[0] = START_OF_FRAME;
  out[1] = frame.type & 0xff;
  out[2] = frame.seq & 0xff;
  out[3] = n;
  out.set(frame.payload, HEADER_BYTES);
  const crc = crc16(out, HEADER_BYTES + n);
  out[HEADER_BYTES + n] = crc & 0xff;
  out[HEADER_BYTES + n + 1] = (crc >> 8) & 0xff;
  return out;
}

export function decodeFrame(bytes: Uint8Array): Frame {
  if (bytes.length < HEADER_BYTES + TRAILER_BYTES) {
    throw new ProtocolError('too-short', `Frame of ${bytes.length} bytes is too short`);
  }
  if (bytes[0] !== START_OF_FRAME) throw new ProtocolError('bad-start', 'Frame does not start with 0xA5');
  const n = bytes[3] ?? 0;
  if (n > MAX_PAYLOAD_BYTES || bytes.length !== HEADER_BYTES + n + TRAILER_BYTES) {
    throw new ProtocolError('bad-length', `Frame length ${bytes.length} does not match payload length ${n}`);
  }
  const expected = crc16(bytes, HEADER_BYTES + n);
  const actual = (bytes[HEADER_BYTES + n] ?? 0) | ((bytes[HEADER_BYTES + n + 1] ?? 0) << 8);
  if (expected !== actual) throw new ProtocolError('bad-crc', 'Frame checksum does not match');
  return {
    type: bytes[1] ?? 0,
    seq: bytes[2] ?? 0,
    payload: bytes.slice(HEADER_BYTES, HEADER_BYTES + n),
  };
}

/** Sequential little-endian writer over a fixed buffer. */
export class ByteWriter {
  private readonly view: DataView;
  private offset = 0;
  readonly bytes: Uint8Array;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(value: number): this {
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
    return this;
  }

  u16(value: number): this {
    this.view.setUint16(this.offset, Math.max(0, Math.min(0xffff, Math.round(value))), true);
    this.offset += 2;
    return this;
  }

  i16(value: number): this {
    this.view.setInt16(this.offset, Math.max(-0x8000, Math.min(0x7fff, Math.round(value))), true);
    this.offset += 2;
    return this;
  }

  u32(value: number): this {
    this.view.setUint32(this.offset, Math.max(0, Math.min(0xffffffff, Math.round(value))) >>> 0, true);
    this.offset += 4;
    return this;
  }

  raw(data: Uint8Array): this {
    this.bytes.set(data, this.offset);
    this.offset += data.length;
    return this;
  }

  /** The bytes written so far. */
  done(): Uint8Array {
    return this.offset === this.bytes.length ? this.bytes : this.bytes.slice(0, this.offset);
  }
}

/** Sequential little-endian reader that refuses to run past the end. */
export class ByteReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(n: number): void {
    if (this.remaining < n) throw new ProtocolError('bad-payload', `Payload ended ${n - this.remaining} bytes early`);
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  raw(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  rest(): Uint8Array {
    return this.raw(this.remaining);
  }
}

/** Temperatures travel as hundredths of a degree Celsius in a signed 16-bit. */
export const toCenti = (celsius: number): number => Math.round(celsius * 100);
export const fromCenti = (centi: number): number => centi / 100;

/** Fractions travel as 0 to 200, which gives half-percent steps. */
export const toHalfPercent = (fraction: number): number => Math.max(0, Math.min(200, Math.round(fraction * 200)));
export const fromHalfPercent = (value: number): number => Math.max(0, Math.min(200, value)) / 200;
