/**
 * Web Bluetooth transport for a real hem controller.
 *
 * This is the hardware path. It follows the GATT table in protocol/gatt.ts
 * and carries the same frames as the simulator. No controller exists yet, so
 * it has not been run against hardware: treat it as the reference for the
 * firmware team rather than as tested code. It needs a browser with Web
 * Bluetooth, which today means Chrome or Edge on Android and desktop. Safari
 * on iPhone does not offer it, so an iPhone build would swap this file for a
 * native bridge with the same interface.
 */
import { ADVERTISED_NAME_PREFIX, GATT, NOTIFY_CHANNELS, type NotifyChannel, type ReadChannel, type WriteChannel } from '../protocol/gatt';
import type { Advertisement } from '../protocol/info';
import { Listeners, TransportError, type HoodieTransport, type Unsubscribe } from './transport';

// The slice of the Web Bluetooth API this file uses. The DOM typings do not
// ship it, and declaring it here avoids a dependency for a few interfaces.
interface BleCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BleCharacteristic>;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
}

interface BleService {
  getCharacteristic(uuid: string): Promise<BleCharacteristic>;
}

interface BleServer {
  connected: boolean;
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleService>;
}

interface BleDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BleServer;
}

interface BleApi {
  requestDevice(options: { filters: { namePrefix?: string; services?: string[] }[]; optionalServices?: string[] }): Promise<BleDevice>;
}

function bluetoothApi(): BleApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { bluetooth?: BleApi }).bluetooth ?? null;
}

/** True when this browser can talk to Bluetooth LE devices. */
export function isBluetoothAvailable(): boolean {
  return bluetoothApi() !== null;
}

export class WebBluetoothTransport implements HoodieTransport {
  readonly kind = 'bluetooth' as const;

  private device: BleDevice | null = null;
  private server: BleServer | null = null;
  private command: BleCharacteristic | null = null;
  private info: BleCharacteristic | null = null;
  private readonly notifyListeners = new Listeners<[NotifyChannel, Uint8Array]>();
  private readonly linkListeners = new Listeners<[boolean]>();

  get connected(): boolean {
    return this.server?.connected ?? false;
  }

  /**
   * Web Bluetooth does not allow a silent scan. This opens the browser's own
   * device chooser and returns whatever the wearer picks.
   */
  async scan(): Promise<Advertisement[]> {
    const api = bluetoothApi();
    if (!api) throw new TransportError('unavailable', 'This browser does not support Bluetooth.');
    try {
      const device = await api.requestDevice({
        filters: [{ namePrefix: ADVERTISED_NAME_PREFIX }],
        optionalServices: [GATT.service],
      });
      this.device = device;
      return [
        {
          id: device.id,
          name: device.name ?? 'Warmup Hoodie',
          size: 'M',
          cells: { left: null, right: null },
          rssi: 0,
        },
      ];
    } catch {
      // The wearer closed the chooser without picking anything.
      return [];
    }
  }

  async connect(id: string): Promise<void> {
    const device = this.device;
    if (!device || device.id !== id || !device.gatt) {
      throw new TransportError('not-found', 'Choose the hoodie from the Bluetooth list first.');
    }
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(GATT.service);
    for (const channel of NOTIFY_CHANNELS) {
      const characteristic = await service.getCharacteristic(GATT[channel]);
      characteristic.addEventListener('characteristicvaluechanged', () => {
        const value = characteristic.value;
        if (!value) return;
        this.notifyListeners.emit(channel, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      });
      await characteristic.startNotifications();
    }
    this.command = await service.getCharacteristic(GATT.command);
    this.info = await service.getCharacteristic(GATT.info);
    this.server = server;
    device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.command = null;
      this.info = null;
      this.linkListeners.emit(false);
    });
    this.linkListeners.emit(true);
  }

  async disconnect(): Promise<void> {
    this.server?.disconnect();
  }

  onNotify(listener: (channel: NotifyChannel, bytes: Uint8Array) => void): Unsubscribe {
    return this.notifyListeners.add(listener);
  }

  onLinkChange(listener: (connected: boolean) => void): Unsubscribe {
    return this.linkListeners.add(listener);
  }

  async write(_channel: WriteChannel, bytes: Uint8Array): Promise<void> {
    if (!this.command || !this.connected) throw new TransportError('not-connected', 'The hoodie is not connected.');
    await this.command.writeValueWithResponse(bytes.slice().buffer);
  }

  async read(_channel: ReadChannel): Promise<Uint8Array> {
    if (!this.info || !this.connected) throw new TransportError('not-connected', 'The hoodie is not connected.');
    const value = await this.info.readValue();
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
}
