import type { ReactNode } from 'react';
import { activeProfile, localTzOffsetMin, nowEpochS } from '../../core/app/selectors';
import { compareWithPrevious, describeAverage, weekSummary } from '../../core/insights/history';
import { pickTip } from '../../core/insights/tips';
import { findMode } from '../../core/modes';
import { localDayNumber } from '../../core/schedule/schedule';
import { formatDuration, formatTemp } from '../../core/units';
import { Meter } from '../components/Controls';
import { Screen } from '../components/Screen';
import { useAppState } from '../hooks';
import { Icon } from '../icons';
import { navigate } from '../router';

export function Insights(): ReactNode {
  const history = useAppState((s) => s.history);
  const schedule = useAppState((s) => s.schedule);
  const unit = useAppState((s) => s.settings.unit);
  const modes = useAppState((s) => activeProfile(s).modes);
  const today = useAppState((s) => localDayNumber(nowEpochS(s), localTzOffsetMin()));

  const week = weekSummary(history, today);
  const tip = pickTip(week, schedule);
  const auto = findMode(modes, 'auto');
  const tallest = Math.max(0.5, ...week.bars.map((bar) => bar.hours));
  const scale = tallest * 1.12;
  const shares = week.modeShares.slice(0, 4);

  return (
    <Screen title="This week" backTo="/home" glow={{ size: 340, right: -140, top: -60, opacity: 0.6 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div className="card" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: 18 }}>
          <span className="lbl">Heat time</span>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', whiteSpace: 'nowrap' }}>{formatDuration(week.totalS / 60)}</span>
          <span className="note" style={{ fontSize: 12 }}>
            {compareWithPrevious(week, formatDuration)}
          </span>
        </div>
        <div className="card" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: 18 }}>
          <span className="lbl">Avg skin temp</span>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--accent-soft)' }}>
            {week.avgSkinC === null ? '—' : `${formatTemp(week.avgSkinC, unit)}°`}
          </span>
          <span className="note" style={{ fontSize: 12 }}>
            {describeAverage(week.avgSkinC, auto?.targetF ?? 93, auto?.name ?? 'Auto')}
          </span>
        </div>
      </div>

      <div className="card stack" style={{ gap: 16 }}>
        <div className="row">
          <span style={{ fontSize: 15, fontWeight: 600 }}>Heat per day</span>
          <span className="note">hours</span>
        </div>
        <div className="chart" role="img" aria-label={`Heat per day for the last seven days. ${week.bars.map((b) => `${b.hours.toFixed(1)} hours`).join(', ')}.`}>
          {week.bars.map((bar, index) => (
            <div key={bar.day} className="chart__col" data-peak={index === week.peakIndex}>
              <div className="chart__value">{bar.hours.toFixed(1)}</div>
              <div className="chart__bar" style={{ height: `${Math.round((bar.hours / scale) * 100)}%` }} />
              <div className="chart__day">{bar.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Modes you used</div>
        {shares.length === 0 ? (
          <div className="note">Nothing recorded yet.</div>
        ) : (
          shares.map((share) => (
            <Meter
              key={share.modeId}
              name={findMode(modes, share.modeId)?.name ?? 'Deleted mode'}
              nameWidth={78}
              fraction={share.fraction}
              value={`${Math.round(share.fraction * 100)}%`}
              valueWidth={38}
            />
          ))
        )}
      </div>

      <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', borderColor: 'rgba(255,138,76,0.35)' }}>
        <span className="icon">
          <Icon name="bolt" size={20} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Tip</span>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
            {tip.body}
          </span>
          {tip.action ? (
            <button
              type="button"
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-soft)', minHeight: 44, alignSelf: 'flex-start' }}
              onClick={() => navigate(tip.action?.route ?? '/home')}
            >
              {tip.action.label}
            </button>
          ) : null}
        </span>
      </div>

      {history.sample ? (
        <div className="note center">Includes a sample fortnight from before you paired. You can clear it in Settings.</div>
      ) : null}
    </Screen>
  );
}
