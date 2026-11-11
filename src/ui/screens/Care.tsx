/**
 * Wash mode and the firmware update screen.
 */
import { useEffect, type ReactNode } from 'react';
import { updateReadiness } from '../../core/app/selectors';
import { STAGE_LABELS, type UpdateStage } from '../../core/device/updater';
import { latestRelease } from '../../core/firmware/releases';
import { FIRMWARE_MIN_CELL_FRACTION, GARMENT } from '../../core/spec';
import { Ring, Switch } from '../components/Controls';
import { Group, Screen } from '../components/Screen';
import { app } from '../env';
import { useAppState } from '../hooks';
import { Icon } from '../icons';

const WASH_STEPS: readonly { name: string; sub: string }[] = [
  { name: 'Snap out both cells', sub: 'They pull straight off the magnetic connector.' },
  { name: 'Close the side seam flaps', sub: 'Keeps the connectors from catching.' },
  { name: 'Turn the hoodie inside out', sub: 'Protects the hem controller and the panels.' },
  { name: 'Wash cold and hang dry', sub: `Rated for ${GARMENT.ratedWashes} washes and counting.` },
];

export function WashMode(): ReactNode {
  const connected = useAppState((s) => s.link === 'connected' && s.telemetry !== null);
  const locked = useAppState((s) => s.telemetry?.washLock ?? false);
  const done = useAppState((s) => s.washChecklist);

  return (
    <Screen title="Wash mode" backTo="/settings" glow={{ size: 340, left: -120, top: 40, opacity: locked ? 0.15 : 0.6 }}>
      <div
        className="card"
        style={{
          background: locked ? 'var(--surface-3)' : 'var(--surface)',
          borderColor: locked ? 'var(--accent-ring)' : 'var(--line)',
          transition: 'background 0.3s, border-color 0.3s',
        }}
      >
        <div className="row">
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{locked ? 'Heating locked' : 'Heating unlocked'}</span>
            <span className="muted" style={{ fontSize: 14, lineHeight: 1.45, maxWidth: 240 }}>
              {locked
                ? 'The hoodie will not heat until you turn wash mode off, even if the hem button is pressed.'
                : 'Turn this on before washing so the hoodie cannot heat by accident.'}
            </span>
          </span>
          <Switch checked={locked} label="Wash mode" disabled={!connected} onChange={(on) => void app.setWashLock(on)} />
        </div>
        {!connected ? (
          <div className="note" style={{ marginTop: 10 }}>
            {locked ? 'The cells are out, so the lock stays as it was set.' : 'Connect to the hoodie to change this.'}
          </div>
        ) : null}
      </div>

      <Group label="Before you wash">
        <div className="list">
          {WASH_STEPS.map((step, index) => (
            <button
              key={step.name}
              type="button"
              role="checkbox"
              aria-checked={done[index] ?? false}
              className="item item--tight item--plain"
              onClick={() => app.toggleWashStep(index)}
            >
              <span className="check">
                <Icon name="check" size={14} strokeWidth={3} />
              </span>
              <span className="item__text" style={{ gap: 2 }}>
                <span className="item__title">{step.name}</span>
                <span className="item__sub">{step.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </Group>

      <div className="card">
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Care label</div>
        <div className="kv">
          <span className="muted">Machine wash</span>
          <span>Cold, gentle cycle</span>
        </div>
        <div className="kv">
          <span className="muted">Dry</span>
          <span>Hang dry only</span>
        </div>
        <div className="kv">
          <span className="muted">Iron</span>
          <span>Never on the panels</span>
        </div>
        <div className="kv">
          <span className="muted">Rated washes</span>
          <span>{GARMENT.ratedWashes}+</span>
        </div>
      </div>
    </Screen>
  );
}

const BUSY: readonly UpdateStage[] = ['downloading', 'installing', 'verifying', 'restarting'];

export function Update(): ReactNode {
  const update = useAppState((s) => s.update);
  const hoodie = useAppState((s) => s.hoodie);
  const readiness = useAppState(updateReadiness, (a, b) => a.release === b.release && a.blocker === b.blocker);
  const release = readiness.release;
  const newest = latestRelease();
  const busy = BUSY.includes(update.stage);
  const upToDate = !release && update.stage !== 'done';

  // Leaving the screen clears a finished or failed run, so it opens fresh next time.
  useEffect(() => () => app.resetUpdate(), []);

  const shownVersion = update.targetVersion ?? release?.version ?? hoodie?.version ?? newest.version;
  const percent = upToDate ? 100 : update.percent;
  const stage = upToDate ? 'Up to date' : STAGE_LABELS[update.stage];

  let button: { label: string; primary: boolean; disabled: boolean };
  if (busy) button = { label: 'Installing…', primary: false, disabled: true };
  else if (update.stage === 'done' || upToDate) button = { label: 'Up to date', primary: false, disabled: true };
  else if (update.stage === 'failed') button = { label: 'Try again', primary: true, disabled: readiness.blocker !== null };
  else button = { label: 'Install now', primary: true, disabled: readiness.blocker !== null };

  return (
    <Screen title="Update" backTo="/settings" glow={{ size: 380, left: 5, top: 60, opacity: 0.6 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: '28px 24px' }}>
        <Ring id="ring-update" size={160} stroke={12} fraction={percent / 100} value={`${percent}%`} caption={stage} valueSize={40} captionSize={13} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Hoodie firmware {shownVersion}</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.4 }} aria-live="polite">
            {update.stage === 'failed' && update.error
              ? update.error
              : busy
                ? 'Keep the phone within 10 feet. Heating pauses during the update.'
                : (readiness.blocker ?? (upToDate || update.stage === 'done' ? 'Nothing to install.' : 'Keep the phone within 10 feet. Heating pauses during the update.'))}
          </div>
        </div>
        <button
          type="button"
          disabled={button.disabled}
          onClick={() => void app.startUpdate()}
          style={{
            height: 48,
            padding: '0 26px',
            borderRadius: 16,
            fontSize: 15,
            fontWeight: 600,
            textAlign: 'center',
            transition: 'background 0.2s, color 0.2s',
            background: button.primary && !button.disabled ? 'var(--accent-grad)' : 'var(--surface-3)',
            color: button.primary && !button.disabled ? '#fff' : 'var(--muted)',
            boxShadow: button.primary && !button.disabled ? '0 10px 28px rgba(255,106,43,0.35)' : 'none',
          }}
        >
          {button.label}
        </button>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>What's new in {newest.version}</div>
        {newest.notes.map((note) => (
          <div key={note} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="dot" aria-hidden="true" />
            <span style={{ fontSize: 15, lineHeight: 1.4 }}>{note}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="kv">
          <span className="muted">Current</span>
          <span>{hoodie?.version ?? '—'}</span>
        </div>
        <div className="kv">
          <span className="muted">Size</span>
          <span>{Math.round(newest.sizeBytes / 1024)} KB</span>
        </div>
        <div className="kv">
          <span className="muted">Battery needed</span>
          <span>At least {Math.round(FIRMWARE_MIN_CELL_FRACTION * 100)}% on one cell</span>
        </div>
      </div>
    </Screen>
  );
}
