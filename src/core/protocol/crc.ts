/**
 * Checksums used on the wire.
 *
 * CRC-16/CCITT-FALSE guards every frame. CRC-32 (the zlib polynomial) guards
 * a whole firmware image and is computed incrementally as chunks arrive.
 */

/** CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection. */
export function crc16(bytes: Uint8Array, length = bytes.length): number {
  let crc = 0xffff;
  for (let i = 0; i < length; i += 1) {
    crc ^= (bytes[i] ?? 0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Start value for an incremental CRC-32. */
export const CRC32_INIT = 0xffffffff;

/** Feed more bytes into a running CRC-32. */
export function crc32Update(running: number, bytes: Uint8Array): number {
  let crc = running >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC32_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/** Turn a running CRC-32 into the final checksum. */
export function crc32Finish(running: number): number {
  return (running ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a complete buffer. */
export function crc32(bytes: Uint8Array): number {
  return crc32Finish(crc32Update(CRC32_INIT, bytes));
}
