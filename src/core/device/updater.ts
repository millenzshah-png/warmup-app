/**
 * Sending a firmware image to the hoodie.
 *
 * The phone fetches the image, announces it, streams it in chunks and asks
 * the hoodie to verify it. The hoodie checks the CRC-32 itself, so a damaged
 * transfer is rejected on the device and never installed.
 */
import { buildFirmwareImage, type FirmwareImage } from '../firmware/image';
import { OTA_CHUNK_BYTES } from '../protocol/commands';
import type { HoodieClient } from './client';

export type UpdateStage = 'idle' | 'downloading' | 'installing' | 'verifying' | 'restarting' | 'done' | 'failed';

/** Where each stage sits on the 0 to 100 progress ring. */
const STAGE_RANGE: Record<UpdateStage, readonly [number, number]> = {
  idle: [0, 0],
  downloading: [0, 30],
  installing: [30, 90],
  verifying: [90, 94],
  restarting: [94, 99],
  done: [100, 100],
  failed: [0, 0],
};

/** Overall percent for a stage that is `fraction` of the way through. */
export function updatePercent(stage: UpdateStage, fraction = 0): number {
  const [from, to] = STAGE_RANGE[stage];
  return Math.round(from + (to - from) * Math.max(0, Math.min(1, fraction)));
}

export const STAGE_LABELS: Record<UpdateStage, string> = {
  idle: 'Ready',
  downloading: 'Downloading',
  installing: 'Installing',
  verifying: 'Verifying',
  restarting: 'Restarting',
  done: 'Done',
  failed: 'Stopped',
};

export interface DownloadOptions {
  sleep: (ms: number) => Promise<void>;
  onProgress: (fraction: number) => void;
  /** Pause between progress steps, milliseconds. */
  stepMs?: number;
  steps?: number;
}

/**
 * Fetch a firmware image. There is no update server yet, so this builds the
 * image locally and paces itself like a download.
 */
export async function downloadFirmware(version: string, options: DownloadOptions): Promise<FirmwareImage> {
  const steps = options.steps ?? 12;
  const stepMs = options.stepMs ?? 140;
  const image = buildFirmwareImage(version);
  for (let i = 1; i <= steps; i += 1) {
    await options.sleep(stepMs);
    options.onProgress(i / steps);
  }
  return image;
}

/** Stream an image to the hoodie and have it verified. Rejects if the hoodie refuses. */
export async function transferFirmware(
  client: HoodieClient,
  image: FirmwareImage,
  onProgress: (fraction: number) => void,
  options: { chunkBytes?: number; onVerifying?: () => void } = {},
): Promise<void> {
  const chunkBytes = options.chunkBytes ?? OTA_CHUNK_BYTES;
  const total = image.bytes.length;
  await client.send({ op: 'otaBegin', size: total, crc32: image.crc32, version: image.version });
  try {
    for (let offset = 0; offset < total; offset += chunkBytes) {
      const data = image.bytes.subarray(offset, Math.min(total, offset + chunkBytes));
      await client.send({ op: 'otaChunk', offset, data });
      onProgress(Math.min(1, (offset + data.length) / total));
    }
  } catch (error) {
    // Leave the hoodie in a clean state if the stream breaks part way.
    await client.send({ op: 'otaAbort' }).catch(() => undefined);
    throw error;
  }
  options.onVerifying?.();
  await client.send({ op: 'otaEnd' });
}
