/**
 * Two (or three) labelled figures side by side in one card: the form for a
 * handful of related headline numbers that would be a one-bar chart each.
 * Proportional figures (not tabular) because they stand alone.
 */
import type { ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { CardShell, type CardState } from '../../cards/CardShell';

export interface StatItem {
  label: string;
  value: string;
  /** Muted line under the value: state (a sample, a share). */
  sub?: string;
}

export function StatPair({
  title,
  tip,
  state,
  refreshing,
  items,
  note,
  emptyKey,
}: {
  title: string;
  tip?: ReactNode;
  state: CardState;
  refreshing?: boolean;
  items: readonly StatItem[];
  note?: ReactNode;
  emptyKey?: MessageKey;
}) {
  return (
    <CardShell title={title} tip={tip} state={state} refreshing={refreshing} note={note} emptyKey={emptyKey} skeletonLines={2}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 'var(--tp-sp-3)' }}>
        {items.map((it) => (
          <div key={it.label} style={{ minInlineSize: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
            <strong style={{ display: 'block', fontSize: 'var(--tp-fs-xl)', lineHeight: 1.3 }}>{it.value}</strong>
            {it.sub && <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{it.sub}</span>}
          </div>
        ))}
      </div>
    </CardShell>
  );
}
