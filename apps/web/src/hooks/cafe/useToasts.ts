'use client';

import { useCallback, useRef, useState } from 'react';
import type { ToastKind, ToastMessage } from '@/components/cafe/Toast/Toast';

/**
 * One toast at a time (the newest wins — a stack of pills over a bottom sheet
 * is unreadable on a phone). The incrementing id lets the same text re-show
 * and restarts the dismiss timer.
 */
export interface UseToasts {
  toast: ToastMessage | null;
  show(text: string, kind?: ToastKind): void;
  dismiss(): void;
}

export function useToasts(): UseToasts {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextId = useRef(1);

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    if (!text) return;
    setToast({ id: nextId.current++, text, kind });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return { toast, show, dismiss };
}
