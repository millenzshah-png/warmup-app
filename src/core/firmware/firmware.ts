/**
 * The firmware that runs on the hem controller.
 *
 * This is a faithful model of the controller's logic, written as a plain
 * class with no timers and no I/O so it can be stepped deterministically in
 * tests. The simulator wraps it with a clock and a wire. A real controller
 * would implement the same rules in C, and docs/PROTOCOL.md is its contract.
 *
 * One tick does, in order:
 *   1. read sensors and run the safety state machines
 *   2. run the schedule, auto-off timers and mode rules
 *   3. run the heat controller and decide each panel's power
 *   4. draw that power from the cells
 *   5. advance the thermal model (the simulated garment and wearer)
 */
import { CELL_EMPTY_SOC, loadedVoltage, newCell, type CellState } from '../battery/cell';
import {
  chargeDockedCells,
  dockCell,
  drawFromPack,
  insertCell,
  packFraction,
  removeCell,
  supplyingCells,
  type PackState,
} from '../battery/pack';
import { levelRuntimeMin } from '../battery/runtime';
import { builtInMode } from '../modes';
import {
  AckCode,
  modeParamsFromConfig,
  type AckCodeValue,
  type Command,
  type DeviceSchedule,
  type ModeParams,
} from '../protocol/commands';
import { CRC32_INIT, crc32Finish, crc32Update } from '../protocol/crc';
import type { DeviceEvent } from '../protocol/events';
import type { Advertisement, DeviceInfo } from '../protocol/info';
import type { Telemetry } from '../protocol/telemetry';
import {
  CRITICAL_BATTERY_FRACTION,
  EASE_INDOORS_AFTER_S,
  ELECTRONICS_OVERHEAD_W,
  FIRMWARE_FACTORY_VERSION,
  FIRMWARE_MIN_CELL_FRACTION,
  LOW_BATTERY_FRACTION,
  LOW_BATTERY_REARM_FRACTION,
  OUTDOOR_BOOST_F,
  STILL_AUTO_OFF_S,
  TARGET_MAX_F,
  TARGET_MIN_F,
  levelZonePowerW,
} from '../spec';
import {
  heaterIsOn,
  initialControllerState,
  stepController,
  type ControllerState,
} from '../thermal/controller';
import {
  DEFAULT_THERMAL_PARAMS,
  initialThermalState,
  panelTemps,
  restingSkinC,
  stepThermal,
  type ThermalParams,
  type ThermalState,
} from '../thermal/model';
import {
  FAULT_NONE,
  clearFault,
  clearLockout,
  initialSafetyState,
  lockoutZone,
  stepSafety,
  zoneMayHeat,
  type SafetyState,
} from '../thermal/safety';
import {
  CELL_IDS,
  ZONE_IDS,
  cellMap,
  countZones,
  parseVersion,
  zoneMap,
  type CellId,
  type HoodieSize,
  type Level,
  type Version,
  type ZoneMap,
} from '../types';
import { cToF, clamp, fToC, lerp } from '../units';
import { featuresFor, type FirmwareFeatures } from './releases';

/** The physical surroundings. Only the simulation knows these directly. */
export interface World {
  /** Indoor air temperature, °C. */
  roomC: number;
  /** Outdoor air temperature, °C. */
  outdoorC: number;
  /** Whether the wearer is outside right now. */
  outdoors: boolean;
  /** Whether the wearer is moving about. */
  moving: boolean;
  /** Panels currently pressed against the body by a backpack or a chair. */
  covered: ZoneMap<boolean>;
  /** Simulates a broken collar sensor. */
  sensorFault: boolean;
}

export function defaultWorld(): World {
  return {
    roomC: 19,
    outdoorC: fToC(45),
    outdoors: false,
    moving: true,
    covered: zoneMap(() => false),
    sensorFault: false,
  };
}

/** Air temperature around the wearer. */
export function ambientC(world: World): number {
  return world.outdoors ? world.outdoorC : world.roomC;
}

/** What the phone has told the hoodie about where the wearer is. */
export interface PhoneContext {
  /** False until the phone has sent a context at least once. */
  valid: boolean;
  outdoors: boolean;
  moving: boolean;
  outdoorC: number;
}

export interface OtaSession {
  size: number;
  crc32: number;
  version: Version;
  received: number;
  running: number;
}

export interface FirmwarePrefs {
  autoOffWhenStill: boolean;
  buttonHaptics: boolean;
}

export const FIRMWARE_STATE_SCHEMA = 1;

/** Everything the controller remembers. Plain data, safe to serialise. */
export interface FirmwareState {
  schema: number;
  version: Version;
  hardwareRev: number;
  serial: string;
  name: string;
  size: HoodieSize;

  /** Whether the controller has power from at least one cell. */
  awake: boolean;
  uptimeS: number;
  rtcEpochS: number;
  /** Minutes to add to UTC to get the wearer's local time. */
  tzOffsetMin: number;

  /** The wearer wants heat. */
  power: boolean;
  level: Level;
  mode: ModeParams;
  zonesEnabled: ZoneMap<boolean>;
  washLock: boolean;
  prefs: FirmwarePrefs;

  context: PhoneContext;
  /** Seconds the wearer has been still, according to the phone. */
  stillS: number;
  /** Seconds since the current mode started heating. */
  modeElapsedS: number;
  eased: boolean;
  /** Firmware 1.2.0 leaves the back panel on after a Sleep fade. */
  sleepHangover: boolean;

  schedule: DeviceSchedule | null;
  /** Local day number of the last departure the schedule preheated for. */
  lastScheduleDay: number | null;
  preheating: boolean;
  /** Local time, in seconds, at which the current preheat counts as done. */
  preheatEndsLocalS: number;

  thermal: ThermalState;
  controller: ControllerState;
  safety: SafetyState;
  pack: PackState;

  lowBatteryWarned: boolean;
  criticalShutdown: boolean;
  /** Smoothed pack draw, W. */
  drawEmaW: number;
  /** Seconds since any panel last drew power. */
  coolS: number;
  /** Learned resting skin temperature, °C. */
  learnedRestC: number;

  ota: OtaSession | null;
  pendingVersion: Version | null;
  rebootRemainingS: number;
}

/** Values recomputed every tick and reported in telemetry. Not persisted. */
interface LiveOutputs {
  zonePowerW: ZoneMap<number>;
  zoneDuty: ZoneMap<number>;
  panelC: ZoneMap<number>;
  targetC: number;
  effectiveLevel: Level;
  fading: boolean;
}

export interface FirmwareCreateOptions {
  version?: string;
  name?: string;
  size?: HoodieSize;
  serial?: string;
  epochS?: number;
  tzOffsetMin?: number;
  cells?: Partial<Record<CellId, Partial<CellState>>>;
  world?: Partial<World>;
  thermalParams?: ThermalParams;
}

const REBOOT_SECONDS = 3;
const DRAW_EMA_TAU_S = 45;
const REST_LEARN_AFTER_COOL_S = 600;
const MAX_QUEUED_EVENTS = 32;
const MAX_OTA_IMAGE_BYTES = 2 * 1024 * 1024;
/** Power the back panel keeps drawing in the 1.2.0 Sleep bug, as a duty at Low. */
const SLEEP_HANGOVER_DUTY = 0.15;

export class Firmware {
  state: FirmwareState;
  world: World;
  readonly thermalParams: ThermalParams;
  private events: DeviceEvent[] = [];
  private live: LiveOutputs;

  constructor(state: FirmwareState, world: World = defaultWorld(), thermalParams: ThermalParams = DEFAULT_THERMAL_PARAMS) {
    this.state = state;
    this.world = world;
    this.thermalParams = thermalParams;
    this.live = this.idleOutputs();
  }

  /** A hoodie straight out of the box: cells charged, heating off. */
  static create(options: FirmwareCreateOptions = {}): Firmware {
    const world: World = { ...defaultWorld(), ...options.world };
    const params = options.thermalParams ?? DEFAULT_THERMAL_PARAMS;
    const air = ambientC(world);
    const pack: PackState = cellMap((id) => newCell(options.cells?.[id]));
    const state: FirmwareState = {
      schema: FIRMWARE_STATE_SCHEMA,
      version: parseVersion(options.version ?? FIRMWARE_FACTORY_VERSION),
      hardwareRev: 2,
      serial: options.serial ?? 'WU26M00417',
      name: options.name ?? 'Warmup Hoodie',
      size: options.size ?? 'M',
      awake: true,
      uptimeS: 0,
      rtcEpochS: options.epochS ?? 0,
      tzOffsetMin: options.tzOffsetMin ?? 0,
      power: false,
      level: 1,
      mode: modeParamsFromConfig(builtInMode('auto')),
      zonesEnabled: zoneMap(() => true),
      washLock: false,
      prefs: { autoOffWhenStill: true, buttonHaptics: false },
      context: { valid: false, outdoors: false, moving: true, outdoorC: world.outdoorC },
      stillS: 0,
      modeElapsedS: 0,
      eased: false,
      sleepHangover: false,
      schedule: null,
      lastScheduleDay: null,
      preheating: false,
      preheatEndsLocalS: 0,
      thermal: initialThermalState(air, params),
      controller: initialControllerState(),
      safety: initialSafetyState(),
      pack,
      lowBatteryWarned: false,
      criticalShutdown: false,
      drawEmaW: 0,
      coolS: REST_LEARN_AFTER_COOL_S,
      learnedRestC: restingSkinC(air, params),
      ota: null,
      pendingVersion: null,
      rebootRemainingS: 0,
    };
    return new Firmware(state, world, params);
  }

  /**
   * A hoodie that has been worn in Auto at Medium for a while, with cells at
   * 82 % and 74 %. This is the state a demo starts in, so the first screen
   * shows a settled reading instead of a cold start.
   */
  static createWorn(options: FirmwareCreateOptions = {}): Firmware {
    const cells = {
      left: { soc: 0.82, health: 0.982, cycles: 41, ...options.cells?.left },
      right: { soc: 0.74, health: 0.987, cycles: 38, ...options.cells?.right },
    };
    const fw = Firmware.create({ ...options, cells });
    fw.state.power = true;
    const epochS = fw.state.rtcEpochS;
    for (let i = 0; i < 30 * 60; i += 1) fw.step(1);
    // Warming up should not have cost anything the demo can see.
    fw.state.pack = cellMap((id) => ({ ...fw.state.pack[id], ...cells[id] }));
    fw.state.rtcEpochS = epochS;
    fw.state.uptimeS = 0;
    fw.state.modeElapsedS = 0;
    fw.state.lowBatteryWarned = false;
    fw.events = [];
    return fw;
  }

  /** Rebuild a controller from a saved snapshot. Returns null if it is unusable. */
  static restore(snapshot: unknown, world?: World, thermalParams?: ThermalParams): Firmware | null {
    if (typeof snapshot !== 'object' || snapshot === null) return null;
    const state = snapshot as Partial<FirmwareState>;
    if (state.schema !== FIRMWARE_STATE_SCHEMA) return null;
    if (!state.version || !state.thermal || !state.pack || !state.mode || !state.safety || !state.controller) return null;
    return new Firmware(state as FirmwareState, world ?? defaultWorld(), thermalParams ?? DEFAULT_THERMAL_PARAMS);
  }

  /** A deep copy of the controller's memory, suitable for JSON. */
  snapshot(): FirmwareState {
    return JSON.parse(JSON.stringify(this.state)) as FirmwareState;
  }

  get features(): FirmwareFeatures {
    return featuresFor(this.state.version);
  }

  /** True while at least one seated cell can power the controller. */
  hasPower(): boolean {
    return CELL_IDS.some((id) => this.state.pack[id].present && this.state.pack[id].soc > CELL_EMPTY_SOC);
  }

  /** True while the radio is up: powered and not restarting. */
  isLinkUp(): boolean {
    return this.state.awake && this.state.rebootRemainingS <= 0;
  }

  // ───────────────────────────── time helpers ─────────────────────────────

  private localSeconds(): number {
    return this.state.rtcEpochS + this.state.tzOffsetMin * 60;
  }

  private nextMidnightEpochS(): number {
    const local = this.localSeconds();
    return (Math.floor(local / 86400) + 1) * 86400 - this.state.tzOffsetMin * 60;
  }

  // ───────────────────────────── events ─────────────────────────────

  private emit(event: DeviceEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_QUEUED_EVENTS) this.events.shift();
  }

  /** Hand over everything that happened since the last call. */
  takeEvents(): DeviceEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ───────────────────────────── the tick ─────────────────────────────

  /** Advance the controller and its surroundings by dt seconds (at most a few). */
  step(dtS: number): void {
    if (!(dtS > 0)) return;
    const s = this.state;
    s.rtcEpochS += dtS;

    const hasPower = this.hasPower();
    if (!hasPower) {
      if (s.awake) this.losePower();
      this.coast(dtS);
      return;
    }
    if (!s.awake) {
      s.awake = true;
      s.uptimeS = 0;
    }

    if (s.rebootRemainingS > 0) {
      s.rebootRemainingS -= dtS;
      this.coast(dtS);
      if (s.rebootRemainingS <= 0) {
        s.rebootRemainingS = 0;
        if (s.pendingVersion) {
          s.version = s.pendingVersion;
          s.pendingVersion = null;
        }
        s.uptimeS = 0;
        this.emit({ type: 'rebooted', version: s.version });
      }
      return;
    }

    s.uptimeS += dtS;
    if (s.context.valid && !s.context.moving) s.stillS += dtS;
    else s.stillS = 0;

    // 1. Sensors and safety come first, so nothing below can outvote them.
    const air = ambientC(this.world);
    const panelC = panelTemps(s.thermal, air, this.thermalParams);
    const skinReading = this.world.sensorFault ? Number.NaN : s.thermal.skinC;
    const safety = stepSafety(
      s.safety,
      { panelC, skinC: skinReading },
      { uptimeS: s.uptimeS, epochS: s.rtcEpochS, nextMidnightEpochS: this.nextMidnightEpochS() },
    );
    s.safety = safety.state;
    for (const event of safety.events) {
      if (event.type === 'trip') this.emit({ type: 'overheatTrip', zone: event.zone, peakC: event.peakC });
      else if (event.type === 'clear') this.emit({ type: 'overheatClear', zone: event.zone, tempC: event.tempC });
      else if (event.type === 'lockout') this.emit({ type: 'zoneLockout', zone: event.zone });
      else if (event.type === 'lockout-expired') this.emit({ type: 'zoneLockoutEnded', zone: event.zone });
      else this.emit({ type: 'fault', code: event.code });
    }

    // 2. Schedule, timers and mode rules.
    this.runSchedule();
    if (s.power) s.modeElapsedS += dtS;
    this.runTimers();
    const plan = this.planHeat(skinReading);

    // 3. Heat controller and per-panel power. During an update the controller
    //    is held rather than reset, so heat picks up where it left off and
    //    the wearer does not cool down while it relearns its duty.
    if (!s.ota) {
      s.controller = stepController(
        s.controller,
        {
          enabled: plan.enabled && !s.sleepHangover,
          skinC: skinReading,
          targetC: plan.targetC,
          ramp: s.mode.ramp,
          pulse: s.mode.pulse,
          dutyCap: plan.dutyCap,
        },
        dtS,
      );
    }
    const energised = plan.enabled && !s.sleepHangover && heaterIsOn(s.controller);
    const levelPowerW = levelZonePowerW(plan.effectiveLevel);
    const zonePowerW = zoneMap(() => 0);
    const zoneDuty = zoneMap(() => 0);
    for (const zone of ZONE_IDS) {
      const allowed = plan.enabled && s.zonesEnabled[zone] && zoneMayHeat(s.safety, zone);
      if (!allowed) continue;
      if (s.sleepHangover) {
        if (zone === 'B') {
          zoneDuty.B = SLEEP_HANGOVER_DUTY;
          zonePowerW.B = SLEEP_HANGOVER_DUTY * levelZonePowerW(0);
        }
        continue;
      }
      zoneDuty[zone] = s.controller.duty;
      zonePowerW[zone] = energised ? levelPowerW : 0;
    }

    // 4. Cells.
    const heaterW = ZONE_IDS.reduce((sum, zone) => sum + zonePowerW[zone], 0);
    const draw = drawFromPack(s.pack, heaterW + ELECTRONICS_OVERHEAD_W, dtS, this.features.balanceStrategy);
    s.pack = chargeDockedCells(draw.pack, dtS);
    s.drawEmaW += (draw.deliveredW - s.drawEmaW) * (1 - Math.exp(-dtS / DRAW_EMA_TAU_S));
    this.watchBattery();

    // 5. The garment and the wearer.
    s.thermal = stepThermal(s.thermal, { ambientC: air, powerW: zonePowerW, covered: this.world.covered }, dtS, this.thermalParams);

    s.coolS = heaterW > 0 ? 0 : s.coolS + dtS;
    if (s.coolS >= REST_LEARN_AFTER_COOL_S && Number.isFinite(skinReading)) {
      const k = 1 - Math.exp(-dtS / this.features.restLearnTauS);
      s.learnedRestC += (skinReading - s.learnedRestC) * k;
    }

    this.live = {
      zonePowerW,
      zoneDuty,
      panelC: panelTemps(s.thermal, air, this.thermalParams),
      targetC: plan.targetC,
      effectiveLevel: plan.effectiveLevel,
      fading: plan.fading,
    };
  }

  /** The controller has just lost its last cell. */
  private losePower(): void {
    const s = this.state;
    s.awake = false;
    s.uptimeS = 0;
    s.ota = null;
    s.pendingVersion = null;
    s.rebootRemainingS = 0;
    s.controller = initialControllerState();
    this.switchOff();
    this.events = [];
  }

  /**
   * Let the garment cool and any docked cell charge while nothing is driven.
   * The controller's memory is left alone: a restart keeps it, and losing
   * power clears it separately.
   */
  private coast(dtS: number): void {
    const s = this.state;
    const air = ambientC(this.world);
    s.pack = chargeDockedCells(s.pack, dtS);
    s.thermal = stepThermal(
      s.thermal,
      { ambientC: air, powerW: zoneMap(() => 0), covered: this.world.covered },
      dtS,
      this.thermalParams,
    );
    s.drawEmaW *= Math.exp(-dtS / DRAW_EMA_TAU_S);
    s.coolS += dtS;
    this.live = { ...this.idleOutputs(), panelC: panelTemps(s.thermal, air, this.thermalParams) };
  }

  private idleOutputs(): LiveOutputs {
    const air = ambientC(this.world);
    return {
      zonePowerW: zoneMap(() => 0),
      zoneDuty: zoneMap(() => 0),
      panelC: panelTemps(this.state.thermal, air, this.thermalParams),
      targetC: fToC(this.state.mode.targetF),
      effectiveLevel: this.state.level,
      fading: false,
    };
  }

  private switchOff(): void {
    const s = this.state;
    s.power = false;
    s.preheating = false;
    s.sleepHangover = false;
    s.eased = false;
  }

  /** Why heating cannot start right now, or Ok when it can. */
  private startBlocker(): AckCodeValue {
    const s = this.state;
    if (s.washLock) return AckCode.Locked;
    if (s.safety.fault !== FAULT_NONE) return AckCode.Fault;
    if (supplyingCells(s.pack).length === 0) return AckCode.NoCells;
    if (s.criticalShutdown) return AckCode.LowBattery;
    return AckCode.Ok;
  }

  private runSchedule(): void {
    const s = this.state;
    const schedule = s.schedule;
    const localS = this.localSeconds();
    if (s.preheating && localS >= s.preheatEndsLocalS) s.preheating = false;
    if (!schedule || !schedule.enabled || s.ota) return;
    if (this.startBlocker() !== AckCode.Ok) return;

    const today = Math.floor(localS / 86400);
    // A departure just after midnight starts its preheat the evening before.
    for (const day of [today, today + 1]) {
      // Day 0 of the epoch was a Thursday, index 3 with Monday first.
      const weekday = (((day + 3) % 7) + 7) % 7;
      if (!schedule.days[weekday]) continue;
      const departS = day * 86400 + schedule.minuteOfDay * 60;
      const startS = departS - schedule.preheatMin * 60;
      if (localS < startS || localS >= departS || s.lastScheduleDay === day) continue;
      s.lastScheduleDay = day;
      s.mode = { ...schedule.mode, zones: { ...schedule.mode.zones } };
      s.level = schedule.level;
      s.zonesEnabled = { ...schedule.mode.zones };
      s.modeElapsedS = 0;
      s.power = true;
      s.sleepHangover = false;
      s.eased = false;
      s.preheating = true;
      s.preheatEndsLocalS = departS;
      this.emit({ type: 'scheduleStart', preheatMin: schedule.preheatMin });
      return;
    }
  }

  private runTimers(): void {
    const s = this.state;
    if (!s.power) return;
    const mode = s.mode;
    if (mode.autoOffMin !== null && !s.sleepHangover && s.modeElapsedS >= mode.autoOffMin * 60) {
      if (mode.fadeOutMin !== null) {
        this.emit({ type: 'autoOff', reason: 'fade' });
        if (this.features.sleepEndsCleanly) this.switchOff();
        else s.sleepHangover = true;
      } else {
        this.emit({ type: 'autoOff', reason: 'timer' });
        this.switchOff();
      }
    }
    // Modes with their own timer look after themselves. The stillness rule
    // covers the open-ended ones, and the 1.2.0 Sleep leftover.
    const openEnded = mode.autoOffMin === null || s.sleepHangover;
    if (s.power && openEnded && s.prefs.autoOffWhenStill && s.context.valid && !s.preheating && s.stillS >= STILL_AUTO_OFF_S) {
      this.emit({ type: 'autoOff', reason: 'still' });
      this.switchOff();
    }
  }

  /** Work out what the heat controller should aim for this tick. */
  private planHeat(skinReading: number): {
    enabled: boolean;
    targetC: number;
    dutyCap: number;
    effectiveLevel: Level;
    fading: boolean;
  } {
    const s = this.state;
    const mode = s.mode;
    const enabled =
      s.power &&
      !s.ota &&
      Number.isFinite(skinReading) &&
      this.startBlocker() === AckCode.Ok &&
      countZones(s.zonesEnabled) > 0;

    const eased = s.power && mode.easeIndoors && s.context.valid && !s.context.outdoors && s.stillS >= EASE_INDOORS_AFTER_S;
    if (eased !== s.eased) {
      s.eased = eased;
      this.emit({ type: 'eased', on: eased });
    }
    const effectiveLevel: Level = eased ? 0 : s.level;

    let targetF = mode.targetF;
    if (s.context.valid) {
      if (mode.tracksOutdoor) targetF -= clamp((cToF(s.context.outdoorC) - 40) / 7.5, 0, 4);
      if (mode.outdoorBoost && s.context.outdoors) targetF += OUTDOOR_BOOST_F;
    }
    let targetC = fToC(clamp(targetF, TARGET_MIN_F - 4, TARGET_MAX_F + OUTDOOR_BOOST_F));

    let dutyCap = 1;
    let fading = false;
    if (s.power && mode.fadeOutMin !== null && mode.autoOffMin !== null) {
      const fadeStartS = (mode.autoOffMin - mode.fadeOutMin) * 60;
      const progress = clamp((s.modeElapsedS - fadeStartS) / (mode.fadeOutMin * 60), 0, 1);
      if (progress > 0) {
        fading = true;
        targetC = lerp(targetC, Math.min(targetC, s.learnedRestC), progress);
        dutyCap = 1 - progress;
      }
    }
    return { enabled, targetC, dutyCap, effectiveLevel, fading };
  }

  private watchBattery(): void {
    const s = this.state;
    const fraction = packFraction(s.pack);
    if (!s.lowBatteryWarned && fraction < LOW_BATTERY_FRACTION) {
      s.lowBatteryWarned = true;
      this.emit({ type: 'lowBattery', percent: Math.round(fraction * 100) });
    } else if (s.lowBatteryWarned && fraction > LOW_BATTERY_REARM_FRACTION) {
      s.lowBatteryWarned = false;
    }
    if (!s.criticalShutdown && fraction < CRITICAL_BATTERY_FRACTION) {
      s.criticalShutdown = true;
      this.switchOff();
      this.emit({ type: 'criticalBattery' });
    } else if (s.criticalShutdown && fraction > LOW_BATTERY_REARM_FRACTION) {
      s.criticalShutdown = false;
    }
  }

  // ───────────────────────────── commands ─────────────────────────────

  /** Apply one command from the app and say how it went. */
  handle(cmd: Command): AckCodeValue {
    const s = this.state;
    if (!this.isLinkUp()) return AckCode.Busy;
    const allowedDuringOta = cmd.op.startsWith('ota') || cmd.op === 'syncTime' || cmd.op === 'setContext';
    if (s.ota && !allowedDuringOta) return AckCode.Busy;

    switch (cmd.op) {
      case 'setPower': {
        if (!cmd.on) {
          this.switchOff();
          return AckCode.Ok;
        }
        const blocker = this.startBlocker();
        if (blocker !== AckCode.Ok) return blocker;
        if (!s.power || s.sleepHangover) s.modeElapsedS = 0;
        s.power = true;
        s.sleepHangover = false;
        s.preheating = false;
        return AckCode.Ok;
      }
      case 'setLevel':
        s.level = cmd.level;
        s.sleepHangover = false;
        return AckCode.Ok;
      case 'setMode': {
        if (cmd.mode.targetF < TARGET_MIN_F || cmd.mode.targetF > TARGET_MAX_F) return AckCode.Invalid;
        s.mode = { ...cmd.mode, zones: { ...cmd.mode.zones } };
        s.zonesEnabled = { ...cmd.mode.zones };
        s.modeElapsedS = 0;
        s.sleepHangover = false;
        s.preheating = false;
        if (!cmd.start) return AckCode.Ok;
        const blocker = this.startBlocker();
        if (blocker !== AckCode.Ok) return blocker;
        s.power = true;
        return AckCode.Ok;
      }
      case 'setZones':
        s.zonesEnabled = { ...cmd.zones };
        s.sleepHangover = false;
        return AckCode.Ok;
      case 'setWashLock':
        s.washLock = cmd.on;
        if (cmd.on) this.switchOff();
        return AckCode.Ok;
      case 'setSchedule': {
        const sched = cmd.schedule;
        if (sched.minuteOfDay < 0 || sched.minuteOfDay >= 1440) return AckCode.Invalid;
        if (sched.preheatMin < 1 || sched.preheatMin > 60) return AckCode.Invalid;
        s.schedule = { ...sched, days: [...sched.days], mode: { ...sched.mode, zones: { ...sched.mode.zones } } };
        return AckCode.Ok;
      }
      case 'syncTime':
        s.rtcEpochS = cmd.epochS;
        s.tzOffsetMin = cmd.tzOffsetMin;
        return AckCode.Ok;
      case 'setContext':
        s.context = { valid: true, outdoors: cmd.outdoors, moving: cmd.moving, outdoorC: cmd.outdoorC };
        if (cmd.moving) s.stillS = 0;
        return AckCode.Ok;
      case 'safetyAck':
        if (cmd.action === 'lockoutToday') s.safety = lockoutZone(s.safety, cmd.zone, this.nextMidnightEpochS());
        else if (cmd.action === 'clearLockout') s.safety = clearLockout(s.safety, cmd.zone);
        return AckCode.Ok;
      case 'setName':
        if (cmd.name.trim().length === 0) return AckCode.Invalid;
        s.name = cmd.name.trim();
        return AckCode.Ok;
      case 'setPrefs':
        s.prefs = { autoOffWhenStill: cmd.autoOffWhenStill, buttonHaptics: cmd.buttonHaptics };
        return AckCode.Ok;
      case 'clearFault':
        if (s.safety.fault !== FAULT_NONE) {
          s.safety = clearFault(s.safety);
          this.emit({ type: 'faultCleared' });
        }
        return AckCode.Ok;
      case 'setSize':
        s.size = cmd.size;
        return AckCode.Ok;
      case 'otaBegin': {
        if (cmd.size <= 0 || cmd.size > MAX_OTA_IMAGE_BYTES) return AckCode.Invalid;
        const charged = CELL_IDS.some((id) => s.pack[id].present && s.pack[id].soc >= FIRMWARE_MIN_CELL_FRACTION);
        if (!charged) {
          this.emit({ type: 'otaFailed', reason: 'battery' });
          return AckCode.LowBattery;
        }
        s.ota = { size: cmd.size, crc32: cmd.crc32 >>> 0, version: cmd.version, received: 0, running: CRC32_INIT };
        return AckCode.Ok;
      }
      case 'otaChunk': {
        const ota = s.ota;
        if (!ota || cmd.offset !== ota.received || ota.received + cmd.data.length > ota.size) return AckCode.Invalid;
        ota.running = crc32Update(ota.running, cmd.data);
        ota.received += cmd.data.length;
        return AckCode.Ok;
      }
      case 'otaEnd': {
        const ota = s.ota;
        if (!ota) return AckCode.Invalid;
        s.ota = null;
        if (ota.received !== ota.size) {
          this.emit({ type: 'otaFailed', reason: 'size' });
          return AckCode.Invalid;
        }
        if (crc32Finish(ota.running) !== ota.crc32) {
          this.emit({ type: 'otaFailed', reason: 'checksum' });
          return AckCode.Checksum;
        }
        s.pendingVersion = ota.version;
        s.rebootRemainingS = REBOOT_SECONDS;
        this.emit({ type: 'otaVerified' });
        return AckCode.Ok;
      }
      case 'otaAbort':
        if (s.ota) {
          s.ota = null;
          this.emit({ type: 'otaFailed', reason: 'aborted' });
        }
        return AckCode.Ok;
    }
  }

  // ───────────────────────────── physical actions ─────────────────────────────

  /** Someone pressed the button on the hem controller. */
  pressButton(): boolean {
    const s = this.state;
    if (!this.isLinkUp() || s.ota) return false;
    if (s.power) {
      this.switchOff();
    } else {
      if (this.startBlocker() !== AckCode.Ok) return false;
      s.power = true;
      s.modeElapsedS = 0;
    }
    this.emit({ type: 'button', power: s.power });
    return true;
  }

  removeCell(id: CellId): void {
    if (!this.state.pack[id].present) return;
    this.state.pack = removeCell(this.state.pack, id);
    this.emit({ type: 'cellRemoved', cell: id });
  }

  insertCell(id: CellId): void {
    if (this.state.pack[id].present) return;
    this.state.pack = insertCell(this.state.pack, id);
    this.emit({ type: 'cellInserted', cell: id });
  }

  dockCell(id: CellId): void {
    const wasPresent = this.state.pack[id].present;
    if (this.state.pack[id].docked) return;
    this.state.pack = dockCell(this.state.pack, id);
    if (wasPresent) this.emit({ type: 'cellRemoved', cell: id });
  }

  // ───────────────────────────── reads ─────────────────────────────

  telemetry(): Telemetry {
    const s = this.state;
    const live = this.live;
    const heaterW = ZONE_IDS.reduce((sum, zone) => sum + live.zonePowerW[zone], 0);
    const share = heaterW + ELECTRONICS_OVERHEAD_W;
    const autoOffRemainingMin =
      s.power && s.mode.autoOffMin !== null && !s.sleepHangover
        ? Math.max(0, Math.ceil((s.mode.autoOffMin * 60 - s.modeElapsedS) / 60))
        : null;
    const runtime = levelRuntimeMin(s.pack, live.effectiveLevel, s.zonesEnabled);
    return {
      uptimeS: Math.floor(s.uptimeS),
      rtcEpochS: Math.floor(s.rtcEpochS),
      power: s.power,
      heating: ZONE_IDS.some((zone) => live.zoneDuty[zone] > 0),
      washLock: s.washLock,
      eased: s.eased,
      fading: live.fading,
      otaActive: s.ota !== null,
      lowBattery: packFraction(s.pack) < LOW_BATTERY_FRACTION,
      scheduleArmed: s.schedule?.enabled ?? false,
      contextOutdoors: s.context.valid && s.context.outdoors,
      contextMoving: !s.context.valid || s.context.moving,
      preheating: s.preheating,
      modeSlot: s.mode.slot,
      level: s.level,
      effectiveLevel: live.effectiveLevel,
      zonesEnabled: { ...s.zonesEnabled },
      zonesHeating: zoneMap((zone) => live.zonePowerW[zone] > 0),
      zoneSafety: zoneMap((zone) => s.safety.zones[zone].status),
      fault: s.safety.fault,
      skinC: this.world.sensorFault ? 0 : s.thermal.skinC,
      targetC: live.targetC,
      panelC: { ...live.panelC },
      duty: { ...live.zoneDuty },
      cells: cellMap((id) => {
        const cell = s.pack[id];
        const supplying = cell.present && cell.soc > CELL_EMPTY_SOC;
        return {
          present: cell.present,
          docked: cell.docked,
          soc: cell.soc,
          millivolts: Math.round(loadedVoltage(cell, supplying ? share / 2 : 0) * 1000),
        };
      }),
      drawW: s.drawEmaW,
      runtimeMin: runtime === null ? null : Math.round(runtime),
      autoOffRemainingMin,
      learnedRestC: s.learnedRestC,
    };
  }

  info(): DeviceInfo {
    const s = this.state;
    return {
      version: { ...s.version },
      hardwareRev: s.hardwareRev,
      size: s.size,
      serial: s.serial,
      name: s.name,
      cells: cellMap((id) => ({ cycles: s.pack[id].cycles, health: s.pack[id].health })),
    };
  }

  advertisement(): Advertisement {
    const s = this.state;
    return {
      id: s.serial,
      name: s.name,
      size: s.size,
      cells: cellMap((id) => (s.pack[id].present ? s.pack[id].soc : null)),
      rssi: -52,
    };
  }
}
