/**
 * What the phone knows about the wearer's surroundings.
 *
 * On a real phone this comes from location, motion and a weather lookup. In
 * the simulator it comes from the simulated world, so changing the weather
 * in the demo controls reaches the hoodie the same way it would outdoors.
 */
import type { SimulatedHoodie } from '../device/simulator';
import type { Unsubscribe } from '../device/transport';

export interface PhoneReading {
  outdoors: boolean;
  moving: boolean;
  /** Outside air temperature, °C. */
  outdoorC: number;
}

export interface PhoneSensors {
  read(): PhoneReading;
  subscribe(listener: (reading: PhoneReading) => void): Unsubscribe;
}

export class SimulatedPhoneSensors implements PhoneSensors {
  private last: PhoneReading;

  constructor(private readonly sim: SimulatedHoodie) {
    this.last = this.read();
  }

  read(): PhoneReading {
    const world = this.sim.getStatus().world;
    return { outdoors: world.outdoors, moving: world.moving, outdoorC: world.outdoorC };
  }

  subscribe(listener: (reading: PhoneReading) => void): Unsubscribe {
    return this.sim.onStatus(() => {
      const next = this.read();
      const changed =
        next.outdoors !== this.last.outdoors ||
        next.moving !== this.last.moving ||
        Math.abs(next.outdoorC - this.last.outdoorC) >= 0.25;
      if (!changed) return;
      this.last = next;
      listener(next);
    });
  }
}
