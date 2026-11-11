import type { ReactNode } from 'react';
import { combinedCharge } from '../../core/app/selectors';
import { runtimeFromFullMin } from '../../core/battery/runtime';
import type { CellTelemetry } from '../../core/protocol/telemetry';
import {
  CELL_CAPACITY_MAH,
  CELL_MASS_G,
  CELL_RATED_CYCLES,
  DOCK_POWER_W,
  PACK_CAPACITY_MAH,
} from '../../core/spec';
import { CELL_IDS, CELL_NAMES, LEVEL_NAMES, type CellId, type Level } from '../../core/types';
import { formatDuration } from '../../core/units';
import { Meter, Ring } from '../components/Controls';
import { Screen } from '../components/Screen';
import { useAppState } from '../hooks';
import { Icon } from '../icons';
import { navigate } from '../router';

const mah = (value: number): string => value.toLocaleString('en-US');

function CellRing({ id, cell }: { id: CellId; cell: CellTelemetry | null }): ReactNode {
  const name = CELL_NAMES[id];
  if (!cell) return <Ring id={`ring-${id}`} size={140} stroke={10} fraction={0} value="—" caption={name} valueSize={34} captionSize={12} dimmed />;
  const percent = `${Math.round(cell.soc * 100)}%`;
  if (cell.present) {
    return <Ring id={`ring-${id}`} size={140} stroke={10} fraction={cell.soc} value={percent} caption={name} valueSize={34} captionSize={12} />;
  }
  return (
    <Ring
      id={`ring-${id}`}
      size={140}
      stroke={10}
      fraction={cell.soc}
      value={percent}
      caption={cell.docked ? (cell.soc >= 0.999 ? 'Charged' : 'Charging') : `${name} out`}
      valueSize={34}
      captionSize={12}
      dimmed
    />
  );
}

export function Battery(): ReactNode {
  const telemetry = useAppState((s) => (s.link === 'connected' ? s.telemetry : null));
  const cells = useAppState((s) => s.hoodie?.cells ?? null);
  const charge = combinedCharge(telemetry);
  const fromFull = ([0, 1, 2] as Level[]).map((level) => runtimeFromFullMin(level));
  const longest = fromFull[0] ?? 1;

  let summary: ReactNode = 'Connect to the hoodie to see the cells.';
  if (telemetry) {
    const combined = charge === null ? 'No cells in' : `${Math.round(charge * 100)}% combined`;
    summary =
      telemetry.runtimeMin !== null ? (
        <>
          About <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatDuration(telemetry.runtimeMin)}</span> left at{' '}
          {LEVEL_NAMES[telemetry.effectiveLevel]} · {combined}
        </>
      ) : (
        combined
      );
  }

  return (
    <Screen title="Battery" backTo="/home" glow={{ size: 400, left: -5, top: 40, opacity: 0.7 }}>
      <div className="card stack" style={{ gap: 18, padding: '24px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          {CELL_IDS.map((id) => (
            <CellRing key={id} id={id} cell={telemetry?.cells[id] ?? null} />
          ))}
        </div>
        <div className="muted center" style={{ fontSize: 14 }} aria-live="polite">
          {summary}
        </div>
      </div>

      <div className="card stack" style={{ gap: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span className="icon">
            <Icon name="cells" />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="item__title">Two snap-in cells</span>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
              A {mah(CELL_CAPACITY_MAH)} mAh cell sits in each side seam at the waist on a magnetic connector. Pull one out and the hoodie keeps
              running on the other.
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="stat">
            <span className="lbl">Each cell</span>
            <b>
              {CELL_MASS_G} g · {mah(CELL_CAPACITY_MAH)} mAh
            </b>
          </div>
          <div className="stat">
            <span className="lbl">Together</span>
            <b>{mah(PACK_CAPACITY_MAH)} mAh</b>
          </div>
        </div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Runtime from full, both cells</div>
        <div className="stack">
          {fromFull.map((minutes, level) => (
            <Meter
              key={LEVEL_NAMES[level]}
              name={LEVEL_NAMES[level] ?? ''}
              nameWidth={60}
              fraction={minutes / longest}
              value={formatDuration(minutes)}
              valueWidth={56}
            />
          ))}
        </div>
        <div className="note">Auto mode usually lands between Low and Medium because it pulses heat instead of holding it.</div>
      </div>

      <div className="card">
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Charging</div>
        <div className="kv">
          <span className="muted">Dock</span>
          <span>Both cells, USB-C {DOCK_POWER_W} W</span>
        </div>
        <div className="kv">
          <span className="muted">Empty to full</span>
          <span>About 1 hour per cell</span>
        </div>
        <div className="kv">
          <span className="muted">Cycles</span>
          <span>{cells ? `${Math.round(cells.left.cycles)} and ${Math.round(cells.right.cycles)} of ${CELL_RATED_CYCLES}` : '—'}</span>
        </div>
        <div className="kv">
          <span className="muted">Health</span>
          <span style={{ fontWeight: 600 }}>
            {cells ? `${Math.round(cells.left.health * 100)}% · ${Math.round(cells.right.health * 100)}%` : '—'}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="item"
        style={{ background: 'linear-gradient(135deg, #1E1E22, #151517)' }}
        onClick={() => navigate('/shop')}
      >
        <span className="item__text" style={{ gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Need all-day heat?</span>
          <span className="item__sub">Spare cell pair, swap in seconds</span>
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-soft)' }}>$35</span>
      </button>
    </Screen>
  );
}
