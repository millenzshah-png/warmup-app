/**
 * The three tabs: Home, Modes and Zones. They share a header and a tab bar.
 */
import { useState, type ReactNode } from 'react';
import { activeProfile, combinedCharge, currentMode, homeStatus, runtimeLabel, zoneReading } from '../../core/app/selectors';
import type { Telemetry } from '../../core/protocol/telemetry';
import { LOW_BATTERY_FRACTION } from '../../core/spec';
import { CELL_IDS, LEVEL_NAMES, ZONE_IDS, ZONE_NAMES, type Level } from '../../core/types';
import { formatTargetWithUnit, formatTemp } from '../../core/units';
import { Segmented, Switch } from '../components/Controls';
import { HoodieFigure } from '../components/HoodieFigure';
import { Glow } from '../components/Screen';
import { app } from '../env';
import { useAppState } from '../hooks';
import { IMAGES, Icon, MODE_ICONS, type IconName } from '../icons';
import { Link, navigate } from '../router';

export type MainTab = 'home' | 'modes' | 'zones';

const TABS: readonly { id: MainTab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'modes', label: 'Modes', icon: 'list' },
  { id: 'zones', label: 'Zones', icon: 'shield' },
];

const LEVEL_OPTIONS = ([0, 1, 2] as const).map((value) => ({ value, label: LEVEL_NAMES[value] }));

function CellGauge({ telemetry }: { telemetry: Telemetry | null }): ReactNode {
  return (
    <span className="cells" aria-hidden="true">
      {CELL_IDS.map((id) => {
        const cell = telemetry?.cells[id];
        const seated = cell?.present ?? false;
        const soc = seated ? (cell?.soc ?? 0) : 0;
        return (
          <span key={id} data-out={!seated}>
            <i data-low={seated && soc < LOW_BATTERY_FRACTION} style={{ width: `${Math.round(soc * 100)}%` }} />
          </span>
        );
      })}
    </span>
  );
}

function Header(): ReactNode {
  const hoodie = useAppState((s) => s.hoodie);
  const link = useAppState((s) => s.link);
  const telemetry = useAppState((s) => s.telemetry);
  const connected = link === 'connected' && telemetry !== null;
  const charge = connected ? combinedCharge(telemetry) : null;
  const linkLabel = !hoodie ? 'Not paired' : connected ? 'Connected' : link === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  const batteryLabel = charge === null ? 'Battery' : `Battery, ${Math.round(charge * 100)} percent`;

  return (
    <div className="top header">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <img className="header__logo" src={IMAGES.logo} alt="Warmup" />
        <div className="header__sub">
          {hoodie ? `${hoodie.name} · ` : ''}
          {linkLabel}
        </div>
      </div>
      <div className="header__actions">
        {hoodie ? (
          <Link to="/battery" className="pill" aria-label={batteryLabel}>
            <CellGauge telemetry={connected ? telemetry : null} />
            <span>{charge === null ? '—' : `${Math.round(charge * 100)}%`}</span>
          </Link>
        ) : null}
        <Link to="/settings" className="round" aria-label="Settings">
          <Icon name="gear" size={18} />
        </Link>
      </div>
    </div>
  );
}

function NotPaired(): ReactNode {
  return (
    <div className="body" style={{ justifyContent: 'center' }}>
      <div className="empty">
        <span className="icon" style={{ width: 56, height: 56, borderRadius: 18 }}>
          <Icon name="bluetooth" size={26} />
        </span>
        <h1 className="h1" style={{ fontSize: 26 }}>
          No hoodie paired
        </h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.45, maxWidth: 280 }}>
          Pair your Warmup hoodie to see your temperature and control the heat.
        </p>
        <Link to="/pair" className="cta">
          Pair a hoodie
        </Link>
      </div>
    </div>
  );
}

function HomeTab(): ReactNode {
  const telemetry = useAppState((s) => s.telemetry);
  const link = useAppState((s) => s.link);
  const unit = useAppState((s) => s.settings.unit);
  const status = useAppState(homeStatus, (a, b) => a.line === b.line && a.tone === b.tone && a.hint === b.hint);
  const modeName = useAppState((s) => currentMode(s).name);
  const runtime = useAppState(runtimeLabel);
  const connected = link === 'connected' && telemetry !== null;
  const power = connected && telemetry.power;
  const reading = connected ? formatTemp(telemetry.skinC, unit) : '--';

  return (
    <div className="body home">
      <div className="home__top">
        <HoodieFigure view="front" telemetry={connected ? telemetry : null} className="home__figure" />
        <Link to="/insights" className="reading" aria-label={`Skin temperature ${reading} degrees. ${status.line}. Open insights.`}>
          <div className="big reading__value">
            {reading}
            <small>°{unit}</small>
          </div>
          <div className="reading__status" data-tone={status.tone}>
            {status.line}
          </div>
          <div className="reading__hint">{status.hint ?? ''}</div>
        </Link>
      </div>

      <div className="home__controls">
        <Segmented<Level>
          label="Heat level"
          options={LEVEL_OPTIONS}
          value={power ? telemetry.level : null}
          onChange={(level) => void app.setLevel(level)}
        />
        <div className="tiles">
          <button type="button" className="card tile" onClick={() => navigate('/modes', { replace: true })}>
            <span className="icon icon--small">
              <Icon name="list" size={18} />
            </span>
            <span className="tile__text">
              <span className="lbl">Mode</span>
              <span className="tile__value">{modeName}</span>
            </span>
          </button>
          <button type="button" className="card tile" onClick={() => navigate('/battery')}>
            <span className="icon icon--small">
              <Icon name="clock" size={18} />
            </span>
            <span className="tile__text">
              <span className="lbl">Runtime</span>
              <span className="tile__value">{runtime}</span>
            </span>
          </button>
          <button
            type="button"
            className="card power"
            aria-pressed={power}
            aria-label={power ? 'Turn heating off' : 'Turn heating on'}
            disabled={!connected}
            onClick={() => void app.togglePower()}
          >
            <Icon name="power" size={26} strokeWidth={2.5} />
            <span>{power ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ModesTab(): ReactNode {
  const modes = useAppState((s) => activeProfile(s).modes);
  const current = useAppState((s) => currentMode(s));
  const unit = useAppState((s) => s.settings.unit);

  return (
    <div className="body" style={{ paddingTop: 6 }}>
      <h1 className="h1">Modes</h1>
      <div className="list" role="radiogroup" aria-label="Heat mode">
        {modes.map((mode) => {
          const on = mode.id === current.id;
          return (
            <button key={mode.id} type="button" role="radio" aria-checked={on} className="item" onClick={() => void app.selectMode(mode.id)}>
              <span className="icon">
                <Icon name={MODE_ICONS[mode.icon]} />
              </span>
              <span className="item__text">
                <span className="item__title">{mode.name}</span>
                <span className="item__sub">{mode.description}</span>
              </span>
              <span className="badge" style={{ fontSize: 15 }}>
                {formatTargetWithUnit(mode.targetF, unit)}
              </span>
            </button>
          );
        })}
      </div>
      <Link to="/mode/new" className="ghost">
        <Icon name="plus" size={18} strokeWidth={2.5} /> New mode
      </Link>
      <Link to={`/mode/${current.id}`} className="link">
        Edit {current.name} mode
      </Link>
    </div>
  );
}

function ZonesTab(): ReactNode {
  const [view, setView] = useState<'front' | 'back'>('front');
  const telemetry = useAppState((s) => s.telemetry);
  const connected = useAppState((s) => s.link === 'connected' && s.telemetry !== null);
  const readings = useAppState(
    (s) => ZONE_IDS.map((zone) => zoneReading(s, zone)),
    (a, b) => a.every((text, i) => text === b[i]),
  );
  const live = connected ? telemetry : null;

  return (
    <div className="body" style={{ paddingTop: 6, gap: 12 }}>
      <div className="row">
        <h1 className="h1">Zones</h1>
        <Segmented
          label="Side shown"
          small
          width={150}
          value={view}
          onChange={setView}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'back', label: 'Back' },
          ]}
        />
      </div>
      <div className="zones__figure">
        <HoodieFigure
          view={view}
          telemetry={live}
          onToggle={(zone) => void app.toggleZone(zone)}
          style={{ height: '100%', aspectRatio: view === 'front' ? '228 / 300' : '267 / 300' }}
        />
      </div>
      <div className="note center" style={{ marginTop: -6 }}>
        Tap a zone to switch it.
      </div>
      <div className="list">
        {ZONE_IDS.map((zone, i) => {
          const on = live !== null && live.zonesEnabled[zone] && live.zoneSafety[zone] !== 'lockout';
          return (
            <div key={zone} className="item item--tight">
              <span className="item__text" style={{ gap: 2 }}>
                <span className="item__title">{ZONE_NAMES[zone]}</span>
                <span className="item__sub">{readings[i]}</span>
              </span>
              <Switch checked={on} label={ZONE_NAMES[zone]} disabled={!connected} onChange={(next) => void app.setZone(zone, next)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Main({ tab }: { tab: MainTab }): ReactNode {
  const paired = useAppState((s) => s.hoodie !== null);
  const glow = useAppState((s) => {
    const t = s.telemetry;
    if (!t || s.link !== 'connected' || !t.power) return 0.12;
    const base = [0.55, 0.8, 1][t.effectiveLevel] ?? 0.55;
    // Breathe with the heaters: brighter while a burst is on.
    return ZONE_IDS.some((zone) => t.zonesHeating[zone]) ? base : base * 0.7;
  });

  return (
    <div className="s">
      <Glow size={460} left={-35} top={60} opacity={glow} />
      <Header />
      {!paired ? <NotPaired /> : tab === 'home' ? <HomeTab /> : tab === 'modes' ? <ModesTab /> : <ZonesTab />}
      <nav className="tabs" aria-label="Sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => navigate(`/${item.id}`, { replace: true })}
          >
            <Icon name={item.icon} size={24} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
