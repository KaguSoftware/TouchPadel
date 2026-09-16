/**
 * The title row over an editor in the right-hand pane: what is being edited,
 * one line of context, and the form's own buttons.
 *
 * Shared by the item form and the category form so both open in the same
 * place and look the same. The category form used to open inline at the
 * bottom of a 50-row category column, below the fold, so clicking its pencil
 * appeared to do nothing.
 */
import type { ReactNode } from 'react';
import { useLocale } from '../../../lib/i18n';
import { StatusBadge } from '../../../components/kit';

export function FormBar({
  title,
  meta,
  dirty,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  dirty: boolean;
  actions: ReactNode;
}) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
      <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <h2 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>{title}</h2>
        {meta && (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {meta}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} style={{ marginBlockStart: 'var(--tp-sp-1-5)' }} />}
        {actions}
      </div>
    </div>
  );
}
