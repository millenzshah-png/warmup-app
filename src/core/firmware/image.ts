/**
 * Firmware images.
 *
 * There is no real controller binary yet, so the app builds a stand-in image
 * of the right size with a proper header and checksum. The transfer, the
 * integrity check and the failure paths are all exercised for real.
 *
 * Header, little endian:
 *   0   4 bytes  magic "WUFW"
 *   4   u8 x3    version major, minor, patch
 *   7   u8       header length (16)
 *   8   u32      body length
 *   12  u32      CRC-32 of the body
 */
import { parseVersion, type Version } from '../types';
import { crc32 } from '../protocol/crc';
import { findRelease } from './releases';

export const IMAGE_MAGIC = [0x57, 0x55, 0x46, 0x57] as const;
export const IMAGE_HEADER_BYTES = 16;

export interface FirmwareImage {
  version: Version;
  bytes: Uint8Array;
  /** CRC-32 of the whole image, header included. This is what the hoodie checks. */
  crc32: number;
}

/** Small deterministic generator so the same version always yields the same bytes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildFirmwareImage(versionText: string): FirmwareImage {
  const release = findRelease(versionText);
  if (!release) throw new Error(`No firmware release ${versionText}`);
  const version = parseVersion(versionText);
  const bytes = new Uint8Array(release.sizeBytes);
  const bodyLength = bytes.length - IMAGE_HEADER_BYTES;
  const random = mulberry32((version.major << 16) | (version.minor << 8) | version.patch);
  for (let i = IMAGE_HEADER_BYTES; i < bytes.length; i += 1) bytes[i] = Math.floor(random() * 256);
  const view = new DataView(bytes.buffer);
  bytes.set(IMAGE_MAGIC, 0);
  bytes[4] = version.major;
  bytes[5] = version.minor;
  bytes[6] = version.patch;
  bytes[7] = IMAGE_HEADER_BYTES;
  view.setUint32(8, bodyLength, true);
  view.setUint32(12, crc32(bytes.subarray(IMAGE_HEADER_BYTES)), true);
  return { version, bytes, crc32: crc32(bytes) };
}

export type ImageCheck = { ok: true; version: Version } | { ok: false; reason: 'magic' | 'length' | 'checksum' };

/** Validate an image's header and body checksum. */
export function checkFirmwareImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length < IMAGE_HEADER_BYTES) return { ok: false, reason: 'length' };
  for (let i = 0; i < IMAGE_MAGIC.length; i += 1) {
    if (bytes[i] !== IMAGE_MAGIC[i]) return { ok: false, reason: 'magic' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLength = view.getUint32(8, true);
  if (bodyLength !== bytes.length - IMAGE_HEADER_BYTES) return { ok: false, reason: 'length' };
  if (view.getUint32(12, true) !== crc32(bytes.subarray(IMAGE_HEADER_BYTES))) return { ok: false, reason: 'checksum' };
  return { ok: true, version: { major: bytes[4] ?? 0, minor: bytes[5] ?? 0, patch: bytes[6] ?? 0 } };
}
