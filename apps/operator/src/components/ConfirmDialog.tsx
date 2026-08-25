/**
 * ConfirmDialog (controlled) + `useConfirm()` promise helper backed by a
 * ConfirmProvider mounted once in routes/__root.tsx:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: tr('op.confirm.rotateTokens'), kind: 'danger' })) { … }
 *
 * Danger dialogs autofocus Cancel; Esc / click-outside cancel (Modal).
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useLocale } from '../lib/i18n';
import { Button, Modal } from './ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  kind = 'primary',
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { tr } = useLocale();
  if (!open) return null;
  const close = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal title={title} onClose={close}>
      {body !== undefined && body !== null && (
        <div style={{ marginBlockEnd: '1rem', lineHeight: 1.5 }}>{body}</div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={close} disabled={busy} autoFocus={kind === 'danger'}>
          {cancelLabel ?? tr('common.cancel')}
        </Button>
        <Button kind={kind} onClick={onConfirm} disabled={busy} autoFocus={kind !== 'danger'}>
          {confirmLabel ?? tr('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

export interface ConfirmOptions {
  /** Defaults to `op.confirm.title`. */
  title?: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: 'danger' | 'primary';
}

export type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { tr } = useLocale();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options = {}) =>
      new Promise<boolean>((resolve) => {
        setPending((previous) => {
          // A second request while one is open cancels the first.
          previous?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const settle = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.options.title ?? tr('op.confirm.title')}
        body={pending?.options.body}
        confirmLabel={pending?.options.confirmLabel}
        cancelLabel={pending?.options.cancelLabel}
        kind={pending?.options.kind}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm outside ConfirmProvider');
  return ctx;
}
