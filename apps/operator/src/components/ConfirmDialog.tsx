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
  /**
   * Keep the confirm button beside Cancel on a `danger` dialog instead of
   * pushing it to the far edge. For a red action that is REVERSIBLE — signing
   * out, which you undo by signing back in — where the spread below is
   * guarding against a mis-tap that costs nothing to correct. A destructive
   * write (void, refund, delete) must not pass this.
   */
  pairActions?: boolean;
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
  pairActions,
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
    <Modal
      title={title}
      onClose={close}
      // This was the only dialog in the app rendering its action row inside the
      // Modal BODY while PinPromptOverlay, ReasonCodePrompt, PinReasonModal and
      // DrillThroughPanel all used the footer slot — so the one prompt every
      // screen shares was the one that did not look like the others.
      footer={
        <>
          <Button onClick={close} disabled={busy} autoFocus={kind === 'danger'}>
            {cancelLabel ?? tr('common.cancel')}
          </Button>
          <Button
            kind={kind}
            // `disabled={busy}` showed a dead grey button with no spinner while
            // a slow confirmation was in flight; `busy` is what every other
            // prompt passes and it is already non-actionable.
            busy={busy}
            onClick={onConfirm}
            autoFocus={kind !== 'danger'}
            // Rulebook 7.8: a destructive confirm must not sit half a step from
            // Cancel. The auto margin eats the free space between them.
            // `pairActions` opts out for a red action that is reversible.
            style={kind === 'danger' && !pairActions ? { marginInlineStart: 'auto' } : undefined}
          >
            {confirmLabel ?? tr('common.confirm')}
          </Button>
        </>
      }
    >
      {body !== undefined && body !== null ? <div style={{ lineHeight: 1.5 }}>{body}</div> : null}
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
  /** See ConfirmDialogProps.pairActions. */
  pairActions?: boolean;
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
        pairActions={pending?.options.pairActions}
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
