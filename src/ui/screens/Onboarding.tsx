/**
 * The four setup screens: welcome, how it works, pairing, name and fit.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Advertisement } from '../../core/protocol/info';
import { CELL_MASS_G } from '../../core/spec';
import { HOODIE_SIZES, type HoodieSize, type TempUnit } from '../../core/types';
import { Segmented, TextField } from '../components/Controls';
import { Glow } from '../components/Screen';
import { app } from '../env';
import { useAppState } from '../hooks';
import { IMAGES, Icon, type IconName } from '../icons';
import { Link, navigate, resetTo } from '../router';

function Steps({ current }: { current: 1 | 2 | 3 }): ReactNode {
  return (
    <div className="steps" role="img" aria-label={`Step ${current} of 3`}>
      {[1, 2, 3].map((n) => (
        <span key={n} data-on={n === current} />
      ))}
    </div>
  );
}

export function Welcome(): ReactNode {
  return (
    <div className="s s--spread" style={{ paddingLeft: 28, paddingRight: 28 }}>
      <Glow size={420} left={-15} top={120} />
      <img src={IMAGES.logo} alt="Warmup" style={{ width: 128, height: 'auto', alignSelf: 'center' }} />
      <div className="welcome-hero">
        <img src={IMAGES.hoodieFront} alt="The Warmup hoodie" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 className="hero-title">
            Heat that
            <br />
            thinks for you.
          </h1>
          <p className="lede">Your hoodie reads your body temperature and keeps you exactly where you want to be.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link to="/how" className="cta">
            Get started
          </Link>
          <Link to="/pair" className="link">
            I already have a hoodie
          </Link>
        </div>
      </div>
    </div>
  );
}

const FEATURES: readonly { icon: IconName; title: string; body: string }[] = [
  { icon: 'sun', title: 'A sensor in the collar', body: 'Reads your skin temperature every few seconds. No wearable needed.' },
  { icon: 'shield', title: 'Three heat zones', body: 'Chest left, chest right, and upper back. Each one is yours to switch.' },
  { icon: 'list', title: 'Modes, not dials', body: 'Pick Sick, Commute, Outdoor, or Sleep. The hoodie holds the target for you.' },
  {
    icon: 'cells',
    title: 'Two snap-in cells',
    body: `A slim ${CELL_MASS_G} g cell in each side seam at the waist. Pull them out and it is just a hoodie.`,
  },
];

export function HowItWorks(): ReactNode {
  return (
    <div className="s s--spread">
      <Glow size={360} right={-140} top={-120} opacity={0.7} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow">How it works</div>
          <h1 className="h1" style={{ fontSize: 36 }}>
            Four things
            <br />
            make it smart.
          </h1>
        </div>
        <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {FEATURES.map((feature) => (
            <li key={feature.title} className="item">
              <span className="icon">
                <Icon name={feature.icon} />
              </span>
              <span className="item__text">
                <span className="item__title">{feature.title}</span>
                <span className="item__sub" style={{ fontSize: 14 }}>
                  {feature.body}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', paddingTop: 20 }}>
        <Steps current={1} />
        <Link to="/pair" className="cta">
          Continue
        </Link>
      </div>
    </div>
  );
}

function cellsLine(found: Advertisement): string {
  const { left, right } = found.cells;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  if (left !== null && right !== null) return `Cells ${pct(left)} and ${pct(right)}`;
  if (left !== null) return `Left cell ${pct(left)}`;
  if (right !== null) return `Right cell ${pct(right)}`;
  return 'No cells in';
}

export function Pairing(): ReactNode {
  const link = useAppState((s) => s.link);
  const found = useAppState((s) => s.found);
  const message = useAppState((s) => s.scanMessage);
  const onboarded = useAppState((s) => s.onboarded);
  const paired = useAppState((s) => s.hoodie !== null && s.link === 'connected');
  const hoodie = found[0] ?? null;
  const scanning = link === 'scanning';
  const connecting = link === 'connecting';

  useEffect(() => {
    if (!paired) void app.scan();
    // Scan once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (): Promise<void> => {
    if (!hoodie || connecting) return;
    const result = await app.connect(hoodie.id);
    if (!result.ok) return;
    if (onboarded) resetTo('/home');
    else navigate('/name');
  };

  const skip = (): void => {
    app.skipSetup();
    resetTo('/home');
  };

  return (
    <div className="s s--spread">
      <Glow size={420} left={-15} top={150} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <h1 className="h1" style={{ fontSize: 34 }}>
            Pair your hoodie
          </h1>
          <p className="lede" style={{ fontSize: 16 }}>
            Hold the button on the hem controller for three seconds until the light pulses.
          </p>
        </div>
        <div className="radar" data-scanning={scanning || connecting}>
          <div className="radar__ring radar__ring--outer" />
          <div className="radar__ring radar__ring--inner" />
          <div className="radar__core">
            <img src={IMAGES.logo} alt="" />
          </div>
        </div>
        <div style={{ width: '100%', minHeight: 78 }} aria-live="polite">
          {hoodie ? (
            <div className="item" style={{ padding: '16px 18px' }}>
              <span className="icon" style={{ background: 'var(--accent)', color: '#fff', borderRadius: 999 }}>
                <Icon name="bluetooth" size={20} />
              </span>
              <span className="item__text">
                <span className="item__title">
                  {hoodie.name} · {hoodie.size}
                </span>
                <span className="item__sub">Found nearby · {cellsLine(hoodie)}</span>
              </span>
              <span className="pulse-dot" aria-hidden="true" />
            </div>
          ) : scanning ? (
            <div className="item" style={{ padding: '16px 18px' }}>
              <span className="spinner" aria-hidden="true" />
              <span className="item__text">
                <span className="item__title">Looking for your hoodie</span>
                <span className="item__sub">Keep it within a few feet of your phone.</span>
              </span>
            </div>
          ) : (
            <div className="item" style={{ padding: '16px 18px' }}>
              <span className="item__text">
                <span className="item__title">Nothing nearby yet</span>
                <span className="item__sub">{message ?? 'Make sure a cell is snapped in, then search again.'}</span>
              </span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', paddingTop: 16 }}>
        {onboarded ? null : <Steps current={2} />}
        {hoodie ? (
          <button type="button" className="cta" style={{ marginTop: 12 }} onClick={() => void connect()} disabled={connecting}>
            {connecting ? (
              <>
                <span className="spinner" aria-hidden="true" /> Connecting
              </>
            ) : (
              'Connect'
            )}
          </button>
        ) : (
          <button type="button" className="cta" style={{ marginTop: 12 }} onClick={() => void app.scan()} disabled={scanning}>
            {scanning ? 'Searching' : 'Search again'}
          </button>
        )}
        {hoodie && message ? (
          <div className="field__error center" role="alert">
            {message}
          </div>
        ) : null}
        <button type="button" className="link" onClick={skip}>
          Not now
        </button>
      </div>
    </div>
  );
}

export function NameHoodie(): ReactNode {
  const hoodie = useAppState((s) => s.hoodie);
  const savedUnit = useAppState((s) => s.settings.unit);
  const [name, setName] = useState(() => (hoodie && hoodie.name !== 'Warmup Hoodie' ? hoodie.name : 'My Hoodie'));
  const [size, setSize] = useState<HoodieSize>(hoodie?.size ?? 'M');
  const [unit, setUnit] = useState<TempUnit>(savedUnit);
  const [saving, setSaving] = useState(false);

  const done = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    await app.completeSetup({ name, size, unit });
    resetTo('/home');
  };

  return (
    <div className="s s--spread">
      <Glow size={340} right={-150} top={-100} opacity={0.6} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow">Almost there</div>
          <h1 className="h1" style={{ fontSize: 36 }}>
            Name your hoodie.
          </h1>
        </div>
        <TextField label="Name" value={name} onChange={setName} maxLength={20} placeholder="My Hoodie" onSubmit={() => void done()} />
        <div className="stack" style={{ gap: 12 }}>
          <div className="lbl" id="size-label">
            Size
          </div>
          <div role="radiogroup" aria-labelledby="size-label" style={{ display: 'flex', gap: 8 }}>
            {HOODIE_SIZES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={size === option}
                className="chip"
                style={{ flex: '1 1 0', padding: '0 6px', minWidth: 0 }}
                onClick={() => setSize(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="note">Size sets the panel map so the zones line up with you.</div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <div className="lbl">Temperature unit</div>
          <Segmented
            label="Temperature unit"
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'F', label: 'Fahrenheit' },
              { value: 'C', label: 'Celsius' },
            ]}
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', paddingTop: 20 }}>
        <Steps current={3} />
        <button type="button" className="cta" onClick={() => void done()} disabled={saving}>
          Done
        </button>
      </div>
    </div>
  );
}
