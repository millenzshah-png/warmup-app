import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppState } from '../core/app/state';
import type { SimStatus } from '../core/device/simulator';
import { app, sim } from './env';

/**
 * Subscribe to a slice of the app state. The component re-renders only when
 * the selected value changes, as judged by `isEqual`.
 */
export function useAppState<T>(selector: (state: AppState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ state: AppState; selector: (state: AppState) => T; value: T } | null>(null);
  const getSnapshot = (): T => {
    const state = app.store.get();
    const cached = cache.current;
    if (cached && cached.state === state && cached.selector === selector) return cached.value;
    const next = selector(state);
    const value = cached && isEqual(cached.value, next) ? cached.value : next;
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(app.store.subscribe, getSnapshot);
}

/** The simulation's status, refreshed a few times a second. */
export function useSimStatus(): SimStatus {
  return useSyncExternalStore((listener) => sim.onStatus(listener), sim.getStatus);
}

/** True while the window is wide enough for the desktop layout. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Run a callback after a delay, restarting whenever the dependencies change. */
export function useTimeout(callback: () => void, delayMs: number | null, deps: readonly unknown[]): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (delayMs === null) return undefined;
    const handle = window.setTimeout(() => saved.current(), delayMs);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps]);
}
