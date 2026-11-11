/**
 * Read-only views over the app state.
 *
 * Screens ask these questions instead of digging through telemetry, so the
 * wording of a status line or a zone reading is decided in exactly one place.
 */
import { CELL_EMPTY_SOC } from '../battery/cell';
import { availableUpdate, type FirmwareRelease } from '../firmware/releases';
import { findMode, findModeBySlot, type ModeConfig } from '../modes';
import { activeMode, type Profile } from '../profiles';
import type { Telemetry } from '../protocol/telemetry';
import { FIRMWARE_MIN_CELL_FRACTION } from '../spec';
import { FAULT_NONE } from '../thermal/safety';
import { CELL_IDS, LEVEL_NAMES, ZONE_IDS, parseVersion, type Level, type ZoneId } from '../types';
import { cToF, formatDuration, formatPanelTemp, formatTargetWithUnit } from '../units';
import type { AppState } from './state';

export function activeProfile(state: AppState): Profile {
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
  if (!profile) throw new Error('No profiles');
  return profile;
}

/** The mode the hoodie is running, as the active profile knows it. */
export function currentMode(state: AppState): ModeConfig {
  const profile = activeProfile(state);
  const bySlot = state.telemetry ? findModeBySlot(profile.modes, state.telemetry.modeSlot) : undefined;
  return bySlot ?? activeMode(profile);
}

export function modeById(state: AppState, id: string): ModeConfig | undefined {
  return findMode(activeProfile(state).modes, id);
}

export function isConnected(state: AppState): boolean {
  return state.link === 'connected' && state.telemetry !== null;
}

/** Minutes to add to UTC to get this device's local time. */
export function localTzOffsetMin(at: Date = new Date()): number {
  return -at.getTimezoneOffset();
}

/** The hoodie's clock when connected, otherwise the phone's. Epoch seconds. */
export function nowEpochS(state: AppState, phoneNowMs: number = Date.now()): number {
  return state.telemetry && state.link === 'connected' ? state.telemetry.rtcEpochS : Math.floor(phoneNowMs / 1000);
}

/** Combined charge of the seated cells, 0 to 1, or null with none seated. */
export function combinedCharge(telemetry: Telemetry | null): number | null {
  if (!telemetry) return null;
  const seated = CELL_IDS.filter((id) => telemetry.cells[id].present);
  if (seated.length === 0) return null;
  return seated.reduce((sum, id) => sum + telemetry.cells[id].soc, 0) / seated.length;
}

export function hasUsableCell(telemetry: Telemetry): boolean {
  return CELL_IDS.some((id) => telemetry.cells[id].present && telemetry.cells[id].soc > CELL_EMPTY_SOC);
}

export type StatusTone = 'hot' | 'muted' | 'warn';

export interface HomeStatus {
  line: string;
  tone: StatusTone;
  /** A second, quieter line, or null. */
  hint: string | null;
}

const SATURATION_HINT_AFTER_S = 5 * 60;

export function homeStatus(state: AppState): HomeStatus {
  const t = state.telemetry;
  if (!state.hoodie) return { line: 'No hoodie paired', tone: 'muted', hint: null };
  if (state.link === 'reconnecting') return { line: 'Reconnecting', tone: 'muted', hint: 'Check that a cell is snapped in.' };
  if (state.link !== 'connected' || !t) return { line: 'Connecting', tone: 'muted', hint: null };
  if (state.update.stage !== 'idle' && state.update.stage !== 'done' && state.update.stage !== 'failed') {
    return { line: 'Updating firmware', tone: 'muted', hint: 'Heating is paused until it finishes.' };
  }
  if (t.fault !== FAULT_NONE) return { line: 'Heating disabled', tone: 'warn', hint: 'A safety fault needs clearing.' };
  if (t.washLock) return { line: 'Wash mode', tone: 'muted', hint: 'Heating is locked.' };
  if (!hasUsableCell(t)) return { line: 'Cells empty', tone: 'warn', hint: 'Snap in a charged cell.' };
  if (!t.power) return { line: 'Heating off', tone: 'muted', hint: null };

  const mode = currentMode(state);
  const unit = state.settings.unit;
  const enabled = ZONE_IDS.filter((zone) => t.zonesEnabled[zone]);
  if (enabled.length === 0) return { line: `${mode.name} · No zones on`, tone: 'muted', hint: 'Switch a zone on to heat.' };
  if (enabled.every((zone) => t.zoneSafety[zone] !== 'ok')) {
    return { line: 'Heat paused', tone: 'warn', hint: 'Cooling down. It resumes on its own.' };
  }

  const offIn = t.autoOffRemainingMin !== null ? `Off in ${formatDuration(t.autoOffRemainingMin)}` : null;
  if (t.fading) return { line: `${mode.name} · Fading out`, tone: 'hot', hint: offIn };
  if (t.preheating) return { line: `${mode.name} · Preheating`, tone: 'hot', hint: 'Warm by the time you leave.' };
  if (t.eased) return { line: `${mode.name} · Eased to Low`, tone: 'hot', hint: 'You have been still indoors.' };

  let hint = offIn;
  if (state.saturatedSinceS !== null && t.uptimeS - state.saturatedSinceS >= SATURATION_HINT_AFTER_S) {
    const target = formatTargetWithUnit(Math.round(cToF(t.targetC)), unit);
    const next = LEVEL_NAMES[(t.level + 1) as Level];
    hint = t.level < 2 && next ? `At ${LEVEL_NAMES[t.level]}'s limit. ${next} gets closer to ${target}.` : `At full power. ${target} is out of reach here.`;
  }
  return { line: `${mode.name} · ${LEVEL_NAMES[t.level]}`, tone: 'hot', hint };
}

/** The line under a zone's name on the Zones tab. */
export function zoneReading(state: AppState, zone: ZoneId): string {
  const t = state.telemetry;
  if (!t || state.link !== 'connected') return 'Not connected';
  const temp = formatPanelTemp(t.panelC[zone], state.settings.unit);
  if (t.zoneSafety[zone] === 'lockout') return 'Off for today';
  if (t.zoneSafety[zone] === 'cutoff') return `Cooling down · ${temp}`;
  if (!t.zonesEnabled[zone]) return 'Off';
  if (!t.power) return `Standing by · ${temp}`;
  return `Panel at ${temp}`;
}

/** The Runtime card on Home. An em dash when nothing is heating. */
export function runtimeLabel(state: AppState): string {
  const t = state.telemetry;
  if (!t || state.link !== 'connected' || !t.power || t.runtimeMin === null) return '—';
  return formatDuration(t.runtimeMin);
}

export interface UpdateReadiness {
  release: FirmwareRelease | null;
  /** Why an update cannot start, or null when it can. */
  blocker: string | null;
}

export function updateReadiness(state: AppState): UpdateReadiness {
  if (!state.hoodie) return { release: null, blocker: 'Pair a hoodie first.' };
  let release: FirmwareRelease | null = null;
  try {
    release = availableUpdate(parseVersion(state.hoodie.version));
  } catch {
    release = null;
  }
  if (!release) return { release: null, blocker: null };
  const t = state.telemetry;
  if (!t || state.link !== 'connected') return { release, blocker: 'Connect to the hoodie to install.' };
  const charged = CELL_IDS.some((id) => t.cells[id].present && t.cells[id].soc >= FIRMWARE_MIN_CELL_FRACTION);
  if (!charged) {
    return { release, blocker: `One cell needs at least ${Math.round(FIRMWARE_MIN_CELL_FRACTION * 100)}% to install.` };
  }
  return { release, blocker: null };
}
