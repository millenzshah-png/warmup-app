/**
 * The shape of the app's state.
 *
 * It has two halves. The persisted half survives a restart: who is set up,
 * their modes, the schedule, history. The volatile half is whatever the
 * hoodie is saying right now, and is rebuilt every time the app connects.
 */
import { emptyHistory, type History } from '../insights/history';
import { defaultModes, normalizeMode, type ModeConfig } from '../modes';
import { seedProfiles, type Profile } from '../profiles';
import type { Advertisement, CellInfo } from '../protocol/info';
import type { Telemetry } from '../protocol/telemetry';
import { defaultSchedule, type Days, type Schedule } from '../schedule/schedule';
import type { BagLine } from '../shop/bag';
import type { FaultCode } from '../thermal/safety';
import { HOODIE_SIZES, isLevel, type CellMap, type HoodieSize, type TempUnit, type ZoneId } from '../types';
import type { UpdateStage } from '../device/updater';

export const APP_SCHEMA = 1;
export const APP_STORAGE_KEY = 'warmup.app.v1';

export interface Settings {
  unit: TempUnit;
  notifications: boolean;
  autoOffWhenStill: boolean;
  buttonHaptics: boolean;
}

/** What the app remembers about the hoodie it is paired with. */
export interface HoodieRecord {
  /** Transport id used to reconnect. */
  id: string;
  serial: string;
  name: string;
  size: HoodieSize;
  /** Firmware version text, "1.2.0". */
  version: string;
  cells: CellMap<CellInfo>;
}

export const WASH_STEP_COUNT = 4;

export interface PersistedState {
  /** The wearer has been through setup. */
  onboarded: boolean;
  hoodie: HoodieRecord | null;
  settings: Settings;
  profiles: Profile[];
  activeProfileId: string;
  schedule: Schedule;
  washChecklist: boolean[];
  history: History;
  bag: BagLine[];
}

export type LinkStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';

export interface OverheatAlert {
  zone: ZoneId;
  /** The reading that tripped the cutoff, °C. */
  peakC: number;
  /** True once the panel has cooled and heat has resumed. */
  cleared: boolean;
}

export type ToastTone = 'info' | 'good' | 'warn';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body: string | null;
}

export interface UpdateStatus {
  stage: UpdateStage;
  percent: number;
  error: string | null;
  targetVersion: string | null;
}

export interface VolatileState {
  link: LinkStatus;
  /** Hoodies seen by the last scan. */
  found: Advertisement[];
  scanMessage: string | null;
  telemetry: Telemetry | null;
  overheat: OverheatAlert | null;
  fault: FaultCode | null;
  toasts: Toast[];
  update: UpdateStatus;
  /** Hoodie uptime when the panels began running flat out short of the target. */
  saturatedSinceS: number | null;
}

export type AppState = PersistedState & VolatileState;

export function defaultSettings(): Settings {
  return { unit: 'F', notifications: true, autoOffWhenStill: true, buttonHaptics: false };
}

export function defaultPersistedState(): PersistedState {
  const profiles = seedProfiles();
  return {
    onboarded: false,
    hoodie: null,
    settings: defaultSettings(),
    profiles,
    activeProfileId: profiles[0]?.id ?? 'p-owner',
    schedule: defaultSchedule(),
    washChecklist: new Array<boolean>(WASH_STEP_COUNT).fill(false),
    history: emptyHistory(),
    bag: [],
  };
}

export function defaultVolatileState(): VolatileState {
  return {
    link: 'idle',
    found: [],
    scanMessage: null,
    telemetry: null,
    overheat: null,
    fault: null,
    toasts: [],
    update: { stage: 'idle', percent: 0, error: null, targetVersion: null },
    saturatedSinceS: null,
  };
}

export function initialAppState(persisted: PersistedState = defaultPersistedState()): AppState {
  return { ...persisted, ...defaultVolatileState() };
}

export function selectPersisted(state: AppState): PersistedState {
  return {
    onboarded: state.onboarded,
    hoodie: state.hoodie,
    settings: state.settings,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    schedule: state.schedule,
    washChecklist: state.washChecklist,
    history: state.history,
    bag: state.bag,
  };
}

const PERSISTED_KEYS: readonly (keyof PersistedState)[] = [
  'onboarded',
  'hoodie',
  'settings',
  'profiles',
  'activeProfileId',
  'schedule',
  'washChecklist',
  'history',
  'bag',
];

/** True when any persisted field is a different object than before. */
export function persistedChanged(a: AppState, b: AppState): boolean {
  return PERSISTED_KEYS.some((key) => a[key] !== b[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  const { id, name, initials, modes, activeModeId, level } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(modes) || modes.length === 0) return null;
  const cleanModes: ModeConfig[] = [];
  for (const mode of modes) {
    if (!isRecord(mode) || typeof mode.id !== 'string' || typeof mode.targetF !== 'number' || !isRecord(mode.zones)) return null;
    cleanModes.push(normalizeMode(mode as unknown as ModeConfig));
  }
  // A built-in that a newer app version added is filled in from the defaults.
  for (const builtIn of defaultModes()) {
    if (!cleanModes.some((m) => m.id === builtIn.id)) cleanModes.push(builtIn);
  }
  return {
    id,
    name,
    initials: typeof initials === 'string' ? initials : name.slice(0, 2).toUpperCase(),
    owner: value.owner === true,
    tagline: typeof value.tagline === 'string' ? value.tagline : null,
    modes: cleanModes,
    activeModeId: typeof activeModeId === 'string' && cleanModes.some((m) => m.id === activeModeId) ? activeModeId : 'auto',
    level: typeof level === 'number' && isLevel(level) ? level : 1,
  };
}

/**
 * Check data read from storage and fill any gaps from the defaults. Returns
 * null when it is too damaged to trust, in which case the app starts fresh.
 */
export function validatePersisted(data: unknown): PersistedState | null {
  if (!isRecord(data)) return null;
  const defaults = defaultPersistedState();

  const profiles: Profile[] = [];
  if (Array.isArray(data.profiles)) {
    for (const raw of data.profiles) {
      const profile = validProfile(raw);
      if (!profile) return null;
      profiles.push(profile);
    }
  }
  if (profiles.length === 0) profiles.push(...defaults.profiles);
  if (!profiles.some((p) => p.owner)) {
    const first = profiles[0];
    if (first) first.owner = true;
  }
  const activeProfileId =
    typeof data.activeProfileId === 'string' && profiles.some((p) => p.id === data.activeProfileId)
      ? data.activeProfileId
      : (profiles[0]?.id ?? defaults.activeProfileId);

  const settingsIn = isRecord(data.settings) ? data.settings : {};
  const settings: Settings = {
    unit: settingsIn.unit === 'C' ? 'C' : 'F',
    notifications: settingsIn.notifications !== false,
    autoOffWhenStill: settingsIn.autoOffWhenStill !== false,
    buttonHaptics: settingsIn.buttonHaptics === true,
  };

  let hoodie: HoodieRecord | null = null;
  if (isRecord(data.hoodie) && typeof data.hoodie.id === 'string' && typeof data.hoodie.name === 'string') {
    const h = data.hoodie;
    const cells = isRecord(h.cells) ? (h.cells as unknown as CellMap<CellInfo>) : null;
    hoodie = {
      id: h.id as string,
      serial: typeof h.serial === 'string' ? h.serial : (h.id as string),
      name: h.name as string,
      size: HOODIE_SIZES.includes(h.size as HoodieSize) ? (h.size as HoodieSize) : 'M',
      version: typeof h.version === 'string' ? h.version : '1.2.0',
      cells: cells ?? { left: { cycles: 0, health: 1 }, right: { cycles: 0, health: 1 } },
    };
  }

  let schedule = defaults.schedule;
  if (isRecord(data.schedule)) {
    const s = data.schedule;
    const days = Array.isArray(s.days) && s.days.length === 7 ? (s.days.map(Boolean) as Days) : defaults.schedule.days;
    const minute = typeof s.minuteOfDay === 'number' ? Math.round(s.minuteOfDay) : defaults.schedule.minuteOfDay;
    schedule = {
      enabled: s.enabled === true,
      minuteOfDay: minute >= 0 && minute < 1440 ? minute : defaults.schedule.minuteOfDay,
      days,
      preheatMin: typeof s.preheatMin === 'number' && s.preheatMin >= 1 && s.preheatMin <= 60 ? s.preheatMin : 10,
      modeId: typeof s.modeId === 'string' ? s.modeId : 'commute',
    };
  }

  const washChecklist =
    Array.isArray(data.washChecklist) && data.washChecklist.length === WASH_STEP_COUNT
      ? data.washChecklist.map(Boolean)
      : defaults.washChecklist;

  let history = defaults.history;
  if (isRecord(data.history) && Array.isArray(data.history.days)) {
    const days = data.history.days.filter(
      (d): d is History['days'][number] =>
        isRecord(d) && typeof d.day === 'number' && typeof d.heatS === 'number' && isRecord(d.modeS) && Array.isArray(d.levelS),
    );
    history = { days, sample: data.history.sample === true };
  }

  const bag: BagLine[] = Array.isArray(data.bag)
    ? data.bag.filter((line): line is BagLine => isRecord(line) && typeof line.id === 'string' && isRecord(line.config) && typeof line.quantity === 'number')
    : [];

  return {
    onboarded: data.onboarded === true,
    hoodie,
    settings,
    profiles,
    activeProfileId,
    schedule,
    washChecklist,
    history,
    bag,
  };
}
