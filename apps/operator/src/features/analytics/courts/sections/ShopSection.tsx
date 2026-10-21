/**
 * Touch Shop on the Courts tab (0346): shop sales are padel revenue, so they
 * sit with the courts rather than the cafe. Laid out like the summary: two
 * lead figures (what the shop took, what it kept after cost), the supporting
 * counts as rows, then the day chart beside the products that sold, and the
 * hour and section views folded behind "Show more".
 *
 * The shop is not tied to a court: with a court selected the figures stay the
 * whole shop's and the section says so once. A period with no shop sale in
 * either window prints one sentence instead of empty charts.
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { card } from '../../../../components/ui';
import { DataTable, type Column } from '../../../../components/kit';
import { FigureGroup, FigureLine, Kpi } from '../../cards/Kpi';
import { CardShell } from '../../cards/CardShell';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { Donut, RingMeter } from '../../charts/Donut';
import { TrendArea } from '../../charts/TrendArea';
import { useChartColors } from '../../charts/colors';
import { dayLabeler, daySeries } from '../../spark';
import { barTwin } from '../../charts/twins';
import { MoreCharts, ZoneGrid, gridColumns } from '../../Zone';
import type { Formatters } from '../../format';
import { fillShopDays, shopDelta, type ShopItem } from '../shop';
import type { ShopData } from '../useShopData';

const TOP_PRODUCTS = 8;

export function ShopSection({
  shop,
  f,
  range,
  rangeLabel,
  courtFiltered,
}: {
  shop: ShopData;
  f: Formatters;
  range: { from: string; to: string };
  rangeLabel: string;
  courtFiltered: boolean;
}) {
  const { tr, locale } = useLocale();
  const { RING_1, RING_2, RING_3, RING_MUTED } = useChartColors();
  const k = shop.current?.kpis;
  const kp = shop.previous?.kpis ?? null;
  const loading = shop.state === 'loading';
  const broken = shop.state === 'error';
  const common = { loading, unavailable: broken, f };
  const was = (value: number | null | undefined, fmt: (n: number) => string) => (kp && value != null ? fmt(value) : null);
  const delta = (pick: Parameters<typeof shopDelta>[2]) => shopDelta(shop.current, shop.previous, pick);
  const state = shop.state;

  if (state === 'ready' && (k?.sales ?? 0) === 0 && (kp?.sales ?? 0) === 0) {
    return <p style={{ ...card, margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.shop.empty')}</p>;
  }

  const days = fillShopDays(range.from, range.to, shop.current?.byDay ?? []);
  // The year joins a day's label once the period crosses into another year.
  const dayLabel = dayLabeler(range, f.date);
  const dayRows = days.map((d) => ({ label: dayLabel(d.date), value: d.netIqd }));
  const hourRows = (shop.current?.byHour ?? []).map((h) => ({ label: f.hour(h.hour), value: h.netIqd }));
  // The server sorts sections by revenue. The ring shows the first three and folds the rest into
  // "Other" (dataviz: no more than four parts, a fourth hue is never generated); the table twin keeps every section.
  const sectionRows = (shop.current?.categories ?? []).map((c) => ({ label: pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.categoryId, value: c.netIqd, key: c.categoryId }));
  const SECTION_COLORS = [RING_1, RING_2, RING_3];
  const rest = sectionRows.slice(3).reduce((n, r) => n + Math.max(0, r.value), 0);
  const sectionSlices = [
    ...sectionRows.slice(0, 3).map((r, i) => ({ key: r.key, label: r.label, value: r.value, color: SECTION_COLORS[i]! })),
    ...(rest > 0 ? [{ key: 'other', label: tr('ws.analytics.viz.other'), value: rest, color: RING_MUTED }] : []),
  ];
  const salesSpark = daySeries(range, shop.current?.byDay, (d) => d.netIqd, dayLabel, f.compact);
  const items = (shop.current?.items ?? []).slice(0, TOP_PRODUCTS);
  const productName = (i: ShopItem) => {
    const name = pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.itemId;
    const size = pickLocale({ en: i.variantEn, ar: i.variantAr }, locale);
    return size ? `${name} · ${size}` : name;
  };
  const itemColumns: Column<ShopItem>[] = [
    { key: 'product', header: tr('ws.analytics.shop.cols.product'), render: productName, truncate: true, truncateTitle: productName },
    { key: 'units', header: tr('ws.analytics.shop.cols.units'), numeric: true, render: (r) => f.num(r.units) },
    { key: 'revenue', header: tr('ws.analytics.shop.cols.revenue'), numeric: true, render: (r) => f.money(r.netIqd) },
    {
      key: 'margin',
      header: tr('ws.analytics.shop.cols.margin'),
      numeric: true,
      render: (r) => (r.marginIqd == null ? <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.shop.noCost')}</span> : f.money(r.marginIqd)),
    },
  ];
  const noSalesNow = state === 'ready' && (k?.sales ?? 0) === 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {courtFiltered && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.shop.note.wholeShop')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: gridColumns(3, '13rem'), gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
        <Kpi
          tone="green"
          label={tr('ws.analytics.shop.kpi.sales')}
          value={f.money(k?.netIqd ?? 0)}
          delta={delta((x) => x.netIqd)}
          previous={was(kp?.netIqd, f.money)}
          tip={tr('ws.analytics.shop.tips.sales')}
          spark={salesSpark}
          note={k && k.sales > 0 ? tr('ws.analytics.shop.note.methods', { cash: f.compact(k.cashIqd), card: f.compact(k.cardIqd) }) : undefined}
          {...common}
        />
        <Kpi
          tone="violet"
          label={tr('ws.analytics.shop.kpi.margin')}
          value={k?.marginIqd == null ? '—' : f.money(k.marginIqd)}
          delta={delta((x) => x.marginIqd)}
          previous={was(kp?.marginIqd, f.money)}
          tip={tr('ws.analytics.shop.tips.margin')}
          aside={
            k?.marginPct == null ? undefined : (
              <RingMeter pct={k.marginPct} size={52} label={tr('ws.analytics.viz.meter', { label: tr('ws.analytics.shop.kpi.margin'), pct: f.pct(k.marginPct) })} />
            )
          }
          note={
            k && k.units > 0
              ? k.costedUnits > 0
                ? `${k.marginPct == null ? '' : `${f.pct(k.marginPct)} · `}${tr('ws.analytics.shop.note.costed', { n: f.num(k.costedUnits), total: f.num(k.units) })}`
                : tr('ws.analytics.shop.noCost')
              : undefined
          }
          {...common}
        />
        {/* A Breakdown card on its own beside the lead tiles (Sait, 2026-10-19). */}
        <FigureGroup tone="rose" alone title={tr('ws.analytics.courts.zones.shopNav')}>
          <FigureLine
            label={tr('ws.analytics.shop.kpi.count')}
            value={f.num(k?.sales ?? 0)}
            delta={delta((x) => x.sales)}
            previous={was(kp?.sales, f.num)}
            tip={tr('ws.analytics.shop.tips.count')}
            {...common}
          />
          <FigureLine
            label={tr('ws.analytics.shop.kpi.avgSale')}
            value={k?.avgSaleIqd == null ? '—' : f.money(k.avgSaleIqd)}
            delta={delta((x) => x.avgSaleIqd)}
            previous={was(kp?.avgSaleIqd, f.money)}
            tip={tr('ws.analytics.shop.tips.avgSale')}
            {...common}
          />
          <FigureLine
            label={tr('ws.analytics.shop.kpi.units')}
            value={f.num(k?.units ?? 0)}
            delta={delta((x) => x.units)}
            previous={was(kp?.units, f.num)}
            tip={tr('ws.analytics.shop.tips.units')}
            {...common}
          />
          <FigureLine
            label={tr('ws.analytics.shop.kpi.refunds')}
            value={f.money(k?.refundsIqd ?? 0)}
            previous={was(kp?.refundsIqd, f.money)}
            invert
            tip={tr('ws.analytics.shop.tips.refunds')}
            note={k && k.refundedSales > 0 ? tr('ws.analytics.shop.note.refunded', { n: f.num(k.refundedSales) }) : undefined}
            {...common}
          />
        </FigureGroup>
      </div>
      <ZoneGrid columns={2}>
        <ChartCard
          title={tr('ws.analytics.shop.cards.byDay')}
          tip={tr('ws.analytics.shop.tips.byDay')}
          state={noSalesNow ? 'empty' : state}
          refreshing={shop.refreshing}
          emptyKey="ws.analytics.shop.empty"
          height={220}
          twin={barTwin(dayRows, tr('ws.analytics.shop.cols.day'), tr('ws.analytics.shop.cols.revenue'), `shop-by-day-${rangeLabel}`)}
        >
          <TrendArea rows={dayRows} format={(n) => f.compact(n)} name={tr('ws.analytics.shop.cols.revenue')} interval={dayRows.length > 14 ? Math.ceil(dayRows.length / 10) - 1 : 0} />
        </ChartCard>
        <CardShell
          title={tr('ws.analytics.shop.cards.products')}
          tip={tr('ws.analytics.shop.tips.products')}
          state={noSalesNow || (state === 'ready' && items.length === 0) ? 'empty' : state}
          refreshing={shop.refreshing}
          emptyKey="ws.analytics.shop.empty"
        >
          <DataTable<ShopItem> columns={itemColumns} rows={items} rowKey={(r) => `${r.itemId}:${r.variantId}`} dense aria-label={tr('ws.analytics.shop.cards.products')} />
        </CardShell>
      </ZoneGrid>
      <MoreCharts id="courts-shop" count={state === 'ready' && !noSalesNow ? 2 : 0}>
        <ZoneGrid columns={2}>
          <ChartCard
            title={tr('ws.analytics.shop.cards.byHour')}
            tip={tr('ws.analytics.shop.tips.byHour')}
            state={hourRows.length === 0 && state === 'ready' ? 'empty' : state}
            refreshing={shop.refreshing}
            emptyKey="ws.analytics.shop.empty"
            height={200}
            twin={barTwin(hourRows, tr('ws.analytics.shop.cols.hour'), tr('ws.analytics.shop.cols.revenue'), `shop-by-hour-${rangeLabel}`)}
          >
            <CountBars rows={hourRows} format={(n) => f.compact(n)} name={tr('ws.analytics.shop.cols.revenue')} />
          </ChartCard>
          <ChartCard
            title={tr('ws.analytics.shop.cards.sections')}
            tip={tr('ws.analytics.shop.tips.sections')}
            state={sectionRows.length === 0 && state === 'ready' ? 'empty' : state}
            refreshing={shop.refreshing}
            emptyKey="ws.analytics.shop.empty"
            height={200}
            twin={barTwin(sectionRows, tr('ws.analytics.shop.cards.sections'), tr('ws.analytics.shop.cols.revenue'), `shop-by-section-${rangeLabel}`)}
          >
            <Donut
              slices={sectionSlices}
              format={(n) => f.compact(n)}
              pct={(n) => f.pct(n)}
              total={f.compact(sectionRows.reduce((n, r) => n + Math.max(0, r.value), 0))}
              caption={tr('ws.analytics.shop.cols.revenue')}
              label={tr('ws.analytics.shop.cards.sections')}
              size={150}
            />
          </ChartCard>
        </ZoneGrid>
      </MoreCharts>
    </div>
  );
}
