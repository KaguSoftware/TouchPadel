/**
 * COGS + gross margin per menu item (SOW L538-540) — v_item_margin, costed
 * from the latest batch (pack cost fallback). Low/negative margins surface
 * first; a menu that quietly loses money per sale is what this page catches.
 * Every figure is the view's own.
 */
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { AsyncStateWrapper, DataTable, EmptyState, Money, PageHeader, StatusBadge, asyncStatus, type Column } from '../../components/kit';
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

export function Margins() {
  const { tr, locale } = useLocale();

  const marginsQ = useQuery({
    queryKey: SK.margins,
    queryFn: async (): Promise<MarginRow[]> => {
      const { data, error } = await supabase.from('v_item_margin').select('*').order('margin_percent', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as MarginRow[];
    },
  });

  const columns: Column<MarginRow>[] = [
    {
      key: 'item',
      header: tr('op.stock.item'),
      render: (r) => (
        <span>
          <bdi>{pickName(locale, { name_en: r.item_name_en, name_ar: r.item_name_ar })}</bdi>{' '}
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
            (<bdi>{pickName(locale, { name_en: r.variant_name_en, name_ar: r.variant_name_ar })}</bdi>)
          </span>
        </span>
      ),
    },
    { key: 'price', header: tr('op.stock.price'), numeric: true, render: (r) => <Money amount={r.price_iqd} /> },
    { key: 'cogs', header: tr('op.stock.cogs'), numeric: true, render: (r) => <Money amount={r.cogs_iqd} /> },
    {
      key: 'margin',
      header: tr('op.stock.margin'),
      numeric: true,
      render: (r) => {
        const bad = r.margin_iqd < 0;
        const thin = !bad && (r.margin_percent ?? 100) < 30;
        return (
          <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
            {bad && <StatusBadge size="sm" tone="danger" label={tr('ws.manager.stock.margins.negative')} />}
            {thin && <StatusBadge size="sm" tone="warn" label={tr('ws.manager.stock.margins.thin')} />}
            <Money amount={r.margin_iqd} strong />
          </span>
        );
      },
    },
    { key: 'pct', header: '%', numeric: true, render: (r) => (r.margin_percent === null ? '—' : <span dir="ltr">{formatNumber(r.margin_percent, locale)}%</span>) },
  ];

  return (
    <div>
      <PageHeader title={tr('op.stock.marginsTitle')} subtitle={tr('ws.manager.stock.margins.lead')} />
      <AsyncStateWrapper
        status={asyncStatus(marginsQ, (d) => d.length === 0)}
        error={marginsQ.error}
        onRetry={() => void marginsQ.refetch()}
        emptyContent={<EmptyState icon="chart" title={tr('op.stock.noRecipes')} />}
      >
        <DataTable dense columns={columns} rows={marginsQ.data ?? []} rowKey={(r) => r.variant_id} aria-label={tr('op.stock.marginsTitle')} />
      </AsyncStateWrapper>
    </div>
  );
}
