import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      className="sw"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  options: readonly SegmentOption<T>[];
  /** Null leaves every segment unselected. */
  value: T | null;
  onChange: (value: T) => void;
  small?: boolean;
  width?: number;
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string | number>({ label, options, value, onChange, small, width }: SegmentedProps<T>): ReactNode {
  return (
    <div className={small ? 'seg seg--small' : 'seg'} role="radiogroup" aria-label={label} style={width ? { width } : undefined}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleRowProps {
  title: string;
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** A list row with a title, a line of detail and a switch. */
export function ToggleRow({ title, sub, checked, onChange, disabled }: ToggleRowProps): ReactNode {
  return (
    <div className="item item--tight">
      <span className="item__text">
        <span className="item__title">{title}</span>
        {sub ? <span className="item__sub">{sub}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} label={`${title}`} disabled={disabled} />
    </div>
  );
}

interface NavRowProps {
  icon: IconName;
  title: string;
  sub: string;
  onClick: () => void;
}

/** A list row that opens another screen. */
export function NavRow({ icon, title, sub, onClick }: NavRowProps): ReactNode {
  return (
    <button type="button" className="item item--tight" onClick={onClick}>
      <span className="icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="item__text">
        <span className="item__title">{title}</span>
        <span className="item__sub">{sub}</span>
      </span>
      <span className="faint">
        <Icon name="chevron" size={18} />
      </span>
    </button>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  error?: string | null;
  medium?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

/** The large single-line field used for names. */
export function TextField({ label, value, onChange, maxLength, placeholder, error, medium, autoFocus, onSubmit }: TextFieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="card field">
        <label className="lbl" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className={medium ? 'field__input field__input--medium' : 'field__input'}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
              onSubmit?.();
            }
          }}
        />
      </div>
      {error ? (
        <div id={errorId} className="field__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  /** Text a screen reader announces for the current value. */
  valueText: string;
}

/**
 * A slider drawn to match the design, driven by a native range input laid
 * invisibly over it. That gives dragging, tapping and arrow keys for free.
 */
export function Slider({ label, min, max, value, onChange, valueText }: SliderProps): ReactNode {
  const fraction = (value - min) / (max - min);
  // Keep the knob fully inside the track at both ends.
  const position = `calc(14px + (100% - 28px) * ${fraction})`;
  return (
    <div className="slider">
      <div className="slider__track" />
      <div className="slider__fill" style={{ width: position }} />
      <div className="slider__knob" aria-hidden="true" style={{ left: position }} />
      <input
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

interface RingProps {
  size: number;
  stroke: number;
  /** 0 to 1. */
  fraction: number;
  value: string;
  caption: string;
  valueSize: number;
  captionSize: number;
  /** Unique within the page, for the gradient. */
  id: string;
  dimmed?: boolean;
}

/** A circular progress ring with a number in the middle. */
export function Ring({ size, stroke, fraction, value, caption, valueSize, captionSize, id, dimmed }: RingProps): ReactNode {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <div className="ring" style={{ width: size, height: size, opacity: dimmed ? 0.55 : 1 }}>
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF8A4C" />
            <stop offset="1" stopColor="#E8531F" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#232327" strokeWidth={stroke} />
        {clamped > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped)}
          />
        ) : null}
      </svg>
      <div className="ring__label">
        <div className="ring__value" style={{ fontSize: valueSize }}>
          {value}
        </div>
        <div className="ring__caption" style={{ fontSize: captionSize }}>
          {caption}
        </div>
      </div>
    </div>
  );
}

interface MeterProps {
  name: string;
  nameWidth: number;
  /** 0 to 1. */
  fraction: number;
  value: string;
  valueWidth: number;
}

/** A labelled horizontal bar: name, bar, value. */
export function Meter({ name, nameWidth, fraction, value, valueWidth }: MeterProps): ReactNode {
  return (
    <div className="meter">
      <span className="meter__name" style={{ width: nameWidth }}>
        {name}
      </span>
      <span className="bar">
        <span style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }} />
      </span>
      <span className="meter__value" style={{ width: valueWidth }}>
        {value}
      </span>
    </div>
  );
}
