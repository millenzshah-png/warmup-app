/**
 * Sheets the hoodie can raise over any screen: an overheat, and a fault.
 */
import type { ReactNode } from 'react';
import { PANEL_LIMIT_F, PANEL_RESUME_F } from '../../core/spec';
import { FAULT_LABELS } from '../../core/thermal/safety';
import { ZONE_IDS, ZONE_NAMES, ZONE_SHORT_NAMES } from '../../core/types';
import { fToC, formatPanelTemp } from '../../core/units';
import { Sheet } from '../components/Sheet';
import { app } from '../env';
import { useAppState } from '../hooks';
import { Icon } from '../icons';

export function OverheatSheet(): ReactNode {
  const alert = useAppState((s) => s.overheat);
  const telemetry = useAppState((s) => s.telemetry);
  const unit = useAppState((s) => s.settings.unit);
  if (!alert) return null;

  const zoneName = ZONE_NAMES[alert.zone];
  const limit = formatPanelTemp(fToC(PANEL_LIMIT_F), unit);
  const resume = formatPanelTemp(fToC(PANEL_RESUME_F), unit);
  const peak = formatPanelTemp(Math.max(alert.peakC, fToC(PANEL_LIMIT_F)), unit);
  const now = telemetry ? formatPanelTemp(telemetry.panelC[alert.zone], unit) : null;

  return (
    <Sheet labelledBy="overheat-title">
      <div className="sheet__head">
        <span className="icon icon--warn">
          <Icon name="warning" />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="overheat-title" className="sheet__title">
            {alert.cleared ? 'Heat is back on' : 'Heat paused'}
          </h2>
          <p className="sheet__body">
            The {zoneName.toLowerCase()} panel reached {limit}, which is the safety limit.{' '}
            {alert.cleared ? 'It has cooled and is heating again.' : 'It is cooling down now.'}
          </p>
        </div>
      </div>
      <div className="panel" aria-live="polite">
        {ZONE_IDS.map((zone) => (
          <div key={zone} className="kv">
            <span className="muted">{ZONE_NAMES[zone]}</span>
            {zone === alert.zone ? (
              <span style={{ color: 'var(--accent-soft)', fontWeight: 600 }}>
                {peak}
                {now ? ` → ${now}` : ''}
              </span>
            ) : (
              <span>{telemetry ? formatPanelTemp(telemetry.panelC[zone], unit) : '—'}</span>
            )}
          </div>
        ))}
      </div>
      <p className="note" style={{ lineHeight: 1.45 }}>
        Usually caused by a backpack or a chair pressing the panel against you. Heat resumes on its own once the panel is below {resume}.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        <button type="button" className="cta" onClick={() => void app.resolveOverheat('resume')}>
          {alert.cleared ? 'Got it' : 'Resume when safe'}
        </button>
        <button type="button" className="link" onClick={() => void app.resolveOverheat('offToday')}>
          Turn the {ZONE_SHORT_NAMES[alert.zone].toLowerCase()} zone off for today
        </button>
      </div>
    </Sheet>
  );
}

export function FaultSheet(): ReactNode {
  const fault = useAppState((s) => s.fault);
  const connected = useAppState((s) => s.link === 'connected');
  if (fault === null || !connected) return null;

  return (
    <Sheet labelledBy="fault-title">
      <div className="sheet__head">
        <span className="icon icon--warn">
          <Icon name="warning" />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="fault-title" className="sheet__title">
            Heating disabled
          </h2>
          <p className="sheet__body">{FAULT_LABELS[fault]}. The hoodie has switched every panel off to stay safe.</p>
        </div>
      </div>
      <p className="note" style={{ lineHeight: 1.45 }}>
        Snap both cells out for ten seconds and back in. If the fault returns after you clear it, stop using the heat and contact support.
      </p>
      <button type="button" className="cta" onClick={() => void app.clearFault()}>
        Clear and try again
      </button>
    </Sheet>
  );
}
