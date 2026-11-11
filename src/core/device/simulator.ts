/**
 * A simulated hoodie.
 *
 * It runs the firmware model against a clock, speaks the real wire protocol
 * and persists the controller's memory, so the app behaves exactly as it
 * would against hardware. It also exposes the knobs a demo needs: speed up
 * time, change the weather, press a panel with a backpack, pull a cell.
 */
import { Firmware, defaultWorld, type World } from '../firmware/firmware';
import { AckCode, Opcode, decodeCommand, encodeAck, type AckCodeValue } from '../protocol/commands';
import { encodeEvent } from '../protocol/events';
import { FrameType, decodeFrame, encodeFrame } from '../protocol/frames';
import type { NotifyChannel, ReadChannel, WriteChannel } from '../protocol/gatt';
import { encodeInfo, type Advertisement } from '../protocol/info';
import { encodeTelemetry } from '../protocol/telemetry';
import { formatVersion, type CellId, type ZoneId } from '../types';
import { clamp } from '../units';
import { Listeners, TransportError, type HoodieTransport, type Unsubscribe } from './transport';

/** The timer functions the simulator needs. Tests substitute a fake clock. */
export interface SimTimers {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SIM_SPEEDS: readonly number[] = [1, 10, 60, 600];

export type CellPlacement = 'in' | 'out' | 'dock';

export interface SimulatorOptions {
  timers?: SimTimers;
  /** Where the controller's memory is kept between sessions. Null keeps nothing. */
  storage?: KeyValueStore | null;
  storageKey?: string;
  /** Real milliseconds between ticks. */
  tickMs?: number;
  /** Simulated radio latency for a command, real milliseconds. */
  latencyMs?: number;
  /** Latency for firmware chunks, which use the faster write type. */
  otaChunkLatencyMs?: number;
  /** How long a scan takes, real milliseconds. */
  scanMs?: number;
  /** Start from this controller instead of a saved or default one. */
  firmware?: Firmware;
  /** Wall clock used when a brand new hoodie is created, epoch seconds. */
  epochS?: number;
  tzOffsetMin?: number;
}

/** A snapshot of the simulation for the demo controls. */
export interface SimStatus {
  speed: number;
  running: boolean;
  connected: boolean;
  linkUp: boolean;
  world: World;
  version: string;
  rtcEpochS: number;
  tzOffsetMin: number;
  cells: Record<CellId, { placement: CellPlacement; soc: number }>;
  drawW: number;
  power: boolean;
}

const defaultTimers: SimTimers = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

interface SavedSim {
  firmware: unknown;
  world: World;
}

export class SimulatedHoodie implements HoodieTransport {
  readonly kind = 'simulator' as const;

  private fw: Firmware;
  private readonly timers: SimTimers;
  private readonly storage: KeyValueStore | null;
  private readonly storageKey: string;
  private readonly tickMs: number;
  private readonly latencyMs: number;
  private readonly otaChunkLatencyMs: number;
  private readonly scanMs: number;
  private readonly createOptions: { epochS?: number; tzOffsetMin?: number };

  private speedValue = 1;
  private handle: unknown = null;
  private lastTickAt = 0;
  private lastTelemetryUptime = -1;
  private ticksSinceSave = 0;
  private isConnected = false;
  private seq = 0;
  private status: SimStatus;

  private readonly notifyListeners = new Listeners<[NotifyChannel, Uint8Array]>();
  private readonly linkListeners = new Listeners<[boolean]>();
  private readonly statusListeners = new Listeners<[]>();

  constructor(options: SimulatorOptions = {}) {
    this.timers = options.timers ?? defaultTimers;
    this.storage = options.storage ?? null;
    this.storageKey = options.storageKey ?? 'warmup.sim.v1';
    this.tickMs = options.tickMs ?? 250;
    this.latencyMs = options.latencyMs ?? 40;
    this.otaChunkLatencyMs = options.otaChunkLatencyMs ?? 4;
    this.scanMs = options.scanMs ?? 1400;
    this.createOptions = { epochS: options.epochS, tzOffsetMin: options.tzOffsetMin };
    this.fw = options.firmware ?? this.load() ?? this.createFirmware();
    this.status = this.buildStatus();
  }

  private createFirmware(): Firmware {
    return Firmware.createWorn({
      epochS: this.createOptions.epochS ?? Math.floor(this.timers.now() / 1000),
      tzOffsetMin: this.createOptions.tzOffsetMin ?? 0,
    });
  }

  private load(): Firmware | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return null;
      const saved = JSON.parse(raw) as Partial<SavedSim>;
      const world = { ...defaultWorld(), ...saved.world, covered: { ...defaultWorld().covered, ...saved.world?.covered } };
      const fw = Firmware.restore(saved.firmware, world);
      if (!fw) return null;
      // An update that was in flight when the page closed did not survive it.
      fw.state.ota = null;
      fw.state.pendingVersion = null;
      fw.state.rebootRemainingS = 0;
      return fw;
    } catch {
      return null;
    }
  }

  /** Write the controller's memory to storage now. */
  save(): void {
    if (!this.storage) return;
    try {
      const saved: SavedSim = { firmware: this.fw.snapshot(), world: this.fw.world };
      this.storage.setItem(this.storageKey, JSON.stringify(saved));
    } catch {
      // Storage can be full or blocked. The simulation carries on without it.
    }
  }

  /** Direct access for tests and for the demo panel's read-outs. */
  get firmware(): Firmware {
    return this.fw;
  }

  // ───────────────────────────── running ─────────────────────────────

  start(): void {
    if (this.handle !== null) return;
    this.lastTickAt = this.timers.now();
    this.handle = this.timers.setInterval(() => this.tick(), this.tickMs);
    this.refreshStatus();
  }

  stop(): void {
    if (this.handle === null) return;
    this.timers.clearInterval(this.handle);
    this.handle = null;
    this.save();
    this.refreshStatus();
  }

  get running(): boolean {
    return this.handle !== null;
  }

  private tick(): void {
    const now = this.timers.now();
    // A sleeping tab can deliver one tick after minutes. Cap what it counts for.
    const realS = clamp((now - this.lastTickAt) / 1000, 0, 1);
    this.lastTickAt = now;
    this.advance(realS * this.speedValue);
    this.ticksSinceSave += 1;
    if (this.ticksSinceSave * this.tickMs >= 5000) {
      this.ticksSinceSave = 0;
      this.save();
    }
  }

  /** Move simulated time forward. Public so tests can drive it without timers. */
  advance(simSeconds: number): void {
    let remaining = simSeconds;
    while (remaining > 1e-9) {
      const h = Math.min(1, remaining);
      this.fw.step(h);
      remaining -= h;
    }
    this.afterStep();
  }

  private afterStep(): void {
    const linkUp = this.fw.isLinkUp();
    if (this.isConnected && !linkUp) this.dropLink();
    if (this.isConnected) {
      for (const event of this.fw.takeEvents()) this.notify('event', FrameType.Event, encodeEvent(event));
      const uptime = this.fw.state.uptimeS;
      if (this.speedValue > 1 || uptime - this.lastTelemetryUptime >= 1 || uptime < this.lastTelemetryUptime) {
        this.lastTelemetryUptime = uptime;
        this.notify('telemetry', FrameType.Telemetry, encodeTelemetry(this.fw.telemetry()));
      }
    }
    this.refreshStatus();
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) & 0xff;
    return this.seq;
  }

  private notify(channel: NotifyChannel, type: number, payload: Uint8Array, seq = this.nextSeq()): void {
    this.notifyListeners.emit(channel, encodeFrame({ type, seq, payload }));
  }

  private dropLink(): void {
    this.isConnected = false;
    this.linkListeners.emit(false);
  }

  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.timers.setTimeout(resolve, ms);
    });
  }

  // ───────────────────────────── transport ─────────────────────────────

  get connected(): boolean {
    return this.isConnected;
  }

  async scan(): Promise<Advertisement[]> {
    await this.delay(this.scanMs);
    return this.fw.isLinkUp() && !this.isConnected ? [this.fw.advertisement()] : [];
  }

  async connect(id: string): Promise<void> {
    await this.delay(this.latencyMs * 6);
    if (!this.fw.isLinkUp()) throw new TransportError('not-found', 'The hoodie is not responding. Check that a cell is in.');
    if (id !== this.fw.state.serial) throw new TransportError('not-found', 'That hoodie is not in range.');
    if (this.isConnected) return;
    this.isConnected = true;
    this.lastTelemetryUptime = -1;
    this.linkListeners.emit(true);
    this.refreshStatus();
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    this.dropLink();
    this.refreshStatus();
  }

  onNotify(listener: (channel: NotifyChannel, bytes: Uint8Array) => void): Unsubscribe {
    return this.notifyListeners.add(listener);
  }

  onLinkChange(listener: (connected: boolean) => void): Unsubscribe {
    return this.linkListeners.add(listener);
  }

  async write(_channel: WriteChannel, bytes: Uint8Array): Promise<void> {
    const isChunk = bytes[4] === Opcode.OtaChunk;
    await this.delay(isChunk ? this.otaChunkLatencyMs : this.latencyMs);
    if (!this.isConnected) throw new TransportError('not-connected', 'The hoodie is not connected.');
    let seq = 0;
    let opcode = 0;
    let code: AckCodeValue;
    try {
      const frame = decodeFrame(bytes);
      seq = frame.seq;
      opcode = frame.payload[0] ?? 0;
      code = frame.type === FrameType.Command ? this.fw.handle(decodeCommand(frame.payload)) : AckCode.Invalid;
    } catch {
      code = AckCode.Invalid;
    }
    this.notify('ack', FrameType.Ack, encodeAck({ opcode, code }), seq);
    // Report the new state straight away so the app never shows a stale one.
    if (!isChunk) this.changed();
  }

  async read(_channel: ReadChannel): Promise<Uint8Array> {
    await this.delay(this.latencyMs);
    if (!this.isConnected) throw new TransportError('not-connected', 'The hoodie is not connected.');
    return encodeFrame({ type: FrameType.Info, seq: this.nextSeq(), payload: encodeInfo(this.fw.info()) });
  }

  // ───────────────────────────── demo controls ─────────────────────────────

  get speed(): number {
    return this.speedValue;
  }

  setSpeed(speed: number): void {
    this.speedValue = clamp(speed, 0, 3600);
    this.refreshStatus();
  }

  setWorld(patch: Partial<World>): void {
    this.fw.world = { ...this.fw.world, ...patch, covered: { ...this.fw.world.covered, ...patch.covered } };
    this.refreshStatus();
  }

  setCovered(zone: ZoneId, covered: boolean): void {
    this.setWorld({ covered: { ...this.fw.world.covered, [zone]: covered } });
  }

  /** Report the new state at once, as the controller does after any change. */
  private changed(): void {
    this.lastTelemetryUptime = -1;
    this.afterStep();
  }

  pressButton(): void {
    this.fw.pressButton();
    this.changed();
  }

  setCell(id: CellId, placement: CellPlacement): void {
    if (placement === 'in') this.fw.insertCell(id);
    else if (placement === 'dock') this.fw.dockCell(id);
    else {
      this.fw.removeCell(id);
      if (this.fw.state.pack[id].docked) this.fw.state.pack[id] = { ...this.fw.state.pack[id], docked: false };
    }
    this.fw.step(0.001);
    this.changed();
  }

  /** Set a cell's charge directly, for showing low-battery behaviour. */
  setCellCharge(id: CellId, soc: number): void {
    this.fw.state.pack[id] = { ...this.fw.state.pack[id], soc: clamp(soc, 0, 1) };
    this.fw.step(0.001);
    this.changed();
  }

  /** Move the hoodie's clock to the next time the local clock reads this minute of the day. */
  jumpClockTo(minuteOfDay: number): void {
    const s = this.fw.state;
    const local = s.rtcEpochS + s.tzOffsetMin * 60;
    const dayStart = Math.floor(local / 86400) * 86400;
    let target = dayStart + minuteOfDay * 60;
    if (target <= local) target += 86400;
    s.rtcEpochS = target - s.tzOffsetMin * 60;
    this.changed();
  }

  /** Throw the hoodie away and start again with a fresh, worn-in one. */
  reset(): void {
    const wasConnected = this.isConnected;
    if (wasConnected) this.dropLink();
    this.storage?.removeItem(this.storageKey);
    this.fw = this.createFirmware();
    this.speedValue = 1;
    this.lastTelemetryUptime = -1;
    this.save();
    this.refreshStatus();
  }

  // ───────────────────────────── status for the UI ─────────────────────────────

  getStatus = (): SimStatus => this.status;

  onStatus(listener: () => void): Unsubscribe {
    return this.statusListeners.add(listener);
  }

  private buildStatus(): SimStatus {
    const s = this.fw.state;
    const placement = (id: CellId): CellPlacement => (s.pack[id].present ? 'in' : s.pack[id].docked ? 'dock' : 'out');
    return {
      speed: this.speedValue,
      running: this.handle !== null,
      connected: this.isConnected,
      linkUp: this.fw.isLinkUp(),
      world: { ...this.fw.world, covered: { ...this.fw.world.covered } },
      version: formatVersion(s.version),
      rtcEpochS: s.rtcEpochS,
      tzOffsetMin: s.tzOffsetMin,
      cells: {
        left: { placement: placement('left'), soc: s.pack.left.soc },
        right: { placement: placement('right'), soc: s.pack.right.soc },
      },
      drawW: s.drawEmaW,
      power: s.power,
    };
  }

  private refreshStatus(): void {
    this.status = this.buildStatus();
    this.statusListeners.emit();
  }
}
