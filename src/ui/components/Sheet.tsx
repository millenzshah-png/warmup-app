import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  /** Id of the element that titles the sheet. */
  labelledBy: string;
  /** Called when the wearer taps outside or presses Escape. Omit to make the sheet modal. */
  onDismiss?: () => void;
  children: ReactNode;
}

/** A bottom sheet over the current screen. */
export function Sheet({ labelledBy, onDismiss, children }: SheetProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      className="scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDismiss?.();
        }}
      >
        <div className="sheet__grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
