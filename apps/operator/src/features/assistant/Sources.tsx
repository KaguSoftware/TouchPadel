/**
 * What an answer read (plan §5.2): one row per tool call — the tool, its
 * arguments as text, how many rows came back, how long it took — and a link
 * to the page that shows the same numbers, carrying the range in the URL so
 * the page opens on the period the answer was about. A failed read says so
 * in words; a row is never silently missing.
 */
import { Link } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { toolByName } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { Spinner } from '../../components/ui';
import type { SourceItem } from './api';

export interface SourceRow extends SourceItem {
  pending?: boolean;
}

/** `from=2026-09-01 to=2026-09-07 limit=50` — handles stay handles, uuids never appear. */
export function argsText(args: Record<string, unknown> | null | undefined): string {
  if (!args) return '';
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}

/** The route's search params: the range the tool was asked for, when it had one. */
export function rangeSearch(args: Record<string, unknown> | null | undefined): { from: string; to: string } | null {
  if (!args) return null;
  const from = args.from;
  const to = args.to;
  if (typeof from === 'string' && typeof to === 'string') return { from, to };
  const range = args.range;
  if (range && typeof range === 'object') {
    const r = range as { from?: unknown; to?: unknown };
    if (typeof r.from === 'string' && typeof r.to === 'string') return { from: r.from, to: r.to };
  }
  return null;
}

export function Sources({ items, scopes, compact, onNavigate }: { items: readonly SourceRow[]; scopes?: readonly string[] | null; compact?: boolean; onNavigate?: () => void }) {
  const { tr, locale } = useLocale();
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
      <p style={{ color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.owner.assistant.sources.title')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
        {items.map((it) => {
          const route = it.route ?? toolByName(it.name)?.route ?? null;
          const search = rangeSearch(it.args);
          const args = argsText(it.args);
          return (
            <li
              key={it.call_id}
              data-source-row=""
              style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: compact ? 'wrap' : 'nowrap', minInlineSize: 0 }}
            >
              {it.pending ? <Spinner size="xs" /> : <Icon name={it.error ? 'alert' : 'check'} size={13} style={{ color: it.error ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }} />}
              <code dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)', fontSize: 'var(--tp-fs-xs)' }}>
                {it.name}
              </code>
              {args && (
                <span dir="ltr" title={args} style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minInlineSize: 0, flex: 1 }}>
                  {args}
                </span>
              )}
              {it.error ? (
                <span style={{ color: 'var(--tp-warn-fg)' }}>{tr('ws.owner.assistant.sources.failed')}</span>
              ) : (
                <span style={{ color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap' }}>
                  {it.row_count != null && tr('ws.owner.assistant.sources.rows', { n: `⁨${formatNumber(it.row_count, locale)}⁩` })}
                  {it.row_count != null && it.ms != null && ' · '}
                  {it.ms != null && tr('ws.owner.assistant.sources.ms', { ms: `⁨${formatNumber(it.ms, locale)}⁩` })}
                </span>
              )}
              {route && (
                <Link to={route} search={(search ?? {}) as never} className="tp-link" style={{ whiteSpace: 'nowrap' }} onClick={onNavigate}>
                  {tr('ws.owner.assistant.sources.open')}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {scopes && scopes.length > 0 && (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
          {tr('ws.owner.assistant.sources.allowed', { scopes: scopes.map((s) => scopeLabel(tr, s)).join(', ') })}
        </p>
      )}
    </div>
  );
}

export function scopeLabel(tr: ReturnType<typeof useLocale>['tr'], scope: string): string {
  const key = `ws.owner.assistant.scopes.${scope}`;
  const label = tr(key as never);
  return label === key ? scope : label;
}
