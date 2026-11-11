/**
 * Demo controls for the simulated hoodie.
 *
 * The same panel is shown beside the phone on a laptop and as a screen inside
 * the app on a phone. Everything here acts on the simulated world, never on
 * the app directly: the app only finds out through the hoodie, as it would
 * with real hardware.
 */
import type { ReactNode } from 'react';
import { SIM_SPEEDS, type CellPlacement } from '../../core/device/simulator';
import { localSecondOfDay, shiftMinuteOfDay } from '../../core/schedule/schedule';
import { CELL_IDS, CELL_NAMES } from '../../core/types';
import { cToF, clamp, fToC, formatClock, formatTempWithUnit } from '../../core/units';
import { Segmented, Slider, Switch } from '../components/Controls';
import { Screen } from '../components/Screen';
import { factoryReset, sim } from '../env';
import { useAppState, useSimStatus } from '../hooks';
import { resetTo } from '../router';

const SPEED_OPTIONS = SIM_SPEEDS.map((value) => ({ value, label: `${value}×` }));

const PLACEMENT_OPTIONS: readonly { value: CellPlacement; label: string }[] = [
  { value: 'in', label: 'In' },
  { value: 'dock', label: 'Dock' },
  { value: 'out', label: 'Out' },
];

export function DemoControls(): ReactNode {
  const status = useSimStatus();
  const unit = useAppState((s) => s.settings.unit);
  const schedule = useAppState((s) => s.schedule);
  const skinC = useAppState((s) => s.telemetry?.skinC ?? null);
  const { world } = status;

  const roomF = Math.round(cToF(world.roomC));
  const outdoorF = Math.round(cToF(world.outdoorC));
  const clock = formatClock(Math.floor(localSecondOfDay(status.rtcEpochS, status.tzOffsetMin) / 60));
  const beforePreheat = shiftMinuteOfDay(schedule.minuteOfDay, -(schedule.preheatMin + 1));

  const reset = async (): Promise<void> => {
    await factoryReset();
    resetTo('/welcome', 'back');
  };

  return (
    <div className="demo">
      <div className="demo__head">
        <div className="demo__title">Demo controls</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          The hoodie is simulated. Change its surroundings here and watch the app react.
        </div>
      </div>

      <div className="demo__readout">
        <div>
          <span className="lbl">Hoodie clock</span>
          <b>{clock}</b>
        </div>
        <div>
          <span className="lbl">Drawing</span>
          <b>{status.drawW.toFixed(2)} W</b>
        </div>
        <div>
          <span className="lbl">Skin</span>
          <b>{skinC === null ? '—' : formatTempWithUnit(skinC, unit)}</b>
        </div>
        <div>
          <span className="lbl">Link</span>
          <b>{status.connected ? 'Connected' : status.linkUp ? 'Advertising' : 'No power'}</b>
        </div>
      </div>

      <div className="demo__group">
        <div className="lbl">Time speed</div>
        <Segmented label="Time speed" small options={SPEED_OPTIONS} value={status.speed} onChange={(speed) => sim.setSpeed(speed)} />
        <div className="demo__buttons">
          <button type="button" className="demo__btn" onClick={() => sim.jumpClockTo(beforePreheat)}>
            Jump to {formatClock(beforePreheat)}
          </button>
        </div>
      </div>

      <hr />

      <div className="demo__group">
        <div className="lbl">Surroundings</div>
        <div className="demo__row">
          <span>Room</span>
          <span className="demo__value">{formatTempWithUnit(world.roomC, unit, 0)}</span>
        </div>
        <Slider
          label="Room temperature"
          min={50}
          max={80}
          value={clamp(roomF, 50, 80)}
          onChange={(f) => sim.setWorld({ roomC: fToC(f) })}
          valueText={formatTempWithUnit(world.roomC, unit, 0)}
        />
        <div className="demo__row">
          <span>Outside</span>
          <span className="demo__value">{formatTempWithUnit(world.outdoorC, unit, 0)}</span>
        </div>
        <Slider
          label="Outside temperature"
          min={0}
          max={80}
          value={clamp(outdoorF, 0, 80)}
          onChange={(f) => sim.setWorld({ outdoorC: fToC(f) })}
          valueText={formatTempWithUnit(world.outdoorC, unit, 0)}
        />
        <div className="demo__row">
          <span>
            Outdoors
            <small>The wearer has stepped outside</small>
          </span>
          <Switch checked={world.outdoors} label="Outdoors" onChange={(outdoors) => sim.setWorld({ outdoors })} />
        </div>
        <div className="demo__row">
          <span>
            Moving
            <small>Off means sitting still</small>
          </span>
          <Switch checked={world.moving} label="Moving" onChange={(moving) => sim.setWorld({ moving })} />
        </div>
      </div>

      <hr />

      <div className="demo__group">
        <div className="lbl">Things that happen</div>
        <div className="demo__buttons">
          <button type="button" className="demo__btn" aria-pressed={world.covered.B} onClick={() => sim.setCovered('B', !world.covered.B)}>
            {world.covered.B ? 'Backpack on' : 'Put on a backpack'}
          </button>
          <button type="button" className="demo__btn" onClick={() => sim.pressButton()}>
            Press hem button
          </button>
          <button type="button" className="demo__btn" aria-pressed={world.sensorFault} onClick={() => sim.setWorld({ sensorFault: !world.sensorFault })}>
            {world.sensorFault ? 'Sensor broken' : 'Break the sensor'}
          </button>
        </div>
      </div>

      <hr />

      <div className="demo__group">
        <div className="lbl">Cells</div>
        {CELL_IDS.map((id) => (
          <div key={id} className="demo__group" style={{ gap: 6 }}>
            <div className="demo__row">
              <span>{CELL_NAMES[id]}</span>
              <span className="demo__value">{Math.round(status.cells[id].soc * 100)}%</span>
            </div>
            <Segmented
              label={`${CELL_NAMES[id]} placement`}
              small
              options={PLACEMENT_OPTIONS}
              value={status.cells[id].placement}
              onChange={(placement) => sim.setCell(id, placement)}
            />
          </div>
        ))}
        <div className="demo__buttons">
          <button
            type="button"
            className="demo__btn"
            onClick={() => {
              sim.setCellCharge('left', 0.21);
              sim.setCellCharge('right', 0.2);
            }}
          >
            Drain to 20%
          </button>
          <button
            type="button"
            className="demo__btn"
            onClick={() => {
              sim.setCellCharge('left', 1);
              sim.setCellCharge('right', 1);
            }}
          >
            Charge to full
          </button>
        </div>
      </div>

      <hr />

      <div className="demo__group">
        <div className="demo__row">
          <span>
            Firmware {status.version}
            <small>Update from Settings in the app</small>
          </span>
        </div>
        <button type="button" className="demo__btn demo__btn--danger" onClick={() => void reset()}>
          Reset the demo
        </button>
      </div>
    </div>
  );
}

/** The demo controls as a screen inside the app, for phones. */
export function DemoScreen(): ReactNode {
  return (
    <Screen title="Demo" backTo="/settings" glow={{ size: 340, right: -140, top: -80, opacity: 0.5 }}>
      <DemoControls />
    </Screen>
  );
}
