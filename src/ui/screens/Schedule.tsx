import { useState, type ReactNode } from 'react';
import { localTzOffsetMin, nowEpochS } from '../../core/app/selectors';
import {
  DAY_LETTERS,
  DAY_NAMES,
  PREHEAT_CHOICES_MIN,
  describeWhen,
  nextRun,
  shiftMinuteOfDay,
  type Days,
} from '../../core/schedule/schedule';
import { EASE_INDOORS_AFTER_S } from '../../core/spec';
import { clockParts, formatClock } from '../../core/units';
import { Segmented, Switch } from '../components/Controls';
import { Group, Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { app } from '../env';
import { useAppState } from '../hooks';
import { Icon } from '../icons';

const PREHEAT_OPTIONS = PREHEAT_CHOICES_MIN.map((value) => ({ value, label: `${value} min` }));

interface TimeSheetProps {
  minuteOfDay: number;
  onDone: (minuteOfDay: number) => void;
  onCancel: () => void;
}

/** Pick a departure time with hour and minute nudges. */
function TimeSheet({ minuteOfDay, onDone, onCancel }: TimeSheetProps): ReactNode {
  const [value, setValue] = useState(minuteOfDay);
  const parts = clockParts(value);
  const [hours, minutes] = parts.time.split(':');
  const nudge = (delta: number): void => setValue((v) => shiftMinuteOfDay(v, delta));
  // Minutes move in fives and stay inside the hour.
  const nudgeMinutes = (delta: number): void =>
    setValue((v) => {
      const hourStart = Math.floor(v / 60) * 60;
      return hourStart + ((((v - hourStart + delta) % 60) + 60) % 60);
    });

  return (
    <Sheet labelledBy="time-sheet-title" onDismiss={onCancel}>
      <h2 id="time-sheet-title" className="sheet__title">
        Leave at
      </h2>
      <div className="time-edit">
        <div className="time-edit__col">
          <button type="button" className="nudge" aria-label="Hour later" onClick={() => nudge(60)}>
            <Icon name="up" size={20} />
          </button>
          <div className="time-edit__num" aria-live="polite">
            {hours}
          </div>
          <button type="button" className="nudge" aria-label="Hour earlier" onClick={() => nudge(-60)}>
            <Icon name="down" size={20} />
          </button>
        </div>
        <div className="time-edit__sep" aria-hidden="true">
          :
        </div>
        <div className="time-edit__col">
          <button type="button" className="nudge" aria-label="Five minutes later" onClick={() => nudgeMinutes(5)}>
            <Icon name="up" size={20} />
          </button>
          <div className="time-edit__num" aria-live="polite">
            {minutes}
          </div>
          <button type="button" className="nudge" aria-label="Five minutes earlier" onClick={() => nudgeMinutes(-5)}>
            <Icon name="down" size={20} />
          </button>
        </div>
      </div>
      <Segmented
        label="Morning or afternoon"
        value={parts.period}
        onChange={(period) => {
          if (period !== parts.period) nudge(period === 'PM' ? 720 : -720);
        }}
        options={[
          { value: 'AM', label: 'AM' },
          { value: 'PM', label: 'PM' },
        ]}
      />
      <button type="button" className="cta" onClick={() => onDone(value)}>
        Set {formatClock(value)}
      </button>
    </Sheet>
  );
}

export function Schedule(): ReactNode {
  const schedule = useAppState((s) => s.schedule);
  const now = useAppState((s) => Math.floor(nowEpochS(s) / 30) * 30);
  const preheating = useAppState((s) => s.telemetry?.preheating ?? false);
  const [editingTime, setEditingTime] = useState(false);
  const tz = localTzOffsetMin();
  const next = nextRun(schedule, now, tz);
  const clock = clockParts(schedule.minuteOfDay);

  const toggleDay = (index: number): void => {
    const days = [...schedule.days] as Days;
    days[index] = !days[index];
    void app.updateSchedule({ days });
  };

  let status = 'Off. Switch it on to preheat before you leave.';
  if (schedule.enabled && !schedule.days.some(Boolean)) status = 'Pick at least one day.';
  else if (preheating) status = 'Preheating now.';
  else if (next) status = `Next preheat ${describeWhen(next.startEpochS, now, tz)}.`;

  return (
    <>
      <Screen title="Commute" backTo="/settings" glow={{ size: 340, left: -120, top: 60, opacity: 0.6 }}>
        <div className="card stack" style={{ gap: 18 }}>
          <div className="row">
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>Preheat before I leave</span>
              <span className="muted" style={{ fontSize: 13 }}>
                Warm by the time you step out
              </span>
            </span>
            <Switch checked={schedule.enabled} label="Preheat before I leave" onChange={(enabled) => void app.updateSchedule({ enabled })} />
          </div>
          <button
            type="button"
            className="time"
            aria-label={`Leave at ${formatClock(schedule.minuteOfDay)}. Tap to change.`}
            onClick={() => setEditingTime(true)}
          >
            <span className="big time__value">{clock.time}</span>
            <span className="time__period">{clock.period}</span>
          </button>
          <div className="note" aria-live="polite">
            {status}
          </div>
        </div>

        <Group label="Days">
          <div className="days">
            {DAY_LETTERS.map((letter, index) => (
              <button
                key={DAY_NAMES[index]}
                type="button"
                aria-label={DAY_NAMES[index]}
                aria-pressed={schedule.days[index]}
                onClick={() => toggleDay(index)}
              >
                {letter}
              </button>
            ))}
          </div>
        </Group>

        <Group label="Preheat time">
          <Segmented
            label="Preheat time"
            options={PREHEAT_OPTIONS}
            value={schedule.preheatMin}
            onChange={(preheatMin) => void app.updateSchedule({ preheatMin })}
          />
          <div className="note">
            Starts {schedule.preheatMin} minutes before {formatClock(schedule.minuteOfDay)}, only if the hoodie is on and a cell has charge.
          </div>
        </Group>

        <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span className="icon">
            <Icon name="mountain" size={20} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Eases off indoors</span>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
              Drops to Low once your phone sees you have stopped moving for {EASE_INDOORS_AFTER_S / 60} minutes.
            </span>
          </span>
        </div>
      </Screen>
      {editingTime ? (
        <TimeSheet
          minuteOfDay={schedule.minuteOfDay}
          onCancel={() => setEditingTime(false)}
          onDone={(minuteOfDay) => {
            setEditingTime(false);
            void app.updateSchedule({ minuteOfDay });
          }}
        />
      ) : null}
    </>
  );
}
