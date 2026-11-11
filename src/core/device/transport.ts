/**
 * The link between the app and a hoodie.
 *
 * Two implementations exist: the simulator, which is what every demo and
 * test uses, and Web Bluetooth, which is ready for a real hem controller.
 * Both carry the same frames, so nothing above this interface can tell them
 * apart.
 */
import type { NotifyChannel, ReadChannel, WriteChannel } from '../protocol/gatt';
import type { Advertisement } from '../protocol/info';

export type Unsubscribe = () => void;

export type TransportErrorCode = 'not-connected' | 'not-found' | 'unavailable' | 'timeout' | 'cancelled';

export class TransportError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}

export interface HoodieTransport {
  readonly kind: 'simulator' | 'bluetooth';
  readonly connected: boolean;
  /** Look for hoodies that are advertising nearby. */
  scan(): Promise<Advertisement[]>;
  connect(id: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Subscribe to notifications on every notify channel. */
  onNotify(listener: (channel: NotifyChannel, bytes: Uint8Array) => void): Unsubscribe;
  /** Called with true when the link comes up and false when it drops. */
  onLinkChange(listener: (connected: boolean) => void): Unsubscribe;
  write(channel: WriteChannel, bytes: Uint8Array): Promise<void>;
  read(channel: ReadChannel): Promise<Uint8Array>;
}

/** A tiny typed listener set, shared by the transports and the client. */
export class Listeners<Args extends unknown[]> {
  private readonly set = new Set<(...args: Args) => void>();

  add(listener: (...args: Args) => void): Unsubscribe {
    this.set.add(listener);
    return () => {
      this.set.delete(listener);
    };
  }

  emit(...args: Args): void {
    for (const listener of [...this.set]) listener(...args);
  }

  get size(): number {
    return this.set.size;
  }
}
