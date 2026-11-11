import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../icons';
import { goBack } from '../router';

interface GlowProps {
  size: number;
  left?: number;
  right?: number;
  top: number;
  opacity?: number;
}

/** The soft orange light behind every screen. */
export function Glow({ size, left, right, top, opacity = 1 }: GlowProps): ReactNode {
  const style: CSSProperties = { width: size, height: size, top, opacity };
  if (left !== undefined) style.left = left;
  if (right !== undefined) style.right = right;
  // The glow hangs past the edge of the screen. The layer clips it so it can
  // never make the screen scrollable sideways.
  return (
    <div className="glow-layer" aria-hidden="true">
      <div className="glow" style={style} />
    </div>
  );
}

interface ScreenProps {
  title: string;
  /** Where the back button goes when there is no history to return to. */
  backTo: string;
  glow?: GlowProps;
  /** Extra controls at the right end of the top bar. */
  trailing?: ReactNode;
  children: ReactNode;
}

/** A pushed screen: back button, title, scrolling body. */
export function Screen({ title, backTo, glow, trailing, children }: ScreenProps): ReactNode {
  return (
    <div className="s">
      {glow ? <Glow {...glow} /> : null}
      <div className="top">
        <button type="button" className="back" aria-label="Back" onClick={() => goBack(backTo)}>
          <Icon name="back" size={18} strokeWidth={2.5} />
        </button>
        <h1 className="h1" style={{ flex: '1 1 0', minWidth: 0 }}>
          {title}
        </h1>
        {trailing}
      </div>
      <div className="body">{children}</div>
    </div>
  );
}

/** A labelled group of controls. */
export function Group({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <section className="stack">
      <h2 className="lbl">{label}</h2>
      {children}
    </section>
  );
}
