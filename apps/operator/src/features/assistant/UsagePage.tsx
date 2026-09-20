/**
 * `/assistant/usage` (plan §5.1): the month by day — questions, model calls,
 * the four token kinds and the cost — with the month's totals, the cap as a
 * bar, and the pricing table the figures were priced from. A model that is
 * not in the table is priced at the blended fallback, and the page says
 * which ones were.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatMonthYear, formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { AsyncStateWrapper, DataTable, PageHeader, Panel, asyncStatus, type Column } from '../../components/kit';
import { Button } from '../../components/ui';
import { TOKEN_KINDS, formatTokens, formatUsd, isBlendedFallback, type PricingRates } from '../../lib/assistantPricing';
import { QK, fetchConversations, fetchUsage, type UsageDay } from './api';

const iso = (s: string) => `⁨${s}⁩`;

function monthBounds(year: number, month0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month0, 1));
  const to = new Date(Date.UTC(year, month0 + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function UsagePageScreen() {
  const { tr, locale } = useLocale();
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const bounds = useMemo(() => monthBounds(ym.y, ym.m), [ym]);
  const isCurrent = ym.y === now.getUTCFullYear() && ym.m === now.getUTCMonth();

  const q = useQuery({ queryKey: QK.usage(bounds.from, bounds.to), queryFn: () => fetchUsage(bounds.from, bounds.to) });
  // Which models were used: the conversations carry the model in `tokens`.
  const convs = useQuery({ queryKey: QK.conversations, queryFn: fetchConversations, staleTime: 60_000 });

  const days = useMemo(() => (q.data?.days ?? []).slice().sort((a, b) => (a.usage_date < b.usage_date ? 1 : -1)), [q.data]);
  const totals = useMemo(() => {
    const sum = { requests: 0, model_calls: 0, input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, cost_micros: 0 };
    for (const d of days) {
      sum.requests += d.requests;
      sum.model_calls += d.model_calls;
      sum.input_tokens += d.input_tokens;
      sum.cache_write_tokens += d.cache_write_tokens;
      sum.cache_read_tokens += d.cache_read_tokens;
      sum.output_tokens += d.output_tokens;
      sum.cost_micros += d.cost_micros;
    }
    return sum;
  }, [days]);

  const pricing = useMemo(() => q.data?.pricing ?? {}, [q.data]);
  const fallback = q.data?.fallback_micros_per_mtok ?? 0;
  const pricingRows = useMemo(() => Object.entries(pricing).filter((e): e is [string, Partial<PricingRates>] => !!e[1]), [pricing]);
  const blended = useMemo(() => {
    const models = new Set<string>();
    for (const c of convs.data ?? []) if (c.tokens.model && isBlendedFallback(c.tokens.model, pricing)) models.add(c.tokens.model);
    return [...models];
  }, [convs.data, pricing]);

  const cap = q.data?.cap;
  const capMicros = cap?.monthly_cap_micros ?? null;
  const spent = isCurrent ? (cap?.month_cost_micros ?? totals.cost_micros) : totals.cost_micros;
  const pct = capMicros && capMicros > 0 ? Math.min(100, Math.round((spent / capMicros) * 100)) : 0;

  const num = (n: number) => iso(formatNumber(n, locale));
  const columns: Column<UsageDay>[] = [
    { key: 'date', header: tr('ws.owner.assistant.usage.cols.date'), render: (r) => formatDate(new Date(`${r.usage_date}T00:00:00Z`), locale), width: '9rem' },
    { key: 'requests', header: tr('ws.owner.assistant.usage.cols.requests'), numeric: true, render: (r) => num(r.requests) },
    { key: 'calls', header: tr('ws.owner.assistant.usage.cols.calls'), numeric: true, render: (r) => num(r.model_calls) },
    { key: 'input', header: tr('ws.owner.assistant.usage.cols.input'), numeric: true, render: (r) => iso(formatTokens(r.input_tokens)), truncateTitle: (r) => String(r.input_tokens) },
    { key: 'cacheWrite', header: tr('ws.owner.assistant.usage.cols.cacheWrite'), numeric: true, render: (r) => iso(formatTokens(r.cache_write_tokens)), truncateTitle: (r) => String(r.cache_write_tokens) },
    { key: 'cacheRead', header: tr('ws.owner.assistant.usage.cols.cacheRead'), numeric: true, render: (r) => iso(formatTokens(r.cache_read_tokens)), truncateTitle: (r) => String(r.cache_read_tokens) },
    { key: 'output', header: tr('ws.owner.assistant.usage.cols.output'), numeric: true, render: (r) => iso(formatTokens(r.output_tokens)), truncateTitle: (r) => String(r.output_tokens) },
    { key: 'cost', header: tr('ws.owner.assistant.usage.cols.cost'), numeric: true, render: (r) => iso(formatUsd(r.cost_micros)) },
  ];

  const pricingColumns: Column<[string, Partial<PricingRates>]>[] = [
    { key: 'model', header: tr('ws.owner.assistant.usage.pricingCols.model'), render: ([model]) => <code dir="ltr">{model}</code> },
    ...TOKEN_KINDS.map((kind): Column<[string, Partial<PricingRates>]> => ({
      key: kind,
      header: tr(`ws.owner.assistant.usage.pricingCols.${kind === 'cache_write' ? 'cacheWrite' : kind === 'cache_read' ? 'cacheRead' : kind}`),
      numeric: true,
      render: ([, rates]) => (typeof rates[kind] === 'number' ? iso(formatUsd(rates[kind]!)) : '—'),
    })),
  ];

  const monthLabel = formatMonthYear(new Date(Date.UTC(ym.y, ym.m, 1)), locale);

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <PageHeader
        title={tr('ws.owner.assistant.usage.title')}
        subtitle={tr('ws.owner.assistant.usage.lead')}
        eyebrow={
          <Link to="/assistant" className="tp-link">
            {tr('ws.owner.assistant.title')}
          </Link>
        }
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <Button size="sm" icon="chevronStart" aria-label={tr('ws.owner.assistant.usage.prev')} title={tr('ws.owner.assistant.usage.prev')} onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} />
            <span style={{ fontWeight: 600, minInlineSize: '9rem', textAlign: 'center' }}>{monthLabel}</span>
            <Button size="sm" icon="chevronEnd" aria-label={tr('ws.owner.assistant.usage.next')} title={tr('ws.owner.assistant.usage.next')} disabled={isCurrent} onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} />
          </div>
        }
      />

      <AsyncStateWrapper status={asyncStatus(q, (d) => d.days.length === 0)} error={q.error} onRetry={() => void q.refetch()} kind="initial" emptyContent={<p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.usage.empty')}</p>}>
        <DataTable
          columns={columns}
          rows={days}
          rowKey={(r) => r.usage_date}
          dense
          aria-label={tr('ws.owner.assistant.usage.title')}
          footer={
            <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', fontFamily: 'var(--tp-font-numeric)' }}>
              <strong>{tr('ws.owner.assistant.usage.totals')}</strong>
              <span>{tr('ws.owner.assistant.usage.cols.requests')}: {num(totals.requests)}</span>
              <span>{tr('ws.owner.assistant.usage.cols.calls')}: {num(totals.model_calls)}</span>
              <span>{tr('ws.owner.assistant.usage.cols.input')}: {iso(formatTokens(totals.input_tokens))}</span>
              <span>{tr('ws.owner.assistant.usage.cols.cacheWrite')}: {iso(formatTokens(totals.cache_write_tokens))}</span>
              <span>{tr('ws.owner.assistant.usage.cols.cacheRead')}: {iso(formatTokens(totals.cache_read_tokens))}</span>
              <span>{tr('ws.owner.assistant.usage.cols.output')}: {iso(formatTokens(totals.output_tokens))}</span>
              <strong>{tr('ws.owner.assistant.usage.cols.cost')}: {iso(formatUsd(totals.cost_micros))}</strong>
            </div>
          }
        />
      </AsyncStateWrapper>

      {q.data && (
        <Panel title={tr('ws.owner.assistant.usage.cap')}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {capMicros && capMicros > 0 ? (
              <>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ blockSize: '0.6rem', borderRadius: 'var(--tp-radius-sm)', background: 'var(--tp-surface-2)', overflow: 'hidden' }}>
                  <div style={{ inlineSize: `${pct}%`, blockSize: '100%', background: pct >= 90 ? 'var(--tp-danger-fg)' : 'var(--tp-accent)' }} />
                </div>
                <p style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.assistant.usage.capLine', { spent: iso(formatUsd(spent)), cap: iso(formatUsd(capMicros)) })}</p>
              </>
            ) : (
              <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.usage.capNone')}</p>
            )}
            {cap?.daily_limit != null && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.usage.dailyLimit', { n: num(cap.daily_limit) })}</p>}
          </div>
        </Panel>
      )}

      {q.data && (
        <Panel title={tr('ws.owner.assistant.usage.pricingTitle')}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <DataTable columns={pricingColumns} rows={pricingRows} rowKey={([model]) => model} dense aria-label={tr('ws.owner.assistant.usage.pricingTitle')} />
            <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.usage.fallbackNote', { price: iso(formatUsd(fallback)) })}</p>
            {blended.length > 0 && (
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-warn-fg)' }}>{tr('ws.owner.assistant.usage.blendedNote', { models: blended.map((m) => iso(m)).join(', ') })}</p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
