import { describe, expect, it } from 'vitest';
import { CommandError, HoodieClient } from '../src/core/device/client';
import { SIM_SPEEDS, SimulatedHoodie } from '../src/core/device/simulator';
import { Listeners, TransportError } from '../src/core/device/transport';
import { STAGE_LABELS, downloadFirmware, transferFirmware, updatePercent } from '../src/core/device/updater';
import { Firmware } from '../src/core/firmware/firmware';
import { buildFirmwareImage } from '../src/core/firmware/image';
import { AckCode } from '../src/core/protocol/commands';
import type { DeviceEvent } from '../src/core/protocol/events';
import { FrameType, encodeFrame } from '../src/core/protocol/frames';
import type { Telemetry } from '../src/core/protocol/telemetry';
import { memoryStorage } from '../src/core/store/persistence';
import { MONDAY_NOON_S } from './helpers';

function makeSim(options: { storage?: ReturnType<typeof memoryStorage>; firmware?: Firmware } = {}) {
  const clock = { ms: MONDAY_NOON_S * 1000 };
  const sim = new SimulatedHoodie({
    storage: options.storage ?? null,
    firmware: options.firmware,
    latencyMs: 0,
    otaBytesPerSecond: 0,
    scanMs: 0,
    epochS: MONDAY_NOON_S,
    timers: {
      now: () => clock.ms,
      setInterval: () => 1,
      clearInterval: () => undefined,
      setTimeout: (fn) => {
        fn();
        return 0;
      },
    },
  });
  const client = new HoodieClient(sim, { ackTimeoutMs: 200 });
  const telemetry: Telemetry[] = [];
  const events: DeviceEvent[] = [];
  const links: boolean[] = [];
  client.onTelemetry((t) => telemetry.push(t));
  client.onEvent((e) => events.push(e));
  client.onLink((up) => links.push(up));
  return { sim, client, telemetry, events, links, clock };
}

async function connected(options: Parameters<typeof makeSim>[0] = {}) {
  const rig = makeSim(options);
  const [found] = await rig.client.scan();
  if (!found) throw new Error('nothing found');
  await rig.client.connect(found.id);
  return rig;
}

describe('finding and connecting', () => {
  it('advertises the hoodie with its size and cell charge', async () => {
    const { client } = makeSim();
    const found = await client.scan();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Warmup Hoodie', size: 'M' });
    expect(found[0]?.cells.left).toBeCloseTo(0.82, 6);
    expect(found[0]?.cells.right).toBeCloseTo(0.74, 6);
  });

  it('connects and reads the device information', async () => {
    const { client, links } = makeSim();
    const [found] = await client.scan();
    const info = await client.connect(found?.id ?? '');
    expect(info).toMatchObject({ serial: 'WU26M00417', size: 'M', version: { major: 1, minor: 2, patch: 0 } });
    expect(client.connected).toBe(true);
    expect(links).toEqual([true]);
  });

  it('stops advertising once connected', async () => {
    const { client } = await connected();
    expect(await client.scan()).toEqual([]);
  });

  it('refuses an unknown hoodie', async () => {
    const { client } = makeSim();
    await expect(client.connect('SOMEONE-ELSE')).rejects.toMatchObject({ code: 'not-found' });
    expect(client.connected).toBe(false);
  });

  it('refuses to read or write before connecting', async () => {
    const { client } = makeSim();
    await expect(client.send({ op: 'setPower', on: true })).rejects.toBeInstanceOf(TransportError);
    await expect(client.readInfo()).rejects.toBeInstanceOf(TransportError);
  });
});

describe('telemetry and commands', () => {
  it('streams telemetry as simulated time passes', async () => {
    const { sim, telemetry } = await connected();
    sim.advance(1);
    sim.advance(1);
    sim.advance(1);
    expect(telemetry.length).toBe(3);
    expect(telemetry[2]?.uptimeS).toBeGreaterThan(telemetry[0]?.uptimeS ?? 0);
    expect(telemetry[0]?.power).toBe(true);
  });

  it('sends about one frame a second at normal speed', async () => {
    const { sim, telemetry } = await connected();
    for (let i = 0; i < 40; i += 1) sim.advance(0.25);
    expect(telemetry.length).toBeGreaterThanOrEqual(9);
    expect(telemetry.length).toBeLessThanOrEqual(11);
  });

  it('reports the new state immediately after a command', async () => {
    const { client, telemetry } = await connected();
    await client.send({ op: 'setLevel', level: 2 });
    expect(telemetry.at(-1)?.level).toBe(2);
    await client.send({ op: 'setPower', on: false });
    expect(telemetry.at(-1)?.power).toBe(false);
  });

  it('turns a refusal into a CommandError with the reason', async () => {
    const { client } = await connected();
    await client.send({ op: 'setWashLock', on: true });
    const attempt = client.send({ op: 'setPower', on: true });
    await expect(attempt).rejects.toBeInstanceOf(CommandError);
    await expect(attempt).rejects.toMatchObject({ code: AckCode.Locked, op: 'setPower' });
    await expect(attempt).rejects.toThrow(/Wash mode/);
  });

  it('keeps working after a refused command', async () => {
    const { client, telemetry } = await connected();
    await client.send({ op: 'setWashLock', on: true });
    await client.send({ op: 'setPower', on: true }).catch(() => undefined);
    await client.send({ op: 'setWashLock', on: false });
    await client.send({ op: 'setPower', on: true });
    expect(telemetry.at(-1)?.power).toBe(true);
  });

  it('runs commands strictly in the order they were sent', async () => {
    const { client, sim } = await connected();
    await Promise.all([
      client.send({ op: 'setLevel', level: 0 }),
      client.send({ op: 'setLevel', level: 2 }),
      client.send({ op: 'setLevel', level: 1 }),
    ]);
    expect(sim.firmware.state.level).toBe(1);
  });

  it('delivers events', async () => {
    const { sim, events } = await connected();
    sim.setCovered('B', true);
    sim.advance(120);
    expect(events.some((e) => e.type === 'overheatTrip')).toBe(true);
    sim.pressButton();
    expect(events).toContainEqual({ type: 'button', power: false });
  });

  it('answers a malformed frame with Invalid instead of crashing', async () => {
    const { sim } = await connected();
    const acks: Uint8Array[] = [];
    sim.onNotify((channel, bytes) => {
      if (channel === 'ack') acks.push(bytes);
    });
    await sim.write('command', new Uint8Array([1, 2, 3]));
    await sim.write('command', encodeFrame({ type: FrameType.Command, seq: 9, payload: new Uint8Array([0x7f]) }));
    expect(acks).toHaveLength(2);
    expect(acks[1]?.[5]).toBe(AckCode.Invalid);
  });

  it('counts frames it cannot decode and carries on', async () => {
    const { sim, client, telemetry } = await connected();
    const emit = (sim as unknown as { notifyListeners: Listeners<[string, Uint8Array]> }).notifyListeners;
    emit.emit('telemetry', new Uint8Array([0xa5, 1, 0, 9, 9]));
    expect(client.badFrames).toBe(1);
    sim.advance(1);
    expect(telemetry.length).toBeGreaterThan(0);
  });
});

describe('losing and regaining the link', () => {
  it('drops the link when both cells come out and comes back when one returns', async () => {
    const { sim, client, links } = await connected();
    sim.setCell('left', 'out');
    expect(client.connected).toBe(true);
    sim.setCell('right', 'out');
    expect(client.connected).toBe(false);
    expect(links).toEqual([true, false]);
    expect(await client.scan()).toEqual([]);
    await expect(client.connect('WU26M00417')).rejects.toMatchObject({ code: 'not-found' });
    sim.setCell('right', 'in');
    await client.connect('WU26M00417');
    expect(client.connected).toBe(true);
  });

  it('fails anything still waiting when the link drops', async () => {
    const { sim, client } = await connected();
    const pending = client.send({ op: 'setLevel', level: 2 });
    await sim.disconnect();
    await expect(pending).rejects.toBeInstanceOf(TransportError);
  });

  it('times out when no answer arrives', async () => {
    const { sim, client } = await connected();
    (sim as unknown as { fw: { handle: () => never } }).fw.handle = () => {
      throw new Error('silent');
    };
    // The simulator answers Invalid for a throwing handler, so silence it at the source instead.
    const original = sim.write.bind(sim);
    sim.write = async () => undefined;
    await expect(client.send({ op: 'setLevel', level: 1 })).rejects.toMatchObject({ code: 'timeout' });
    sim.write = original;
  });
});

describe('demo controls', () => {
  it('reports what the demo panel needs', async () => {
    const { sim } = await connected();
    const status = sim.getStatus();
    expect(status).toMatchObject({ speed: 1, connected: true, linkUp: true, version: '1.2.0', power: true });
    expect(status.cells.left).toMatchObject({ placement: 'in' });
    expect(SIM_SPEEDS).toContain(1);
  });

  it('notifies listeners when something changes', () => {
    const { sim } = makeSim();
    let calls = 0;
    const off = sim.onStatus(() => {
      calls += 1;
    });
    sim.setSpeed(60);
    sim.setWorld({ outdoors: true });
    expect(calls).toBe(2);
    expect(sim.getStatus()).toMatchObject({ speed: 60, world: { outdoors: true } });
    off();
    sim.setSpeed(1);
    expect(calls).toBe(2);
  });

  it('moves cells between the hoodie, the dock and the table', () => {
    const { sim } = makeSim();
    sim.setCell('left', 'dock');
    expect(sim.getStatus().cells.left.placement).toBe('dock');
    sim.setCell('left', 'out');
    expect(sim.getStatus().cells.left.placement).toBe('out');
    sim.setCell('left', 'in');
    expect(sim.getStatus().cells.left.placement).toBe('in');
    sim.setCellCharge('right', 0.15);
    expect(sim.getStatus().cells.right.soc).toBeCloseTo(0.15, 3);
  });

  it('jumps the clock forward to the next time it reads a given minute', () => {
    const { sim } = makeSim();
    sim.jumpClockTo(7 * 60 + 5);
    const s = sim.firmware.state;
    // Noon on Monday: the next 07:05 is on Tuesday.
    expect(s.rtcEpochS).toBe(MONDAY_NOON_S + 19 * 3600 + 5 * 60);
    sim.jumpClockTo(9 * 60);
    expect(sim.firmware.state.rtcEpochS).toBe(MONDAY_NOON_S + 21 * 3600);
  });

  it('ticks on its timer and caps a long sleep to one second', () => {
    let tick: (() => void) | null = null;
    const clock = { ms: 0 };
    const sim = new SimulatedHoodie({
      latencyMs: 0,
      timers: {
        now: () => clock.ms,
        setInterval: (fn) => {
          tick = fn;
          return 7;
        },
        clearInterval: () => {
          tick = null;
        },
        setTimeout: (fn) => {
          fn();
          return 0;
        },
      },
    });
    sim.start();
    expect(sim.running).toBe(true);
    const run = (): void => (tick as (() => void) | null)?.();
    const before = sim.firmware.state.rtcEpochS;
    clock.ms += 250;
    run();
    expect(sim.firmware.state.rtcEpochS - before).toBeCloseTo(0.25, 6);
    sim.setSpeed(60);
    clock.ms += 250;
    run();
    expect(sim.firmware.state.rtcEpochS - before).toBeCloseTo(15.25, 6);
    // The tab slept for ten minutes. That counts as one second, not six hundred.
    clock.ms += 600_000;
    run();
    expect(sim.firmware.state.rtcEpochS - before).toBeCloseTo(75.25, 6);
    sim.stop();
    expect(sim.running).toBe(false);
    expect(tick).toBeNull();
  });
});

describe('remembering the hoodie between sessions', () => {
  it('restores the controller from storage', () => {
    const storage = memoryStorage();
    const first = makeSim({ storage }).sim;
    first.setWorld({ roomC: 23 });
    first.firmware.handle({ op: 'setLevel', level: 2 });
    first.firmware.handle({ op: 'setName', name: 'Saved Hoodie' });
    first.advance(300);
    first.save();

    const second = makeSim({ storage }).sim;
    expect(second.firmware.state.name).toBe('Saved Hoodie');
    expect(second.firmware.state.level).toBe(2);
    expect(second.getStatus().world.roomC).toBe(23);
    expect(second.firmware.state.pack.left.soc).toBeCloseTo(first.firmware.state.pack.left.soc, 9);
  });

  it('starts fresh when the saved copy is unreadable', () => {
    const storage = memoryStorage({ 'warmup.sim.v1': '{not json' });
    const sim = makeSim({ storage }).sim;
    expect(sim.firmware.state.name).toBe('Warmup Hoodie');
  });

  it('forgets an update that was in flight when the app closed', () => {
    const storage = memoryStorage();
    const first = makeSim({ storage }).sim;
    const image = buildFirmwareImage('1.3.0');
    first.firmware.handle({ op: 'otaBegin', size: image.bytes.length, crc32: image.crc32, version: image.version });
    first.save();
    const second = makeSim({ storage }).sim;
    expect(second.firmware.state.ota).toBeNull();
    expect(second.firmware.isLinkUp()).toBe(true);
  });

  it('can be reset to a brand new hoodie', async () => {
    const storage = memoryStorage();
    const { sim, client, links } = await connected({ storage });
    sim.firmware.handle({ op: 'setName', name: 'Old' });
    sim.setSpeed(600);
    sim.reset();
    expect(client.connected).toBe(false);
    expect(links.at(-1)).toBe(false);
    expect(sim.firmware.state.name).toBe('Warmup Hoodie');
    expect(sim.speed).toBe(1);
  });
});

describe('firmware transfer', () => {
  it('maps stages onto one progress ring', () => {
    expect(updatePercent('idle')).toBe(0);
    expect(updatePercent('downloading', 0.5)).toBe(15);
    expect(updatePercent('installing', 0)).toBe(30);
    expect(updatePercent('installing', 1)).toBe(90);
    expect(updatePercent('done')).toBe(100);
    expect(updatePercent('installing', 7)).toBe(90);
    expect(STAGE_LABELS.restarting).toBe('Restarting');
  });

  it('paces a download and reports progress', async () => {
    const seen: number[] = [];
    let slept = 0;
    const image = await downloadFirmware('1.3.0', {
      sleep: async (ms) => {
        slept += ms;
      },
      onProgress: (f) => seen.push(f),
      steps: 4,
      stepMs: 10,
    });
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    expect(slept).toBe(40);
    expect(image.bytes.length).toBe(412 * 1024);
  });

  it('streams an image over the wire and the hoodie installs it', async () => {
    const { sim, client, events } = await connected();
    const image = buildFirmwareImage('1.3.0');
    const progress: number[] = [];
    let verifying = false;
    await transferFirmware(client, image, (f) => progress.push(f), {
      onVerifying: () => {
        verifying = true;
      },
    });
    expect(verifying).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBe(Math.ceil(image.bytes.length / 200));
    expect(client.connected).toBe(false);
    sim.advance(4);
    const info = await client.connect('WU26M00417');
    expect(info.version).toEqual({ major: 1, minor: 3, patch: 0 });
    sim.advance(1);
    expect(events).toContainEqual({ type: 'rebooted', version: { major: 1, minor: 3, patch: 0 } });
  });

  it('aborts cleanly when the hoodie refuses a chunk', async () => {
    const { sim, client } = await connected();
    const image = buildFirmwareImage('1.3.0');
    let sent = 0;
    const promise = transferFirmware(client, image, () => {
      sent += 1;
      // Corrupt the controller's bookkeeping part way through.
      if (sent === 50 && sim.firmware.state.ota) sim.firmware.state.ota.received = 0;
    });
    await expect(promise).rejects.toBeInstanceOf(CommandError);
    expect(sim.firmware.state.ota).toBeNull();
    expect(sim.firmware.info().version).toEqual({ major: 1, minor: 2, patch: 0 });
  });
});

describe('pacing a firmware transfer', () => {
  it('takes about as long as the byte rate says, however coarse the timers are', async () => {
    const clock = { ms: 0 };
    const waits: number[] = [];
    const sim = new SimulatedHoodie({
      latencyMs: 0,
      scanMs: 0,
      otaBytesPerSecond: 50_000,
      epochS: MONDAY_NOON_S,
      timers: {
        now: () => clock.ms,
        setInterval: () => 1,
        clearInterval: () => undefined,
        // A background tab: every timer fires at least a full second late.
        setTimeout: (fn, ms) => {
          const waited = Math.max(1000, ms);
          waits.push(waited);
          clock.ms += waited;
          fn();
          return 0;
        },
      },
    });
    const client = new HoodieClient(sim, { ackTimeoutMs: 500 });
    await client.connect('WU26M00417');
    const image = buildFirmwareImage('1.3.0');
    await transferFirmware(client, image, () => undefined);
    const seconds = clock.ms / 1000;
    const ideal = image.bytes.length / 50_000;
    expect(seconds).toBeGreaterThanOrEqual(ideal - 1);
    expect(seconds).toBeLessThan(ideal + 2.5);
    // Far fewer pauses than chunks: it catches up in bursts.
    expect(waits.length).toBeLessThan(20);
  });
});
