import { AppController } from '../src/core/app/controller';
import { SimulatedPhoneSensors } from '../src/core/app/phone-sensors';
import { SimulatedHoodie } from '../src/core/device/simulator';
import { Firmware, type FirmwareCreateOptions } from '../src/core/firmware/firmware';
import { memoryStorage } from '../src/core/store/persistence';

/** Monday 2 November 2026, 12:00 UTC. A weekday at midday, well clear of any boundary. */
export const MONDAY_NOON_S = Date.UTC(2026, 10, 2, 12, 0, 0) / 1000;

/** Step a firmware forward in one-second ticks. */
export function run(fw: Firmware, seconds: number): void {
  for (let i = 0; i < seconds; i += 1) fw.step(1);
}

/** Step and collect every event raised along the way. */
export function runCollecting(fw: Firmware, seconds: number) {
  const events = [];
  for (let i = 0; i < seconds; i += 1) {
    fw.step(1);
    events.push(...fw.takeEvents());
  }
  return events;
}

export function freshFirmware(options: FirmwareCreateOptions = {}): Firmware {
  return Firmware.create({ epochS: MONDAY_NOON_S, ...options });
}

export interface Rig {
  sim: SimulatedHoodie;
  app: AppController;
  storage: ReturnType<typeof memoryStorage>;
  /** Milliseconds on the fake wall clock. */
  clock: { ms: number };
  /** Let queued promises settle. */
  settle(): Promise<void>;
}

/**
 * A simulator and an app controller wired together with no real timers.
 * `sleep` advances the simulation, so anything that waits makes time pass.
 */
export function makeRig(options: { firmware?: Firmware; storage?: ReturnType<typeof memoryStorage> } = {}): Rig {
  const storage = options.storage ?? memoryStorage();
  const clock = { ms: MONDAY_NOON_S * 1000 };
  const sim = new SimulatedHoodie({
    storage,
    latencyMs: 0,
    otaChunkLatencyMs: 0,
    scanMs: 0,
    firmware: options.firmware,
    epochS: MONDAY_NOON_S,
    timers: {
      now: () => clock.ms,
      setInterval: () => 0,
      clearInterval: () => undefined,
      setTimeout: (fn) => {
        fn();
        return 0;
      },
    },
  });
  const app = new AppController({
    transport: sim,
    storage,
    sensors: new SimulatedPhoneSensors(sim),
    now: () => clock.ms,
    tzOffsetMin: () => 0,
    saveDelayMs: 0,
    downloadStepMs: 0,
    reconnectDelayMs: 1500,
    sleep: async (ms) => {
      clock.ms += ms;
      sim.advance(ms / 1000);
    },
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return { sim, app, storage, clock, settle };
}

/** A rig that has already scanned, connected and finished setup. */
export async function pairedRig(options: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  const rig = makeRig(options);
  rig.app.start();
  await rig.app.scan();
  const found = rig.app.store.get().found[0];
  if (!found) throw new Error('scan found nothing');
  const result = await rig.app.connect(found.id);
  if (!result.ok) throw new Error(result.error);
  await rig.app.completeSetup({ name: 'My Hoodie', size: 'M', unit: 'F' });
  rig.sim.advance(1);
  await rig.settle();
  return rig;
}
