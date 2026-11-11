/**
 * The app controller.
 *
 * Screens never talk to the hoodie directly. They call a method here, the
 * controller sends the command, and the result comes back through the store
 * when the hoodie's next telemetry frame arrives. That keeps the hoodie as
 * the single source of truth for anything it owns (power, level, zones, the
 * running mode) while the app owns the rest (profiles, modes, schedule).
 */
import { CommandError, HoodieClient } from '../device/client';
import type { KeyValueStore } from '../device/simulator';
import { TransportError, type HoodieTransport, type Unsubscribe } from '../device/transport';
import { downloadFirmware, transferFirmware, updatePercent, type UpdateStage } from '../device/updater';
import { recordSample, sampleHistory } from '../insights/history';
import {
  cloneMode,
  createCustomMode,
  findMode,
  findModeBySlot,
  normalizeMode,
  type CreateModeResult,
  type CustomModeInput,
  type ModeConfig,
} from '../modes';
import { activeMode, createProfile, initialsOf, validateProfileName, type Profile } from '../profiles';
import { AckCode, modeParamsFromConfig, type Command } from '../protocol/commands';
import type { DeviceEvent } from '../protocol/events';
import type { DeviceInfo } from '../protocol/info';
import type { Telemetry } from '../protocol/telemetry';
import { localDayNumber, localSecondOfDay, toDeviceSchedule, type Schedule } from '../schedule/schedule';
import { addToBag, removeLine, setQuantity } from '../shop/bag';
import type { Configuration } from '../shop/catalog';
import { createPersistence, type Persistence } from '../store/persistence';
import { createStore, type Store } from '../store/store';
import { FAULT_NONE } from '../thermal/safety';
import {
  CELL_IDS,
  ZONE_IDS,
  ZONE_NAMES,
  formatVersion,
  type HoodieSize,
  type Level,
  type TempUnit,
  type ZoneId,
} from '../types';
import { noticeForEvent, type Notice } from './messages';
import type { PhoneReading, PhoneSensors } from './phone-sensors';
import { activeProfile, currentMode, localTzOffsetMin, updateReadiness } from './selectors';
import {
  APP_SCHEMA,
  APP_STORAGE_KEY,
  defaultPersistedState,
  initialAppState,
  persistedChanged,
  selectPersisted,
  validatePersisted,
  type AppState,
  type HoodieRecord,
  type PersistedState,
  type Settings,
  type UpdateStatus,
} from './state';

export interface AppControllerOptions {
  transport: HoodieTransport;
  storage?: KeyValueStore | null;
  sensors?: PhoneSensors | null;
  /** Wall clock, milliseconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  tzOffsetMin?: () => number;
  reconnectDelayMs?: number;
  /** How long to wait before writing changed state to storage. Zero writes at once. */
  saveDelayMs?: number;
  /** Pause between download progress steps. */
  downloadStepMs?: number;
  ackTimeoutMs?: number;
  /** How long to wait for the hoodie to come back after an update. */
  rebootTimeoutMs?: number;
}

export interface SetupInput {
  name: string;
  size: HoodieSize;
  unit: TempUnit;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };
const MAX_TOASTS = 3;
const NOT_CONNECTED = 'The hoodie is not connected.';

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AppController {
  readonly store: Store<AppState>;
  readonly client: HoodieClient;

  private readonly persistence: Persistence<PersistedState>;
  private readonly sensors: PhoneSensors | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tzOffsetMin: () => number;
  private readonly reconnectDelayMs: number;
  private readonly saveDelayMs: number;
  private readonly downloadStepMs: number;
  private readonly rebootTimeoutMs: number;

  private unsubscribes: Unsubscribe[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private wantLink = false;
  private reconnectToken = 0;
  private lastUptimeS: number | null = null;
  private toastId = 0;
  private started = false;

  constructor(options: AppControllerOptions) {
    this.sensors = options.sensors ?? null;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.tzOffsetMin = options.tzOffsetMin ?? (() => localTzOffsetMin());
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1500;
    this.saveDelayMs = options.saveDelayMs ?? 800;
    this.downloadStepMs = options.downloadStepMs ?? 140;
    this.rebootTimeoutMs = options.rebootTimeoutMs ?? 30_000;

    this.persistence = createPersistence<PersistedState>({
      storage: options.storage ?? null,
      key: APP_STORAGE_KEY,
      schema: APP_SCHEMA,
      validate: validatePersisted,
      now: this.now,
    });
    this.store = createStore<AppState>(initialAppState(this.persistence.load() ?? defaultPersistedState()));
    this.client = new HoodieClient(options.transport, { ackTimeoutMs: options.ackTimeoutMs });
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /** Wire everything up and reconnect to a hoodie that is already paired. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribes.push(
      this.client.onTelemetry((t) => this.onTelemetry(t)),
      this.client.onEvent((e) => this.onEvent(e)),
      this.client.onLink((connected) => this.onLink(connected)),
    );
    if (this.sensors) this.unsubscribes.push(this.sensors.subscribe((reading) => void this.sendContext(reading)));

    let previous = this.store.get();
    this.unsubscribes.push(
      this.store.subscribe(() => {
        const current = this.store.get();
        if (persistedChanged(previous, current)) this.scheduleSave();
        previous = current;
      }),
    );

    const state = this.store.get();
    if (state.onboarded && state.hoodie) {
      this.wantLink = true;
      this.store.patch({ link: 'connecting' });
      void this.reconnect();
    }
  }

  dispose(): void {
    this.wantLink = false;
    this.reconnectToken += 1;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    this.flush();
    this.started = false;
  }

  /** Write the persisted half of the state to storage now. */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persistence.save(selectPersisted(this.store.get()));
  }

  private scheduleSave(): void {
    if (this.saveDelayMs <= 0) {
      this.flush();
      return;
    }
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistence.save(selectPersisted(this.store.get()));
    }, this.saveDelayMs);
  }

  private get state(): AppState {
    return this.store.get();
  }

  private epochS(): number {
    const t = this.state.telemetry;
    return t && this.state.link === 'connected' ? t.rtcEpochS : Math.floor(this.now() / 1000);
  }

  // ───────────────────────────── notices ─────────────────────────────

  notify(notice: Notice): void {
    this.toastId += 1;
    const toast = { id: this.toastId, ...notice };
    this.store.set((s) => ({ ...s, toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
  }

  dismissToast(id: number): void {
    this.store.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
  }

  private errorMessage(error: unknown): string {
    if (error instanceof CommandError) return error.message;
    if (error instanceof TransportError) return error.code === 'timeout' ? 'The hoodie did not answer. Try again.' : NOT_CONNECTED;
    return 'Something went wrong. Try again.';
  }

  /** Send a command. Failures become a notice unless `quiet` is set. */
  private async command(cmd: Command, quiet = false): Promise<ActionResult> {
    try {
      await this.client.send(cmd);
      return OK;
    } catch (error) {
      const message = this.errorMessage(error);
      if (!quiet) this.notify({ tone: 'warn', title: message, body: null });
      return { ok: false, error: message };
    }
  }

  // ───────────────────────────── pairing and link ─────────────────────────────

  /** Look for hoodies in pairing mode. */
  async scan(): Promise<void> {
    if (this.state.link === 'scanning' || this.state.link === 'connecting') return;
    this.store.patch({ link: 'scanning', found: [], scanMessage: null });
    try {
      const found = await this.client.scan();
      this.store.patch({
        link: this.client.connected ? 'connected' : 'idle',
        found,
        scanMessage: found.length > 0 ? null : 'No hoodie found. Hold the hem button for three seconds and try again.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bluetooth is not available.';
      this.store.patch({ link: 'idle', found: [], scanMessage: message });
    }
  }

  /** Connect to a hoodie found by a scan. */
  async connect(id: string): Promise<ActionResult> {
    this.wantLink = true;
    this.reconnectToken += 1;
    this.store.patch({ link: 'connecting', scanMessage: null });
    try {
      await this.establish(id);
      return OK;
    } catch (error) {
      this.wantLink = false;
      const message = error instanceof Error ? error.message : NOT_CONNECTED;
      this.store.patch({ link: 'idle', scanMessage: message });
      return { ok: false, error: message };
    }
  }

  private async establish(id: string): Promise<DeviceInfo> {
    const info = await this.client.connect(id);
    this.applyInfo(info, id);
    this.lastUptimeS = null;
    await this.pushSetup();
    this.store.patch({ link: 'connected' });
    return info;
  }

  private applyInfo(info: DeviceInfo, id?: string): void {
    const previous = this.state.hoodie;
    const hoodie: HoodieRecord = {
      id: id ?? previous?.id ?? info.serial,
      serial: info.serial,
      name: info.name,
      size: info.size,
      version: formatVersion(info.version),
      cells: info.cells,
    };
    this.store.patch({ hoodie });
  }

  /** Bring the hoodie's clock, preferences, schedule and context up to date. */
  private async pushSetup(): Promise<void> {
    const s = this.state;
    await this.command({ op: 'syncTime', epochS: Math.floor(this.now() / 1000), tzOffsetMin: this.tzOffsetMin() }, true);
    await this.command(
      { op: 'setPrefs', autoOffWhenStill: s.settings.autoOffWhenStill, buttonHaptics: s.settings.buttonHaptics },
      true,
    );
    await this.pushSchedule(true);
    if (this.sensors) await this.sendContext(this.sensors.read());
  }

  private async pushSchedule(quiet = false): Promise<ActionResult> {
    const s = this.state;
    const profile = activeProfile(s);
    const mode = findMode(profile.modes, s.schedule.modeId) ?? findMode(profile.modes, 'commute') ?? activeMode(profile);
    return this.command({ op: 'setSchedule', schedule: toDeviceSchedule(s.schedule, mode, profile.level) }, quiet);
  }

  private async sendContext(reading: PhoneReading): Promise<void> {
    if (!this.client.connected) return;
    await this.command({ op: 'setContext', outdoors: reading.outdoors, moving: reading.moving, outdoorC: reading.outdoorC }, true);
  }

  private async reconnect(): Promise<void> {
    const token = (this.reconnectToken += 1);
    while (this.wantLink && token === this.reconnectToken && !this.client.connected) {
      const id = this.state.hoodie?.id;
      if (!id) return;
      try {
        await this.establish(id);
        return;
      } catch {
        await this.sleep(this.reconnectDelayMs);
      }
    }
  }

  private onLink(connected: boolean): void {
    if (connected) return;
    this.lastUptimeS = null;
    if (!this.wantLink || !this.state.hoodie) {
      this.store.patch({ link: 'idle' });
      return;
    }
    this.store.patch({ link: 'reconnecting', saturatedSinceS: null });
    void this.reconnect();
  }

  /** Finish setup: name the hoodie, set its size, pick a unit. */
  async completeSetup(input: SetupInput): Promise<ActionResult> {
    const name = input.name.trim() || 'My Hoodie';
    if (this.client.connected) {
      await this.command({ op: 'setName', name }, true);
      await this.command({ op: 'setSize', size: input.size }, true);
      try {
        this.applyInfo(await this.client.readInfo());
      } catch {
        // The record is refreshed on the next connection instead.
      }
    }
    const s = this.state;
    const today = localDayNumber(this.epochS(), this.tzOffsetMin());
    this.store.patch({
      onboarded: true,
      settings: { ...s.settings, unit: input.unit },
      history: s.history.days.length === 0 ? sampleHistory(today) : s.history,
    });
    return OK;
  }

  /** Leave setup without pairing. The app opens with no hoodie attached. */
  skipSetup(): void {
    this.wantLink = false;
    this.store.patch({ onboarded: true, link: 'idle' });
  }

  /** Unpair and wipe everything the app knows, as if freshly installed. */
  async forgetHoodie(): Promise<void> {
    this.wantLink = false;
    this.reconnectToken += 1;
    await this.client.disconnect().catch(() => undefined);
    this.lastUptimeS = null;
    this.store.set(() => initialAppState(defaultPersistedState()));
    this.flush();
  }

  async renameHoodie(name: string): Promise<ActionResult> {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: 'Enter a name.' };
    const result = await this.command({ op: 'setName', name: trimmed });
    if (result.ok && this.state.hoodie) this.store.patch({ hoodie: { ...this.state.hoodie, name: trimmed } });
    return result;
  }

  // ───────────────────────────── heat ─────────────────────────────

  setPower(on: boolean): Promise<ActionResult> {
    return this.command({ op: 'setPower', on });
  }

  togglePower(): Promise<ActionResult> {
    return this.setPower(!(this.state.telemetry?.power ?? false));
  }

  /** Choose a level. As on the hoodie's own button, this also switches heat on. */
  async setLevel(level: Level): Promise<ActionResult> {
    this.updateProfile(this.state.activeProfileId, (p) => ({ ...p, level }));
    const result = await this.command({ op: 'setLevel', level });
    if (!result.ok) return result;
    if (!(this.state.telemetry?.power ?? false)) return this.setPower(true);
    return OK;
  }

  /** Switch to a mode and start heating. */
  async selectMode(modeId: string): Promise<ActionResult> {
    const mode = findMode(activeProfile(this.state).modes, modeId);
    if (!mode) return { ok: false, error: 'That mode no longer exists.' };
    this.updateProfile(this.state.activeProfileId, (p) => ({ ...p, activeModeId: modeId }));
    return this.command({ op: 'setMode', mode: modeParamsFromConfig(mode), start: true });
  }

  async setZone(zone: ZoneId, on: boolean): Promise<ActionResult> {
    const t = this.state.telemetry;
    if (!t) {
      this.notify({ tone: 'warn', title: NOT_CONNECTED, body: null });
      return { ok: false, error: NOT_CONNECTED };
    }
    // Switching a locked-out zone back on is a deliberate override.
    if (on && t.zoneSafety[zone] === 'lockout') {
      const cleared = await this.command({ op: 'safetyAck', zone, action: 'clearLockout' });
      if (!cleared.ok) return cleared;
    }
    return this.command({ op: 'setZones', zones: { ...t.zonesEnabled, [zone]: on } });
  }

  toggleZone(zone: ZoneId): Promise<ActionResult> {
    return this.setZone(zone, !(this.state.telemetry?.zonesEnabled[zone] ?? false));
  }

  // ───────────────────────────── modes ─────────────────────────────

  private updateProfile(profileId: string, change: (profile: Profile) => Profile): void {
    this.store.set((s) => {
      let changed = false;
      const profiles = s.profiles.map((p) => {
        if (p.id !== profileId) return p;
        const next = change(p);
        if (next !== p) changed = true;
        return next;
      });
      return changed ? { ...s, profiles } : s;
    });
  }

  /**
   * Save changes to a mode in the active profile. With `start`, the hoodie
   * switches to it straight away. Without, the hoodie is only told when the
   * edited mode is the one already running.
   */
  async saveMode(mode: ModeConfig, start: boolean): Promise<ActionResult> {
    const clean = normalizeMode(mode);
    const running = currentMode(this.state).id === clean.id;
    this.updateProfile(this.state.activeProfileId, (p) => ({
      ...p,
      modes: p.modes.map((m) => (m.id === clean.id ? clean : m)),
      activeModeId: start ? clean.id : p.activeModeId,
    }));
    if (this.state.schedule.modeId === clean.id && this.client.connected) await this.pushSchedule(true);
    if (start) return this.command({ op: 'setMode', mode: modeParamsFromConfig(clean), start: true });
    if (running && this.client.connected) {
      return this.command({ op: 'setMode', mode: modeParamsFromConfig(clean), start: false });
    }
    return OK;
  }

  /** Create a custom mode and switch to it. */
  async createMode(input: CustomModeInput): Promise<CreateModeResult> {
    const profile = activeProfile(this.state);
    const result = createCustomMode(input, profile.modes);
    if (!result.ok) return result;
    this.updateProfile(profile.id, (p) => ({ ...p, modes: [...p.modes, result.mode], activeModeId: result.mode.id }));
    if (this.client.connected) {
      await this.command({ op: 'setMode', mode: modeParamsFromConfig(result.mode), start: true });
    }
    return result;
  }

  /** Delete a custom mode. If it was running, the hoodie falls back to Auto. */
  async deleteMode(modeId: string): Promise<ActionResult> {
    const profile = activeProfile(this.state);
    const mode = findMode(profile.modes, modeId);
    if (!mode) return OK;
    if (mode.builtIn) return { ok: false, error: 'Built-in modes cannot be deleted.' };
    const wasRunning = currentMode(this.state).id === modeId;
    const auto = findMode(profile.modes, 'auto');
    this.updateProfile(profile.id, (p) => ({
      ...p,
      modes: p.modes.filter((m) => m.id !== modeId),
      activeModeId: p.activeModeId === modeId ? 'auto' : p.activeModeId,
    }));
    if (this.state.schedule.modeId === modeId) await this.updateSchedule({ modeId: 'commute' });
    if (wasRunning && auto && this.client.connected) {
      return this.command({ op: 'setMode', mode: modeParamsFromConfig(auto), start: false });
    }
    return OK;
  }

  // ───────────────────────────── schedule and settings ─────────────────────────────

  async updateSchedule(patch: Partial<Schedule>): Promise<ActionResult> {
    this.store.set((s) => ({ ...s, schedule: { ...s.schedule, ...patch } }));
    if (!this.client.connected) return OK;
    return this.pushSchedule();
  }

  setUnit(unit: TempUnit): void {
    this.store.set((s) => ({ ...s, settings: { ...s.settings, unit } }));
  }

  async setSetting(key: Exclude<keyof Settings, 'unit'>, value: boolean): Promise<ActionResult> {
    this.store.set((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
    if (key === 'notifications' || !this.client.connected) return OK;
    const { autoOffWhenStill, buttonHaptics } = this.state.settings;
    return this.command({ op: 'setPrefs', autoOffWhenStill, buttonHaptics });
  }

  // ───────────────────────────── profiles ─────────────────────────────

  /** Hand the hoodie to another profile and apply their mode and level. */
  async selectProfile(profileId: string): Promise<ActionResult> {
    const profile = this.state.profiles.find((p) => p.id === profileId);
    if (!profile) return { ok: false, error: 'That profile no longer exists.' };
    if (profileId === this.state.activeProfileId) return OK;
    this.store.patch({ activeProfileId: profileId });
    if (!this.client.connected) return OK;
    const heating = this.state.telemetry?.power ?? false;
    const mode = activeMode(profile);
    const first = await this.command({ op: 'setMode', mode: modeParamsFromConfig(mode), start: heating });
    if (!first.ok) return first;
    await this.command({ op: 'setLevel', level: profile.level }, true);
    await this.pushSchedule(true);
    return OK;
  }

  addProfile(name: string): ActionResult {
    const result = createProfile(name, this.state.profiles);
    if (!result.ok) return result;
    this.store.set((s) => ({ ...s, profiles: [...s.profiles, result.profile] }));
    return OK;
  }

  renameProfile(profileId: string, name: string): ActionResult {
    const error = validateProfileName(name, this.state.profiles, profileId);
    if (error) return { ok: false, error };
    const trimmed = name.trim();
    this.updateProfile(profileId, (p) => ({ ...p, name: trimmed, initials: initialsOf(trimmed) }));
    return OK;
  }

  async deleteProfile(profileId: string): Promise<ActionResult> {
    const profile = this.state.profiles.find((p) => p.id === profileId);
    if (!profile) return OK;
    if (profile.owner) return { ok: false, error: 'The owner profile stays with the hoodie.' };
    if (this.state.activeProfileId === profileId) {
      const owner = this.state.profiles.find((p) => p.owner);
      if (owner) await this.selectProfile(owner.id);
    }
    this.store.set((s) => ({ ...s, profiles: s.profiles.filter((p) => p.id !== profileId) }));
    return OK;
  }

  // ───────────────────────────── care and safety ─────────────────────────────

  setWashLock(on: boolean): Promise<ActionResult> {
    return this.command({ op: 'setWashLock', on });
  }

  toggleWashStep(index: number): void {
    this.store.set((s) => ({ ...s, washChecklist: s.washChecklist.map((done, i) => (i === index ? !done : done)) }));
  }

  /** Answer the overheat sheet. */
  async resolveOverheat(action: 'resume' | 'offToday'): Promise<ActionResult> {
    const alert = this.state.overheat;
    this.store.patch({ overheat: null });
    if (!alert || action === 'resume') return OK;
    const result = await this.command({ op: 'safetyAck', zone: alert.zone, action: 'lockoutToday' });
    if (result.ok) this.notify({ tone: 'info', title: `${ZONE_NAMES[alert.zone]} is off for today`, body: 'Switch it back on from Zones any time.' });
    return result;
  }

  clearFault(): Promise<ActionResult> {
    return this.command({ op: 'clearFault' });
  }

  // ───────────────────────────── firmware update ─────────────────────────────

  private setUpdate(stage: UpdateStage, fraction: number, extra: Partial<UpdateStatus> = {}): void {
    const current = this.state.update;
    const percent = updatePercent(stage, fraction);
    if (current.stage === stage && current.percent === percent && extra.error === undefined) return;
    this.store.patch({ update: { ...current, stage, percent, error: null, ...extra } });
  }

  resetUpdate(): void {
    const stage = this.state.update.stage;
    if (stage === 'done' || stage === 'failed' || stage === 'idle') {
      this.store.patch({ update: { stage: 'idle', percent: 0, error: null, targetVersion: null } });
    }
  }

  /** Download the newest firmware and install it on the hoodie. */
  async startUpdate(): Promise<ActionResult> {
    const busy: readonly UpdateStage[] = ['downloading', 'installing', 'verifying', 'restarting'];
    if (busy.includes(this.state.update.stage)) return { ok: false, error: 'An update is already running.' };
    const { release, blocker } = updateReadiness(this.state);
    if (!release) return { ok: false, error: 'The hoodie is up to date.' };
    if (blocker) {
      this.notify({ tone: 'warn', title: blocker, body: null });
      return { ok: false, error: blocker };
    }
    const fromVersion = this.state.hoodie?.version ?? '';
    const target = { targetVersion: release.version };
    try {
      this.setUpdate('downloading', 0, target);
      const image = await downloadFirmware(release.version, {
        sleep: this.sleep,
        stepMs: this.downloadStepMs,
        onProgress: (f) => this.setUpdate('downloading', f, target),
      });
      this.setUpdate('installing', 0, target);
      await transferFirmware(this.client, image, (f) => this.setUpdate('installing', f, target), {
        onVerifying: () => this.setUpdate('verifying', 0.5, target),
      });
      this.setUpdate('restarting', 0.2, target);
      await this.waitForVersion(release.version);
      this.setUpdate('done', 1, target);
      this.notify({ tone: 'good', title: `Firmware ${release.version} installed`, body: null });
      return OK;
    } catch (error) {
      let message = `The update stopped. The hoodie is still on ${fromVersion}.`;
      if (error instanceof CommandError) {
        if (error.code === AckCode.Checksum) message = 'The update did not arrive intact. Nothing was changed. Try again.';
        else if (error.code === AckCode.LowBattery) message = 'A cell needs at least 30% before updating.';
        else message = error.message;
      } else if (error instanceof TransportError) {
        message = `The hoodie disconnected during the update. It is still on ${fromVersion}.`;
      } else if (error instanceof Error && error.message === 'reboot-timeout') {
        message = 'The hoodie did not come back after restarting. Check that a cell is in, then reopen the app.';
      }
      this.store.patch({ update: { stage: 'failed', percent: 0, error: message, targetVersion: release.version } });
      return { ok: false, error: message };
    }
  }

  /** Wait until the hoodie has restarted, reconnected and reports a version. */
  private async waitForVersion(version: string): Promise<void> {
    const deadline = this.now() + this.rebootTimeoutMs;
    let polls = 0;
    for (;;) {
      const s = this.state;
      if (s.link === 'connected' && s.hoodie?.version === version) return;
      if (this.now() > deadline) throw new Error('reboot-timeout');
      polls += 1;
      this.setUpdate('restarting', Math.min(0.9, 0.2 + polls * 0.04), { targetVersion: version });
      await this.sleep(200);
    }
  }

  // ───────────────────────────── shop ─────────────────────────────

  addToBag(config: Configuration): void {
    this.store.set((s) => ({ ...s, bag: addToBag(s.bag, config) }));
  }

  setBagQuantity(lineId: string, quantity: number): void {
    this.store.set((s) => ({ ...s, bag: setQuantity(s.bag, lineId, quantity) }));
  }

  removeBagLine(lineId: string): void {
    this.store.set((s) => ({ ...s, bag: removeLine(s.bag, lineId) }));
  }

  // ───────────────────────────── history ─────────────────────────────

  /** Drop the built-in sample fortnight and keep only what was really recorded. */
  clearHistory(): void {
    this.store.patch({ history: { days: [], sample: false } });
  }

  // ───────────────────────────── from the hoodie ─────────────────────────────

  private onTelemetry(t: Telemetry): void {
    const s = this.state;
    const patch: Partial<AppState> = { telemetry: t };

    const dtS = this.lastUptimeS === null ? 0 : t.uptimeS - this.lastUptimeS;
    this.lastUptimeS = t.uptimeS;
    const profile = activeProfile(s);
    const mode = findModeBySlot(profile.modes, t.modeSlot);

    // Nothing is recorded until setup is finished, so the first thing in the
    // history is the wearer's own use and not the minute spent pairing.
    if (s.onboarded && dtS > 0 && dtS <= 900 && t.heating) {
      const tz = this.tzOffsetMin();
      patch.history = recordSample(s.history, {
        day: localDayNumber(t.rtcEpochS, tz),
        secondOfDay: localSecondOfDay(t.rtcEpochS, tz),
        dtS,
        heating: true,
        modeId: mode?.id ?? profile.activeModeId,
        level: t.effectiveLevel,
        skinC: t.skinC,
      });
    }

    // The hoodie can change mode or level by itself (the schedule, the hem
    // button), so the profile follows what it reports.
    if ((mode && mode.id !== profile.activeModeId) || t.level !== profile.level) {
      patch.profiles = s.profiles.map((p) =>
        p.id === profile.id ? { ...p, activeModeId: mode?.id ?? p.activeModeId, level: t.level } : p,
      );
    }

    if (s.overheat && !s.overheat.cleared && t.zoneSafety[s.overheat.zone] === 'ok') {
      patch.overheat = { ...s.overheat, cleared: true };
    }
    const fault = t.fault !== FAULT_NONE ? t.fault : null;
    if (fault !== s.fault) patch.fault = fault;

    const maxDuty = Math.max(...ZONE_IDS.map((zone) => t.duty[zone]));
    const saturated = t.power && !t.fading && maxDuty >= 0.98 && t.skinC < t.targetC - 0.25;
    const saturatedSinceS = saturated ? (s.saturatedSinceS ?? t.uptimeS) : null;
    if (saturatedSinceS !== s.saturatedSinceS) patch.saturatedSinceS = saturatedSinceS;

    this.store.patch(patch);
  }

  private onEvent(event: DeviceEvent): void {
    const s = this.state;
    if (event.type === 'overheatTrip') {
      this.store.patch({ overheat: { zone: event.zone, peakC: event.peakC, cleared: false } });
      return;
    }
    if (event.type === 'fault') {
      this.store.patch({ fault: event.code === FAULT_NONE ? null : event.code });
      return;
    }
    if (event.type === 'rebooted') {
      if (s.hoodie) this.store.patch({ hoodie: { ...s.hoodie, version: formatVersion(event.version) } });
      return;
    }
    if (event.type === 'overheatClear' && s.overheat?.zone === event.zone) {
      // The sheet is on screen and already says so.
      this.store.patch({ overheat: { ...s.overheat, cleared: true } });
      return;
    }
    if (!s.settings.notifications) return;
    const t = s.telemetry;
    let cellsSeated = t ? CELL_IDS.filter((id) => t.cells[id].present).length : 0;
    if (event.type === 'cellRemoved' && t?.cells[event.cell].present) cellsSeated -= 1;
    const notice = noticeForEvent(event, {
      unit: s.settings.unit,
      modeName: currentMode(s).name,
      cellsSeated,
    });
    if (notice) this.notify(notice);
  }

  /** A copy of a mode from the active profile, safe to edit in a form. */
  draftMode(modeId: string): ModeConfig | null {
    const mode = findMode(activeProfile(this.state).modes, modeId);
    return mode ? cloneMode(mode) : null;
  }
}
