import { useEffect, type ReactNode } from 'react';
import type { Toast } from '../../core/app/state';
import { app } from '../env';
import { useAppState } from '../hooks';

const VISIBLE_FOR_MS = 4500;

function ToastCard({ toast }: { toast: Toast }): ReactNode {
  useEffect(() => {
    const handle = window.setTimeout(() => app.dismissToast(toast.id), VISIBLE_FOR_MS);
    return () => window.clearTimeout(handle);
  }, [toast.id]);

  return (
    <button type="button" className="toast" data-tone={toast.tone} onClick={() => app.dismissToast(toast.id)}>
      <span className="toast__mark" aria-hidden="true" />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span className="toast__title">{toast.title}</span>
        {toast.body ? <span className="toast__body">{toast.body}</span> : null}
      </span>
    </button>
  );
}

/** Short notices that drop in from the top and clear themselves. */
export function Toasts(): ReactNode {
  const toasts = useAppState((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
