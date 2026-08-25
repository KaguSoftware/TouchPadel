/**
 * `CardShell` + the LTR plotting box every chart on this page needs: axes are
 * numeric and must run left-to-right even when the operator is in Arabic, so
 * the plot area is forced `dir="ltr"` while the card chrome inherits page dir.
 */
import type { ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { CardShell, type CardState } from '../cards/CardShell';

export function ChartCard({
  title,
  state,
  height = 260,
  children,
  note,
  actions,
  emptyKey,
  error,
  onRetry,
}: {
  title: string;
  state: CardState;
  height?: number;
  children: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  emptyKey?: MessageKey;
  error?: unknown;
  onRetry?: () => void;
}) {
  return (
    <CardShell title={title} state={state} note={note} actions={actions} emptyKey={emptyKey} error={error} onRetry={onRetry} skeletonLines={5}>
      <div dir="ltr" style={{ blockSize: `${height}px`, inlineSize: '100%' }}>
        {children}
      </div>
    </CardShell>
  );
}
