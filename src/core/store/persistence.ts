/**
 * Versioned persistence for a slice of a store.
 *
 * Saved data carries a schema number. When the app's schema moves on, the
 * migrations run in order, and anything unreadable is discarded so a bad
 * save can never stop the app from starting.
 */
import type { KeyValueStore } from '../device/simulator';

export interface Envelope<T> {
  schema: number;
  savedAt: number;
  data: T;
}

/** Upgrade data from the schema it was saved under to the next one. */
export type Migration = (data: unknown) => unknown;

export interface PersistenceOptions<T> {
  storage: KeyValueStore | null;
  key: string;
  schema: number;
  /** migrations[n] upgrades schema n to n + 1. */
  migrations?: Record<number, Migration>;
  /** Final shape check. Return null to reject the data. */
  validate: (data: unknown) => T | null;
  now?: () => number;
}

export interface Persistence<T> {
  load(): T | null;
  save(data: T): boolean;
  clear(): void;
}

export function createPersistence<T>(options: PersistenceOptions<T>): Persistence<T> {
  const { storage, key, schema, migrations = {}, validate } = options;
  const now = options.now ?? (() => Date.now());

  return {
    load(): T | null {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const envelope = JSON.parse(raw) as Partial<Envelope<unknown>>;
        if (typeof envelope !== 'object' || envelope === null || typeof envelope.schema !== 'number') return null;
        if (envelope.schema > schema) return null;
        let data = envelope.data;
        for (let version = envelope.schema; version < schema; version += 1) {
          const migrate = migrations[version];
          if (!migrate) return null;
          data = migrate(data);
        }
        return validate(data);
      } catch {
        return null;
      }
    },

    save(data: T): boolean {
      if (!storage) return false;
      try {
        const envelope: Envelope<T> = { schema, savedAt: now(), data };
        storage.setItem(key, JSON.stringify(envelope));
        return true;
      } catch {
        return false;
      }
    },

    clear(): void {
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing to do if storage is unavailable.
      }
    },
  };
}

/** An in-memory KeyValueStore, used in tests and when local storage is blocked. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map),
  };
}
