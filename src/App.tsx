import { useEffect, useRef, type ReactNode } from 'react';
import { Toasts } from './ui/components/Toasts';
import { useAppState, useMediaQuery } from './ui/hooks';
import { IMAGES } from './ui/icons';
import { Link, matchPath, resetTo, useRoute } from './ui/router';
import { FaultSheet, OverheatSheet } from './ui/screens/Alerts';
import { Battery } from './ui/screens/Battery';
import { Update, WashMode } from './ui/screens/Care';
import { DemoControls, DemoScreen } from './ui/screens/Demo';
import { Insights } from './ui/screens/Insights';
import { Main } from './ui/screens/Main';
import { CustomMode, ModeDetail } from './ui/screens/Modes';
import { HowItWorks, NameHoodie, Pairing, Welcome } from './ui/screens/Onboarding';
import { Profiles } from './ui/screens/Profiles';
import { Schedule } from './ui/screens/Schedule';
import { Settings } from './ui/screens/Settings';
import { Shop } from './ui/screens/Shop';

const SETUP_PATHS = ['/welcome', '/how', '/pair', '/name'];
const DEVICE_HEIGHT = 844 + 22;

/** Pick the screen for a path. Unknown paths fall back to Home. */
function screenFor(path: string): ReactNode {
  switch (path) {
    case '/welcome':
      return <Welcome />;
    case '/how':
      return <HowItWorks />;
    case '/pair':
      return <Pairing />;
    case '/name':
      return <NameHoodie />;
    case '/home':
      return <Main tab="home" />;
    case '/modes':
      return <Main tab="modes" />;
    case '/zones':
      return <Main tab="zones" />;
    case '/mode/new':
      return <CustomMode />;
    case '/schedule':
      return <Schedule />;
    case '/battery':
      return <Battery />;
    case '/insights':
      return <Insights />;
    case '/profiles':
      return <Profiles />;
    case '/settings':
      return <Settings />;
    case '/wash':
      return <WashMode />;
    case '/update':
      return <Update />;
    case '/demo':
      return <DemoScreen />;
    default: {
      const mode = matchPath('/mode/:id', path);
      return mode?.id ? <ModeDetail modeId={mode.id} /> : null;
    }
  }
}

/** Where a path should really lead, given whether setup is finished. */
function resolvePath(path: string, onboarded: boolean, connected: boolean, paired: boolean): string {
  if (path === '/shop') return path;
  if (!onboarded) {
    // The name screen only makes sense once a hoodie is connected.
    if (path === '/name' && !connected) return '/pair';
    return SETUP_PATHS.includes(path) ? path : '/welcome';
  }
  if (path === '/welcome' || path === '/how' || path === '/name') return '/home';
  // Pairing is only on offer while nothing is paired.
  if (path === '/pair' && paired) return '/home';
  return screenFor(path) === null ? '/home' : path;
}

function useDeviceScale(enabled: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (!enabled) {
      node.style.removeProperty('--device-scale');
      return undefined;
    }
    const update = (): void => {
      const scale = Math.min(1, (window.innerHeight - 48) / DEVICE_HEIGHT);
      node.style.setProperty('--device-scale', String(Math.max(0.5, scale)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [enabled]);
  return ref;
}

function Intro(): ReactNode {
  return (
    <aside className="intro">
      <img src={IMAGES.logo} alt="Warmup" />
      <h1>The app, running against a simulated hoodie.</h1>
      <p>
        Everything on the phone is live. The hoodie's firmware, heat panels, collar sensor and cells are modelled, so the numbers move the way the
        real garment would.
      </p>
      <ul>
        <li>Put on a backpack to trip the 113°F safety cutoff.</li>
        <li>Pull a cell and it keeps running on the other.</li>
        <li>Speed up time to watch a preheat or a Sleep fade.</li>
      </ul>
      <Link to="/shop">Open the storefront</Link>
    </aside>
  );
}

export function App(): ReactNode {
  const route = useRoute();
  const onboarded = useAppState((s) => s.onboarded);
  const connected = useAppState((s) => s.link === 'connected');
  const paired = useAppState((s) => s.hoodie !== null);
  const desktop = useMediaQuery('(min-width: 880px)');
  const deviceRef = useDeviceScale(desktop);
  const path = resolvePath(route.path, onboarded, connected, paired);

  // Keep the address bar honest when a guard sends the wearer somewhere else.
  useEffect(() => {
    if (path !== route.path) resetTo(path, 'none');
  }, [path, route.path]);

  if (path === '/shop') return <Shop />;

  const showDock = desktop && onboarded && path !== '/demo';

  return (
    <div className="stage">
      <Intro />
      <div className="device" ref={deviceRef}>
        <div className="device__screen">
          <div key={`${path}:${route.key}`} className={`route route--${route.direction}`}>
            {screenFor(path)}
          </div>
          <OverheatSheet />
          <FaultSheet />
          <Toasts />
        </div>
      </div>
      {showDock ? (
        <aside className="dock" aria-label="Demo controls">
          <div className="dock__scroll">
            <DemoControls />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
