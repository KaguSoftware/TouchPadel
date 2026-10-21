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

export function Sources({
  items,
  scopes,
  compact,
  onNavigate,
}: {
  items: readonly SourceRow[];
  scopes?: readonly string[] | null;
  compact?: boolean;
  onNavigate?: () => void;
}) {
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

/**
 * The same reads, laid out for the answer's "Read n" box (Sait, 2026-10-20:
 * "too crowded"): one roomy row each — the tool on its own line, what it was
 * asked and what came back underneath in small grey, and "Open" as a real
 * button at the row's end — with a rule between rows.
 */
export function SourcesBox({ items, scopes, onNavigate }: { items: readonly SourceRow[]; scopes?: readonly string[] | null; onNavigate?: () => void }) {
  const { tr, locale } = useLocale();
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {items.map((it, i) => {
          const route = it.route ?? toolByName(it.name)?.route ?? null;
          const search = rangeSearch(it.args);
          const args = argsText(it.args);
          const meta = it.error
            ? tr('ws.owner.assistant.sources.failed')
            : [it.row_count != null ? tr('ws.owner.assistant.sources.rows', { n: `⁨${formatNumber(it.row_count, locale)}⁩` }) : null, it.ms != null ? tr('ws.owner.assistant.sources.ms', { ms: `⁨${formatNumber(it.ms, locale)}⁩` }) : null]
                .filter(Boolean)
                .join(' · ');
          return (
            <li
              key={it.call_id}
              data-source-row=""
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-3)',
                paddingBlock: 'var(--tp-sp-2-5)',
                borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined,
                minInlineSize: 0,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  inlineSize: '1.75rem',
                  blockSize: '1.75rem',
                  flexShrink: 0,
                  borderRadius: 'var(--tp-radius-pill)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: it.error ? 'color-mix(in oklab, var(--tp-warn-fg) 14%, transparent)' : 'var(--tp-accent-soft)',
                  color: it.error ? 'var(--tp-warn-fg)' : 'var(--tp-accent-active)',
                }}
              >
                {it.pending ? <Spinner size="xs" /> : <Icon name={it.error ? 'alert' : 'check'} size={14} />}
              </span>
              <span style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: '0.2rem' }}>
                <code dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.name}
                </code>
                {args && (
                  <span dir="ltr" title={args} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {args}
                  </span>
                )}
                {meta && <span style={{ fontSize: 'var(--tp-fs-xs)', color: it.error ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }}>{meta}</span>}
              </span>
              {route && (
                <Link
                  to={route}
                  search={(search ?? {}) as never}
                  onClick={onNavigate}
                  className="tp-btn"
                  data-kind="soft"
                  style={{ flexShrink: 0, minBlockSize: '2rem', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-pill)', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, textDecoration: 'none' }}
                >
                  {tr('ws.owner.assistant.sources.openShort')}
                  <Icon name="arrowUpRight" size={13} />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {scopes && scopes.length > 0 && (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.owner.assistant.sources.allowed', { scopes: scopes.map((s) => scopeLabel(tr, s)).join(', ') })}
        </p>
      )}
    </div>
  );
}
