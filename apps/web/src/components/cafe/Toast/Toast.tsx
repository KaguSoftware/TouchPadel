'use client';

import { useEffect } from 'react';

/**
 * Bottom-centred toast pill (web-slice §2): 1.7 s for info, 4 s for an error
 * a guest actually has to read. `role="status"` (polite) — a toast must never
 * interrupt what a screen reader is saying about the sheet the guest opened.
 */
export type ToastKind = 'info' | 'error';

export interface ToastMessage {
  /** bump to re-show the same text */
  id: number;
  text: string;
  kind: ToastKind;
}

const DURATION: Record<ToastKind, number> = { info: 1_700, error: 4_000 };

export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss(): void }) {
  const id = toast?.id ?? 0;
  const kind = toast?.kind ?? 'info';
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(onDismiss, DURATION[kind]);
    return () => clearTimeout(timer);
  }, [id, kind, onDismiss]);

  if (!toast) return null;
  return (
    <div className="tp-toast" aria-live="polite">
      <div className="tp-toast__pill" data-kind={toast.kind} role="status">
        {toast.text}
      </div>
    </div>
  );
}
