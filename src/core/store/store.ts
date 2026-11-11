/**
 * A minimal observable store.
 *
 * State is replaced, never mutated, so a subscriber can compare references
 * to decide whether anything it cares about has changed.
 */
export type StoreListener = () => void;

export interface Store<T> {
  get(): T;
  /** Replace the state, or derive the next state from the current one. */
  set(next: T | ((current: T) => T)): void;
  /** Shallow-merge a partial update. */
  patch(partial: Partial<T>): void;
  subscribe(listener: StoreListener): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<StoreListener>();

  const set = (next: T | ((current: T) => T)): void => {
    const value = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    if (Object.is(value, state)) return;
    state = value;
    for (const listener of [...listeners]) listener();
  };

  return {
    get: () => state,
    set,
    patch: (partial) => set((current) => ({ ...current, ...partial })),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** True when two values are the same or are flat objects with equal fields. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
