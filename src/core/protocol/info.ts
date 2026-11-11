/**
 * Device information, read once after connecting and again after an update.
 *
 * Payload, little endian:
 *
 *   0   u8 x3  firmware version major, minor, patch
 *   3   u8     hardware revision
 *   4   u8     size index (XS to XXL)
 *   5   u8 x10 serial number, ASCII, zero padded
 *   15  u16    left cell cycles, tenths
 *   17  u8     left cell health, half percent
 *   18  u16    right cell cycles, tenths
 *   20  u8     right cell health, half percent
 *   21  u8     name length N
 *   22  ...    name, UTF-8
 */
import { HOODIE_SIZES, type CellMap, type HoodieSize, type Version } from '../types';
import { DEVICE_NAME_MAX_BYTES, decodeName, encodeName } from './commands';
import { ByteReader, ByteWriter, ProtocolError, fromHalfPercent, toHalfPercent } from './frames';

export const SERIAL_BYTES = 10;

export interface CellInfo {
  /** Equivalent full cycles. */
  cycles: number;
  /** State of health, 0 to 1. */
  health: number;
}

export interface DeviceInfo {
  version: Version;
  hardwareRev: number;
  size: HoodieSize;
  serial: string;
  name: string;
  cells: CellMap<CellInfo>;
}

export function encodeInfo(info: DeviceInfo): Uint8Array {
  const name = encodeName(info.name);
  const serial = new Uint8Array(SERIAL_BYTES);
  for (let i = 0; i < SERIAL_BYTES && i < info.serial.length; i += 1) serial[i] = info.serial.charCodeAt(i) & 0x7f;
  return new ByteWriter(22 + name.length)
    .u8(info.version.major)
    .u8(info.version.minor)
    .u8(info.version.patch)
    .u8(info.hardwareRev)
    .u8(Math.max(0, HOODIE_SIZES.indexOf(info.size)))
    .raw(serial)
    .u16(info.cells.left.cycles * 10)
    .u8(toHalfPercent(info.cells.left.health))
    .u16(info.cells.right.cycles * 10)
    .u8(toHalfPercent(info.cells.right.health))
    .u8(name.length)
    .raw(name)
    .done();
}

export function decodeInfo(payload: Uint8Array): DeviceInfo {
  const r = new ByteReader(payload);
  const version = { major: r.u8(), minor: r.u8(), patch: r.u8() };
  const hardwareRev = r.u8();
  const size = HOODIE_SIZES[r.u8()];
  if (!size) throw new ProtocolError('bad-payload', 'Unknown size');
  const serialBytes = r.raw(SERIAL_BYTES);
  let serial = '';
  for (const byte of serialBytes) if (byte !== 0) serial += String.fromCharCode(byte);
  const left: CellInfo = { cycles: r.u16() / 10, health: fromHalfPercent(r.u8()) };
  const right: CellInfo = { cycles: r.u16() / 10, health: fromHalfPercent(r.u8()) };
  const nameLength = r.u8();
  if (nameLength > DEVICE_NAME_MAX_BYTES) throw new ProtocolError('bad-payload', 'Name too long');
  const name = decodeName(r.raw(nameLength));
  return { version, hardwareRev, size, serial, name, cells: { left, right } };
}

/** What a hoodie broadcasts while it waits to be paired. */
export interface Advertisement {
  /** Stable id of the device on this transport. */
  id: string;
  name: string;
  size: HoodieSize;
  /** Charge of each seated cell, 0 to 1, or null when a cell is out. */
  cells: CellMap<number | null>;
  /** Received signal strength, dBm. */
  rssi: number;
}
