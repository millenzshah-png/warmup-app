import type { CSSProperties, ReactNode } from 'react';
import type { Telemetry } from '../../core/protocol/telemetry';
import { ZONE_NAMES, type ZoneId } from '../../core/types';
import { IMAGES } from '../icons';

export type ZoneVisual = 'off' | 'idle' | 'on' | 'paused';

/** How a zone should be drawn, from what the hoodie last reported. */
export function zoneVisual(telemetry: Telemetry | null, zone: ZoneId): ZoneVisual {
  if (!telemetry) return 'off';
  if (telemetry.zoneSafety[zone] !== 'ok') return telemetry.zonesEnabled[zone] ? 'paused' : 'off';
  if (!telemetry.power || !telemetry.zonesEnabled[zone]) return 'off';
  if (telemetry.zonesHeating[zone]) return 'on';
  return telemetry.duty[zone] > 0 ? 'idle' : 'off';
}

interface HoodieFigureProps {
  view: 'front' | 'back';
  telemetry: Telemetry | null;
  /** When given, the zones become buttons. */
  onToggle?: (zone: ZoneId) => void;
  className?: string;
  style?: CSSProperties;
}

const FRONT_ZONES: readonly ZoneId[] = ['L', 'R'];
const BACK_ZONES: readonly ZoneId[] = ['B'];

/** The hoodie with its heat zones drawn over it. */
export function HoodieFigure({ view, telemetry, onToggle, className, style }: HoodieFigureProps): ReactNode {
  const zones = view === 'front' ? FRONT_ZONES : BACK_ZONES;
  return (
    <div className={className ? `hoodie ${className}` : 'hoodie'} style={style}>
      <img src={view === 'front' ? IMAGES.hoodieFront : IMAGES.hoodieBack} alt={view === 'front' ? 'Hoodie front' : 'Hoodie back'} draggable={false} />
      {zones.map((zone) => {
        const state = zoneVisual(telemetry, zone);
        if (!onToggle) return <div key={zone} aria-hidden="true" className={`zone zone--${zone}`} data-state={state} />;
        const enabled = telemetry?.zonesEnabled[zone] ?? false;
        return (
          <button
            key={zone}
            type="button"
            className={`zone zone--${zone}`}
            data-state={state}
            aria-pressed={enabled}
            aria-label={`${ZONE_NAMES[zone]} zone`}
            onClick={() => onToggle(zone)}
          />
        );
      })}
    </div>
  );
}
