/**
 * Margins per menu item (SOW L538-540) — v_item_margin, costed from the
 * latest batch (pack cost fallback). A menu that quietly loses money per sale
 * is what this page catches, so it leads with how many items lose money or
 * run thin, each with a button that narrows the table to exactly those.
 * Every figure is the view's own.
 *
 * "COGS" is now "Cost to make", the thin-margin line is stated (under 30%)
 * instead of implied by an unexplained badge, and the empty state says why a
 * menu item might be missing (it has no recipe) with the way to fix it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, Money, PageHeader, Panel, ResultCount, SearchField, SegmentedControl, StatusBadge, TableSkeleton, Toolbar, asyncStatus, type Column } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { AttentionList } from './stockUi';
import { THIN_MARGIN_PERCENT, marginFlag, type MarginFlag } from './stockLogic';
import { SK } from './stockKeys';

interface MarginRow {
  variant_id: string;
  item_name_en: string;
  item_name_ar: string;
  variant_name_en: string;
  variant_name_ar: string;
  price_iqd: number;
  cogs_iqd: number;
  margin_iqd: number;
  margin_percent: number | null;
}

type Show = 'all' | 'loss' | 'thin';

export function Margins() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const [show, setShow] = useState<Show>('all');
  const [query, setQuery] = useState('');

  const marginsQ = useQuery({
    queryKey: SK.margins,
    queryFn: async (): Promise<MarginRow[]> => {
      const { data, error } = await supabase.from('v_item_margin').select('*').order('margin_percent', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as MarginRow[];
    },
  });

  const all = marginsQ.data ?? [];
  const itemName = (r: MarginRow) => pickName(locale, { name_en: r.item_name_en, name_ar: r.item_name_ar });
  const sizeName = (r: MarginRow) => pickName(locale, { name_en: r.variant_name_en, name_ar: r.variant_name_ar });
  const q = query.trim().toLowerCase();
  const rows = all
    .filter((r) => show === 'all' || marginFlag(r) === show)
    .filter((r) => q === '' || `${r.item_name_en} ${r.item_name_ar} ${r.variant_name_en} ${r.variant_name_ar}`.toLowerCase().includes(q));
  const count = (flag: MarginFlag) => all.filter((r) => marginFlag(r) === flag).length;

  const columns: Column<MarginRow>[] = [
    {
      key: 'item',
      header: tr('ws.manager.stock.margins.item'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <bdi>{itemName(r)}</bdi>
          <bdi style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{sizeName(r)}</bdi>
        </span>
      ),
    },
    { key: 'price', header: tr('ws.manager.stock.margins.price'), numeric: true, render: (r) => <Money amount={r.price_iqd} /> },
    { key: 'cost', header: tr('ws.manager.stock.margins.cost'), numeric: true, render: (r) => <Money amount={r.cogs_iqd} /> },
    {
      key: 'margin',
      header: tr('ws.manager.stock.margins.margin'),
      numeric: true,
      render: (r) => <Money amount={r.margin_iqd} strong style={{ color: r.margin_iqd < 0 ? 'var(--tp-danger-fg)' : undefined }} />,
    },
    {
      key: 'pct',
      header: tr('ws.manager.stock.margins.marginPct'),
      numeric: true,
      render: (r) => {
        const flag = marginFlag(r);
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', justifyContent: 'flex-end' }}>
            {flag && <StatusBadge size="sm" tone={flag === 'loss' ? 'danger' : 'warn'} label={tr(`ws.manager.stock.margins.flag.${flag}`)} />}
            <span dir="ltr">{r.margin_percent === null ? '—' : `${formatNumber(r.margin_percent, locale)}${tr('ws.kit.common.percent')}`}</span>
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={tr('op.stockNav.margins')} subtitle={tr('ws.manager.stock.margins.lead')} />
      <AsyncStateWrapper
        status={asyncStatus(marginsQ, (d) => d.length === 0)}
        error={marginsQ.error}
        onRetry={() => void marginsQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={
          <EmptyState
            icon="chart"
            title={tr('ws.manager.stock.margins.empty')}
            body={tr('ws.manager.stock.margins.emptyBody')}
            action={
              <Button kind="primary" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock/recipes' })}>
                {tr('op.stockNav.recipes')}
              </Button>
            }
          />
        }
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <Panel title={<CardTitle icon="trendDown">{tr('ws.manager.stock.margins.now')}</CardTitle>}>
            <AttentionList
              clear={tr('ws.manager.stock.margins.clear', { pct: formatNumber(THIN_MARGIN_PERCENT, locale) })}
              items={[
                {
                  key: 'loss',
                  count: count('loss'),
                  tone: 'danger',
                  title: tr('ws.manager.stock.margins.loss'),
                  hint: tr('ws.manager.stock.margins.lossHint'),
                  action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => setShow('loss') },
                },
                {
                  key: 'thin',
                  count: count('thin'),
                  tone: 'warn',
                  title: tr('ws.manager.stock.margins.thin', { pct: formatNumber(THIN_MARGIN_PERCENT, locale) }),
                  hint: tr('ws.manager.stock.margins.thinHint'),
                  action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => setShow('thin') },
                },
              ]}
            />
          </Panel>

          <div>
            <Toolbar end={<ResultCount shown={rows.length} total={all.length} />}>
              <SegmentedControl<Show>
                value={show}
                onChange={setShow}
                aria-label={tr('ws.manager.stock.onHand.table.show')}
                options={[
                  { value: 'all', label: tr('ws.kit.common.all') },
                  { value: 'loss', label: tr('ws.manager.stock.margins.flag.loss') },
                  { value: 'thin', label: tr('ws.manager.stock.margins.flag.thin') },
                ]}
              />
              <span style={{ inlineSize: '16rem', maxInlineSize: '100%' }}>
                <SearchField value={query} onChange={setQuery} placeholder={tr('ws.manager.stock.margins.search')} />
              </span>
            </Toolbar>
            {rows.length === 0 ? (
              <EmptyState
                kind="filtered"
                onClearFilters={() => {
                  setShow('all');
                  setQuery('');
                }}
              />
            ) : (
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.variant_id} aria-label={tr('op.stockNav.margins')} />
            )}
          </div>
        </div>
      </AsyncStateWrapper>
    </div>
  );
}
