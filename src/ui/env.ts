/**
 * Wiring for the browser.
 *
 * One simulated hoodie, one set of phone sensors reading from it, and one
 * app controller. Swapping the simulator for the Web Bluetooth transport here
 * is the only change needed to drive real hardware.
 */
import { AppController } from '../core/app/controller';
import { SimulatedPhoneSensors } from '../core/app/phone-sensors';
import { localTzOffsetMin } from '../core/app/selectors';
import { SimulatedHoodie, type KeyValueStore } from '../core/device/simulator';

/** Local storage when it is available. Private browsing can block it. */
function safeStorage(): KeyValueStore | null {
  try {
    const probe = '__warmup_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage = safeStorage();

export const sim = new SimulatedHoodie({ storage, tzOffsetMin: localTzOffsetMin() });
export const sensors = new SimulatedPhoneSensors(sim);
export const app = new AppController({ transport: sim, storage, sensors });

let booted = false;

/** Start the simulation and the controller. Safe to call more than once. */
export function boot(): void {
  if (booted) return;
  booted = true;
  sim.start();
  app.start();
  const persist = (): void => {
    app.flush();
    sim.save();
  };
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
}

/** Wipe the app and the simulated hoodie, then start over from the welcome screen. */
export async function factoryReset(): Promise<void> {
  await app.forgetHoodie();
  sim.reset();
}
