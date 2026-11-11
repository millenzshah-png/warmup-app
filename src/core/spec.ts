/**
 * Product specification for the Warmup hoodie.
 *
 * These numbers are the single source of truth. The simulator, the firmware
 * model, the UI copy and the tests all read from here, so a spec change is one
 * edit and every screen follows.
 */
import { fToC } from './units';
import type { Level } from './types';

/** Skin temperature targets a mode may ask for, in whole °F. */
export const TARGET_MIN_F = 88;
export const TARGET_MAX_F = 99;
export const TARGET_DEFAULT_F = 93;

/** A panel that reaches this temperature is switched off at once. */
export const PANEL_LIMIT_F = 113;
/** A panel that tripped may heat again once it has cooled below this. */
export const PANEL_RESUME_F = 105;
/** Beyond this the controller treats the reading as a hardware fault. */
export const PANEL_HARD_LIMIT_F = 122;

export const PANEL_LIMIT_C = fToC(PANEL_LIMIT_F);
export const PANEL_RESUME_C = fToC(PANEL_RESUME_F);
export const PANEL_HARD_LIMIT_C = fToC(PANEL_HARD_LIMIT_F);

/** Three trips of one zone inside this window lock that zone for the day. */
export const TRIPS_BEFORE_LOCKOUT = 3;
export const TRIP_WINDOW_S = 600;

/** Snap-in cell. Two of them sit in the side seams at the waist. */
export const CELL_CAPACITY_MAH = 2500;
export const CELL_NOMINAL_V = 3.7;
export const CELL_MASS_G = 50;
export const CELL_RATED_CYCLES = 500;
export const CELL_ENERGY_WH = (CELL_CAPACITY_MAH / 1000) * CELL_NOMINAL_V;
export const PACK_ENERGY_WH = CELL_ENERGY_WH * 2;
export const PACK_CAPACITY_MAH = CELL_CAPACITY_MAH * 2;

/** Charging dock: both cells, USB-C. */
export const DOCK_POWER_W = 18;
export const DOCK_POWER_PER_CELL_W = DOCK_POWER_W / 2;

/** The controller, sensor and radio draw this much whenever a cell is in. */
export const ELECTRONICS_OVERHEAD_W = 0.06;

/**
 * Published runtime from two full cells with all three zones on, per level.
 * Level power is derived from these, never the other way round, so the
 * Battery screen and the storefront can never disagree with the physics.
 */
export const RUNTIME_FROM_FULL_H: readonly [number, number, number] = [6.5, 25 / 6, 17 / 6];

/**
 * The last sliver of charge is held back so the controller and radio stay up
 * after heating stops. Heating switches off when the cells reach this.
 */
export const BATTERY_RESERVE_FRACTION = 0.03;

/** Total pack draw at a level with all three zones on. */
export function levelPackPowerW(level: Level): number {
  return (PACK_ENERGY_WH * (1 - BATTERY_RESERVE_FRACTION)) / RUNTIME_FROM_FULL_H[level];
}

/** Maximum power one panel may draw at a level. */
export function levelZonePowerW(level: Level): number {
  return (levelPackPowerW(level) - ELECTRONICS_OVERHEAD_W) / 3;
}

/** Warn when the combined charge drops below this fraction. */
export const LOW_BATTERY_FRACTION = 0.2;
/** Re-arm the low battery warning once charge recovers above this. */
export const LOW_BATTERY_REARM_FRACTION = 0.25;
/** Heating stops once the combined charge is down to the reserve. */
export const CRITICAL_BATTERY_FRACTION = BATTERY_RESERVE_FRACTION;

/** Firmware releases known to this build of the app. */
export const FIRMWARE_FACTORY_VERSION = '1.2.0';
export const FIRMWARE_LATEST_VERSION = '1.3.0';
export const FIRMWARE_IMAGE_BYTES = 412 * 1024;
/** One cell must hold at least this much charge before an update may start. */
export const FIRMWARE_MIN_CELL_FRACTION = 0.3;

/** The Commute mode drops to Low after this long without movement indoors. */
export const EASE_INDOORS_AFTER_S = 5 * 60;
/** "Auto-off when still" switches heating off after this long without movement. */
export const STILL_AUTO_OFF_S = 30 * 60;

/** Outdoor boost adds this many °F to the target while the wearer is outside. */
export const OUTDOOR_BOOST_F = 2;

/** Garment facts used in copy. */
export const GARMENT = {
  weightG: 640,
  fabric: '320 gsm cotton-poly fleece',
  ratedWashes: 50,
  zones: 3,
} as const;
