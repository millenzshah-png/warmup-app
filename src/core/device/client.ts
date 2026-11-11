/**
 * Typed access to a hoodie over any transport.
 *
 * The client turns commands into frames, matches each acknowledgement to the
 * command that caused it, and decodes telemetry and events as they arrive.
 * Writes are queued so only one is ever in flight, which is what Bluetooth
 * LE expects.
 */
import {
  ACK_MESSAGES,
  AckCode,
  decodeAck,
  encodeCommand,
  type AckCodeValue,
  type Command,
  type CommandOp,
} from '../protocol/commands';
import { decodeEvent, type DeviceEvent } from '../protocol/events';
import { FrameType, decodeFrame, encodeFrame } from '../protocol/frames';
import type { NotifyChannel } from '../protocol/gatt';
import { decodeInfo, type Advertisement, type DeviceInfo } from '../protocol/info';
import { decodeTelemetry, type Telemetry } from '../protocol/telemetry';
import { Listeners, TransportError, type HoodieTransport, type Unsubscribe } from './transport';

/** The hoodie understood the command and refused it. */
export class CommandError extends Error {
  readonly code: AckCodeValue;
  readonly op: CommandOp;

  constructor(op: CommandOp, code: AckCodeValue) {
    super(ACK_MESSAGES[code]);
    this.name = 'CommandError';
    this.code = code;
    this.op = op;
  }
}

interface Pending {
  op: CommandOp;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ClientOptions {
  /** How long to wait for an acknowledgement, milliseconds. */
  ackTimeoutMs?: number;
}

export class HoodieClient {
  private readonly telemetryListeners = new Listeners<[Telemetry]>();
  private readonly eventListeners = new Listeners<[DeviceEvent]>();
  private readonly linkListeners = new Listeners<[boolean]>();
  private readonly pending = new Map<number, Pending>();
  private readonly ackTimeoutMs: number;
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;
  /** Frames that failed to decode. Exposed for diagnostics. */
  badFrames = 0;

  constructor(
    readonly transport: HoodieTransport,
    options: ClientOptions = {},
  ) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? 3000;
    transport.onNotify((channel, bytes) => this.onNotify(channel, bytes));
    transport.onLinkChange((connected) => {
      if (!connected) this.failAll(new TransportError('not-connected', 'The hoodie disconnected.'));
      this.linkListeners.emit(connected);
    });
  }

  get connected(): boolean {
    return this.transport.connected;
  }

  scan(): Promise<Advertisement[]> {
    return this.transport.scan();
  }

  /** Connect and read the device information. */
  async connect(id: string): Promise<DeviceInfo> {
    await this.transport.connect(id);
    return this.readInfo();
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  async readInfo(): Promise<DeviceInfo> {
    const frame = decodeFrame(await this.transport.read('info'));
    return decodeInfo(frame.payload);
  }

  onTelemetry(listener: (telemetry: Telemetry) => void): Unsubscribe {
    return this.telemetryListeners.add(listener);
  }

  onEvent(listener: (event: DeviceEvent) => void): Unsubscribe {
    return this.eventListeners.add(listener);
  }

  onLink(listener: (connected: boolean) => void): Unsubscribe {
    return this.linkListeners.add(listener);
  }

  /**
   * Send a command and wait for the hoodie to accept it. Rejects with a
   * CommandError when the hoodie refuses and a TransportError when the link
   * fails or no answer arrives in time.
   */
  send(cmd: Command): Promise<void> {
    const run = this.queue.then(() => this.sendNow(cmd));
    // Keep the queue alive whatever happens to this command.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private sendNow(cmd: Command): Promise<void> {
    if (!this.transport.connected) {
      return Promise.reject(new TransportError('not-connected', 'The hoodie is not connected.'));
    }
    this.seq = (this.seq % 255) + 1;
    const seq = this.seq;
    const bytes = encodeFrame({ type: FrameType.Command, seq, payload: encodeCommand(cmd) });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new TransportError('timeout', 'The hoodie did not answer in time.'));
      }, this.ackTimeoutMs);
      this.pending.set(seq, { op: cmd.op, resolve, reject, timer });
      this.transport.write('command', bytes).catch((error: unknown) => {
        const entry = this.pending.get(seq);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(seq);
        reject(error instanceof Error ? error : new TransportError('unavailable', String(error)));
      });
    });
  }

  private failAll(error: Error): void {
    for (const [seq, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(seq);
      entry.reject(error);
    }
  }

  private onNotify(channel: NotifyChannel, bytes: Uint8Array): void {
    try {
      const frame = decodeFrame(bytes);
      if (channel === 'telemetry' && frame.type === FrameType.Telemetry) {
        this.telemetryListeners.emit(decodeTelemetry(frame.payload));
      } else if (channel === 'event' && frame.type === FrameType.Event) {
        this.eventListeners.emit(decodeEvent(frame.payload));
      } else if (channel === 'ack' && frame.type === FrameType.Ack) {
        const entry = this.pending.get(frame.seq);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(frame.seq);
        const ack = decodeAck(frame.payload);
        if (ack.code === AckCode.Ok) entry.resolve();
        else entry.reject(new CommandError(entry.op, ack.code));
      }
    } catch {
      // A corrupt frame is dropped. The next telemetry frame replaces it.
      this.badFrames += 1;
    }
  }
}
