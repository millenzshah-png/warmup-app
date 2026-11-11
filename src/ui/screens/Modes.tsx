/**
 * Mode detail (tune any mode) and the new-mode builder.
 */
import { useState, type ReactNode } from 'react';
import { activeProfile, currentMode } from '../../core/app/selectors';
import {
  DEFAULT_CUSTOM_AUTO_OFF_MIN,
  MODE_NAME_MAX_LENGTH,
  autoOffLabel,
  describeCustomMode,
  findMode,
  nextAutoOffChoice,
  validateModeName,
  type ModeConfig,
} from '../../core/modes';
import { TARGET_MAX_F, TARGET_MIN_F } from '../../core/spec';
import { RAMP_NAMES, RAMP_SPEEDS, ZONE_IDS, ZONE_NAMES, ZONE_SHORT_NAMES, countZones, type ZoneId, type ZoneMap } from '../../core/types';
import { formatMinutesInWords, formatTarget, formatTargetWithUnit } from '../../core/units';
import { NavRow, Segmented, Slider, TextField, ToggleRow } from '../components/Controls';
import { Group, Screen } from '../components/Screen';
import { app } from '../env';
import { useAppState } from '../hooks';
import { goBack, navigate } from '../router';

const RAMP_OPTIONS = RAMP_SPEEDS.map((value) => ({ value, label: RAMP_NAMES[value] }));

export function ModeDetail({ modeId }: { modeId: string }): ReactNode {
  const unit = useAppState((s) => s.settings.unit);
  const saved = useAppState((s) => findMode(activeProfile(s).modes, modeId) ?? null);
  const running = useAppState((s) => currentMode(s).id === modeId && (s.telemetry?.power ?? false));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!saved) {
    return (
      <Screen title="Mode" backTo="/modes">
        <div className="empty">
          <p className="muted">This mode no longer exists.</p>
          <button type="button" className="ghost" onClick={() => goBack('/modes')}>
            Back to modes
          </button>
        </div>
      </Screen>
    );
  }

  // Every edit is saved as it is made, so nothing is lost by going back.
  const change = (patch: Partial<ModeConfig>): void => {
    void app.saveMode({ ...saved, ...patch }, false);
  };

  const setZone = (zone: ZoneId, on: boolean): void => {
    const zones: ZoneMap<boolean> = { ...saved.zones, [zone]: on };
    if (countZones(zones) === 0) {
      app.notify({ tone: 'info', title: 'Keep at least one zone on', body: 'A mode needs somewhere to send its heat.' });
      return;
    }
    change({ zones });
  };

  const start = async (): Promise<void> => {
    const result = await app.saveMode(saved, true);
    if (result.ok) goBack('/home');
  };

  const remove = async (): Promise<void> => {
    await app.deleteMode(saved.id);
    goBack('/modes');
  };

  return (
    <Screen title={`${saved.name} mode`} backTo="/modes" glow={{ size: 380, left: 5, top: 40, opacity: 0.7 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '26px 20px' }}>
        <div className="lbl">Target skin temperature</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <button
            type="button"
            className="step"
            aria-label="Lower target"
            disabled={saved.targetF <= TARGET_MIN_F}
            onClick={() => change({ targetF: saved.targetF - 1 })}
          >
            −
          </button>
          <div className="target-number" aria-live="polite" aria-label={`Target ${formatTargetWithUnit(saved.targetF, unit)}`}>
            {formatTarget(saved.targetF, unit)}
            <small>°{unit}</small>
          </div>
          <button
            type="button"
            className="step"
            aria-label="Raise target"
            disabled={saved.targetF >= TARGET_MAX_F}
            onClick={() => change({ targetF: saved.targetF + 1 })}
          >
            +
          </button>
        </div>
        <p className="muted center" style={{ fontSize: 14, lineHeight: 1.45 }}>
          {saved.blurb}
        </p>
      </div>

      <Group label="Ramp speed">
        <Segmented label="Ramp speed" options={RAMP_OPTIONS} value={saved.ramp} onChange={(ramp) => change({ ramp })} />
      </Group>

      <Group label="Zones in this mode">
        <div className="list">
          {ZONE_IDS.map((zone) => (
            <ToggleRow key={zone} title={ZONE_NAMES[zone]} checked={saved.zones[zone]} onChange={(on) => setZone(zone, on)} />
          ))}
        </div>
      </Group>

      <div className="card stack" style={{ gap: 6 }}>
        <button
          type="button"
          className="row"
          style={{ width: '100%', minHeight: 32 }}
          aria-label={`Auto-off: ${autoOffLabel(saved.autoOffMin)}. Tap to change.`}
          onClick={() => change({ autoOffMin: nextAutoOffChoice(saved.autoOffMin) })}
        >
          <span style={{ fontSize: 16, fontWeight: 600 }}>Auto-off</span>
          <span className="muted" style={{ fontSize: 15 }}>
            {autoOffLabel(saved.autoOffMin)}
          </span>
        </button>
        {saved.fadeOutMin !== null ? (
          <div className="row" style={{ minHeight: 32 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Fade out</span>
            <span className="muted" style={{ fontSize: 15 }}>
              Over the last {formatMinutesInWords(saved.fadeOutMin)}
            </span>
          </div>
        ) : null}
        <div className="note">{saved.finePrint ?? 'Tap Auto-off to change how long this mode runs.'}</div>
      </div>

      {saved.easeIndoors ? (
        <NavRow icon="clock" title="Preheat schedule" sub="Warm by the time you step out" onClick={() => navigate('/schedule')} />
      ) : null}

      <button type="button" className="cta" onClick={() => void start()}>
        {running ? `Restart ${saved.name} mode` : `Start ${saved.name} mode`}
      </button>

      {!saved.builtIn ? (
        confirmingDelete ? (
          <div className="card stack" style={{ gap: 12 }}>
            <div style={{ fontSize: 15, lineHeight: 1.45 }}>Delete {saved.name}? This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
              <button type="button" className="ghost link--danger" onClick={() => void remove()}>
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link link--danger" onClick={() => setConfirmingDelete(true)}>
            Delete this mode
          </button>
        )
      ) : null}
    </Screen>
  );
}

export function CustomMode(): ReactNode {
  const unit = useAppState((s) => s.settings.unit);
  const modes = useAppState((s) => activeProfile(s).modes);
  const [name, setName] = useState(() => (validateModeName('Library', modes) === null ? 'Library' : ''));
  const [targetF, setTargetF] = useState(94);
  const [zones, setZones] = useState<ZoneMap<boolean>>({ L: true, R: true, B: false });
  const [pulse, setPulse] = useState(true);
  const [outdoorBoost, setOutdoorBoost] = useState(false);
  const [autoOff, setAutoOff] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const autoOffMin = autoOff ? DEFAULT_CUSTOM_AUTO_OFF_MIN : null;
  const noZones = countZones(zones) === 0;

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    const result = await app.createMode({ name, targetF, zones, pulse, outdoorBoost, autoOffMin });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    goBack('/modes');
  };

  return (
    <Screen title="New mode" backTo="/modes" glow={{ size: 340, right: -140, top: -80, opacity: 0.6 }}>
      <TextField
        label="Name"
        medium
        value={name}
        maxLength={MODE_NAME_MAX_LENGTH}
        placeholder="Library"
        error={error}
        onChange={(value) => {
          setName(value);
          setError(null);
        }}
        onSubmit={() => void save()}
      />

      <div className="card stack" style={{ gap: 16 }}>
        <div className="row">
          <span className="lbl">Target</span>
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--accent-soft)' }}>
            {formatTargetWithUnit(targetF, unit)}
          </span>
        </div>
        <Slider
          label="Target skin temperature"
          min={TARGET_MIN_F}
          max={TARGET_MAX_F}
          value={targetF}
          onChange={setTargetF}
          valueText={formatTargetWithUnit(targetF, unit)}
        />
        <div className="row note" style={{ fontSize: 12 }}>
          <span>{formatTargetWithUnit(TARGET_MIN_F, unit)}</span>
          <span>{formatTargetWithUnit(TARGET_MAX_F, unit)}</span>
        </div>
      </div>

      <Group label="Zones">
        <div style={{ display: 'flex', gap: 8 }}>
          {ZONE_IDS.map((zone) => (
            <button
              key={zone}
              type="button"
              className="chip"
              aria-pressed={zones[zone]}
              style={{ flex: '1 1 0', flexDirection: 'column', gap: 2, height: 64, padding: '0 6px', minWidth: 0 }}
              onClick={() => {
                setZones({ ...zones, [zone]: !zones[zone] });
                setError(null);
              }}
            >
              <span>{ZONE_SHORT_NAMES[zone]}</span>
              <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.7 }}>{zones[zone] ? 'On' : 'Off'}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group label="Behavior">
        <div className="list">
          <ToggleRow title="Pulse heat" sub="Saves battery and feels the same" checked={pulse} onChange={setPulse} />
          <ToggleRow title="Outdoor boost" sub="Adds 2° when you step outside" checked={outdoorBoost} onChange={setOutdoorBoost} />
          <ToggleRow
            title="Auto-off"
            sub={`After ${formatMinutesInWords(DEFAULT_CUSTOM_AUTO_OFF_MIN)}`}
            checked={autoOff}
            onChange={setAutoOff}
          />
        </div>
      </Group>

      <div className="note">{noZones ? 'Switch on at least one zone.' : describeCustomMode({ zones, pulse, outdoorBoost, autoOffMin })}</div>

      <button type="button" className="cta" disabled={saving || noZones} onClick={() => void save()}>
        Save mode
      </button>
    </Screen>
  );
}
