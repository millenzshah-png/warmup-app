import { useState, type ReactNode } from 'react';
import { activeProfile, combinedCharge, localTzOffsetMin, nowEpochS, updateReadiness } from '../../core/app/selectors';
import { weekSummary } from '../../core/insights/history';
import { findMode } from '../../core/modes';
import { localDayNumber, scheduleSummary } from '../../core/schedule/schedule';
import { CELL_IDS, type TempUnit } from '../../core/types';
import { formatDuration } from '../../core/units';
import { NavRow, Segmented, TextField, ToggleRow } from '../components/Controls';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { app, factoryReset } from '../env';
import { useAppState } from '../hooks';
import { IMAGES } from '../icons';
import { navigate, resetTo } from '../router';

function RenameSheet({ current, onClose }: { current: string; onClose: () => void }): ReactNode {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    const result = await app.renameHoodie(name);
    if (result.ok) onClose();
    else setError(result.error);
  };
  return (
    <Sheet labelledBy="rename-title" onDismiss={onClose}>
      <h2 id="rename-title" className="sheet__title">
        Rename your hoodie
      </h2>
      <TextField
        label="Name"
        medium
        value={name}
        maxLength={20}
        error={error}
        onChange={(value) => {
          setName(value);
          setError(null);
        }}
        onSubmit={() => void save()}
      />
      <button type="button" className="cta" onClick={() => void save()}>
        Save
      </button>
    </Sheet>
  );
}

function ForgetSheet({ onClose }: { onClose: () => void }): ReactNode {
  const [working, setWorking] = useState(false);
  const forget = async (): Promise<void> => {
    setWorking(true);
    await factoryReset();
    resetTo('/welcome', 'back');
  };
  return (
    <Sheet labelledBy="forget-title" onDismiss={working ? undefined : onClose}>
      <h2 id="forget-title" className="sheet__title">
        Forget this hoodie?
      </h2>
      <p className="sheet__body">
        This unpairs the hoodie and clears your profiles, custom modes, schedule and history from this phone. You will go back to the welcome
        screen.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        <button type="button" className="cta" disabled={working} onClick={() => void forget()}>
          Forget and start over
        </button>
        <button type="button" className="link" disabled={working} onClick={onClose}>
          Keep it
        </button>
      </div>
    </Sheet>
  );
}

export function Settings(): ReactNode {
  const hoodie = useAppState((s) => s.hoodie);
  const settings = useAppState((s) => s.settings);
  const telemetry = useAppState((s) => (s.link === 'connected' ? s.telemetry : null));
  const scheduleLine = useAppState((s) => scheduleSummary(s.schedule, findMode(activeProfile(s).modes, s.schedule.modeId)?.name ?? 'Commute'));
  const profileCount = useAppState((s) => s.profiles.length);
  const update = useAppState((s) => updateReadiness(s).release?.version ?? null);
  const washLock = telemetry?.washLock ?? false;
  const sample = useAppState((s) => s.history.sample);
  const weekMinutes = useAppState((s) => Math.round(weekSummary(s.history, localDayNumber(nowEpochS(s), localTzOffsetMin())).totalS / 60));
  const [renaming, setRenaming] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  let cellsLine = 'Not connected';
  if (telemetry) {
    const seated = CELL_IDS.filter((id) => telemetry.cells[id].present);
    const charge = combinedCharge(telemetry);
    if (seated.length === 2) {
      cellsLine = `Cells ${Math.round(telemetry.cells.left.soc * 100)}% and ${Math.round(telemetry.cells.right.soc * 100)}%`;
    } else if (seated.length === 1 && charge !== null) cellsLine = `One cell at ${Math.round(charge * 100)}%`;
    else cellsLine = 'No cells in';
  }

  return (
    <>
      <Screen title="Settings" backTo="/home" glow={{ size: 340, right: -140, top: -80, opacity: 0.5 }}>
        {hoodie ? (
          <button type="button" className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, width: '100%' }} onClick={() => setRenaming(true)} aria-label={`${hoodie.name}. Rename.`}>
            <img src={IMAGES.hoodieThumb} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
            <span className="item__text" style={{ gap: 2 }}>
              <span className="item__title">{hoodie.name}</span>
              <span className="item__sub">
                Size {hoodie.size} · Firmware {hoodie.version} · {cellsLine}
              </span>
            </span>
          </button>
        ) : (
          <NavRow icon="bluetooth" title="Pair a hoodie" sub="Nothing is paired with this phone yet" onClick={() => navigate('/pair')} />
        )}

        <div className="stack">
          <div className="lbl">Temperature unit</div>
          <Segmented<TempUnit>
            label="Temperature unit"
            value={settings.unit}
            onChange={(unit) => app.setUnit(unit)}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
          />
        </div>

        <div className="list">
          <ToggleRow
            title="Notifications"
            sub="Low cell, overheat, update ready"
            checked={settings.notifications}
            onChange={(value) => void app.setSetting('notifications', value)}
          />
          <ToggleRow
            title="Auto-off when still"
            sub="After 30 minutes without movement"
            checked={settings.autoOffWhenStill}
            onChange={(value) => void app.setSetting('autoOffWhenStill', value)}
          />
          <ToggleRow
            title="Button haptics"
            sub="Buzz on the hem button"
            checked={settings.buttonHaptics}
            onChange={(value) => void app.setSetting('buttonHaptics', value)}
          />
        </div>

        <div className="list">
          <NavRow icon="clock" title="Schedules" sub={scheduleLine} onClick={() => navigate('/schedule')} />
          <NavRow
            icon="people"
            title="Profiles"
            sub={profileCount === 1 ? 'Just you on this hoodie' : `${profileCount} people share this hoodie`}
            onClick={() => navigate('/profiles')}
          />
          <NavRow icon="drop" title="Wash mode" sub={washLock ? 'On. Heating is locked.' : 'Lock heating before a wash'} onClick={() => navigate('/wash')} />
          <NavRow
            icon="bolt"
            title="Firmware update"
            sub={update ? `${update} is ready to install` : hoodie ? `Up to date on ${hoodie.version}` : 'Pair a hoodie to check'}
            onClick={() => navigate('/update')}
          />
          <NavRow
            icon="chart"
            title="Insights"
            sub={weekMinutes > 0 ? `${formatDuration(weekMinutes)} of heat this week` : 'Nothing recorded yet'}
            onClick={() => navigate('/insights')}
          />
          <NavRow icon="bag" title="Shop" sub="Spare cells and new colors" onClick={() => navigate('/shop')} />
          <NavRow icon="flask" title="Demo controls" sub="Change the weather, pull a cell, speed up time" onClick={() => navigate('/demo')} />
        </div>

        <div className="stack" style={{ gap: 0 }}>
          {sample ? (
            <button type="button" className="link" onClick={() => app.clearHistory()}>
              Clear sample history
            </button>
          ) : null}
          {hoodie ? (
            <button type="button" className="link link--danger" onClick={() => setForgetting(true)}>
              Forget this hoodie
            </button>
          ) : null}
        </div>
        <div className="note center">Warmup 1.0 · Simulated hoodie</div>
      </Screen>
      {renaming && hoodie ? <RenameSheet current={hoodie.name} onClose={() => setRenaming(false)} /> : null}
      {forgetting ? <ForgetSheet onClose={() => setForgetting(false)} /> : null}
    </>
  );
}
