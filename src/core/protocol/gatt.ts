/**
 * Bluetooth LE layout for the hem controller.
 *
 * One custom service with five characteristics. The simulator does not use
 * the UUIDs, only the channel names, but the Web Bluetooth transport and the
 * firmware team both work from this table.
 */

/** Base: 57 41 52 4D = "WARM" in ASCII. */
const uuid = (short: string): string => `5741524d-${short}-4d55-9c1a-7a3e5f0b2d10`;

export const GATT = {
  service: uuid('0001'),
  /** Notify. Telemetry frames, about one a second. */
  telemetry: uuid('0002'),
  /** Notify. Event frames, sent the moment something happens. */
  event: uuid('0003'),
  /** Write with response. Command frames. */
  command: uuid('0004'),
  /** Notify. Ack frames answering each command. */
  ack: uuid('0005'),
  /** Read. One Info frame. */
  info: uuid('0006'),
} as const;

export type NotifyChannel = 'telemetry' | 'event' | 'ack';
export type WriteChannel = 'command';
export type ReadChannel = 'info';

export const NOTIFY_CHANNELS: readonly NotifyChannel[] = ['telemetry', 'event', 'ack'];

/** Name prefix the controller advertises, used to filter a scan. */
export const ADVERTISED_NAME_PREFIX = 'Warmup';
