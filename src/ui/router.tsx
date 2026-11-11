/**
 * A small hash router with a sense of direction.
 *
 * The path lives in the URL hash so the built app runs from any folder, a
 * file host or a sub-path with no server rules. Each history entry carries
 * its depth, which is how the router knows whether a change went forward or
 * back and can slide the new screen in from the right side.
 */
import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';

export type Direction = 'forward' | 'back' | 'none';

export interface RouteState {
  path: string;
  direction: Direction;
  /** Changes on every navigation, so a screen re-mounts and re-animates. */
  key: number;
}

interface HistoryState {
  depth?: number;
}

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/';
}

function currentDepth(): number {
  const state = window.history.state as HistoryState | null;
  return typeof state?.depth === 'number' ? state.depth : 0;
}

let route: RouteState = { path: currentPath(), direction: 'none', key: 0 };
let depth = currentDepth();
const listeners = new Set<() => void>();

function setRoute(path: string, direction: Direction): void {
  route = { path, direction, key: route.key + 1 };
  for (const listener of [...listeners]) listener();
}

window.addEventListener('popstate', () => {
  const nextDepth = currentDepth();
  const direction: Direction = nextDepth < depth ? 'back' : nextDepth > depth ? 'forward' : 'none';
  depth = nextDepth;
  setRoute(currentPath(), direction);
});

export interface NavigateOptions {
  /** Replace the current entry instead of adding one. */
  replace?: boolean;
  direction?: Direction;
}

export function navigate(path: string, options: NavigateOptions = {}): void {
  if (path === route.path && !options.replace) return;
  const replace = options.replace ?? false;
  depth = replace ? depth : depth + 1;
  const state: HistoryState = { depth };
  if (replace) window.history.replaceState(state, '', `#${path}`);
  else window.history.pushState(state, '', `#${path}`);
  setRoute(path, options.direction ?? (replace ? 'none' : 'forward'));
}

/** Go back one screen, or to `fallback` when there is nothing to go back to. */
export function goBack(fallback: string): void {
  if (depth > 0) window.history.back();
  else navigate(fallback, { replace: true, direction: 'back' });
}

/** Clear the stack down to a single screen, for example after setup or a reset. */
export function resetTo(path: string, direction: Direction = 'forward'): void {
  depth = 0;
  window.history.replaceState({ depth: 0 } satisfies HistoryState, '', `#${path}`);
  setRoute(path, direction);
}

export function useRoute(): RouteState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => route,
  );
}

/** Match "/mode/:id" style patterns. Returns the captured parameters or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] ?? '';
    const actual = pathParts[i] ?? '';
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

interface LinkProps {
  to: string;
  replace?: boolean;
  direction?: Direction;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
  'aria-current'?: 'page' | 'true' | undefined;
}

/** A real anchor, so it can be opened in a new tab, that navigates in place. */
export function Link({ to, replace, direction, children, ...rest }: LinkProps): ReactNode {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, { replace, direction });
  };
  return (
    <a href={`#${to}`} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
