/**
 * Analytics › Café, "Before the system" (0412): the old till's own view of
 * the picked range. It appears only when the range holds old-till days. The
 * Summary and the trend above already count those days; here they are read
 * the way the old till's reports give them: by month, by product group and by
 * product, under the till's own names. Three cards in the page's own chart
 * card, each with its table and CSV behind the card menu.
 */
import { formatMonthYear } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { ChartCard } from '../charts/ChartCard';
import { HBarChart } from '../charts/HBarChart';
import { Zone, ZoneRow, type ZoneDef } from '../Zone';
import type { Formatters } from '../format';
import { groupName, keptPct, oldTillTakeaway, productLabel, sharePct, type OldTillHistory } from './history';

/** The section in the jump-nav; listed only while the range holds old-till days. */
export const OLD_TILL_ZONE: ZoneDef = {
  id: 'oldtill',
  titleKey: 'ws.analytics.oldTill.zone',
  descKey: 'ws.analytics.oldTill.zoneDesc',
  navKey: 'ws.analytics.oldTill.zoneNav',
};

/** How many products the bar chart draws; the table behind it lists them all. */
const TOP_PRODUCTS = 10;
const ROW_PX = 30;

export function HistorySection({ history, f, rangeLabel }: { history: OldTillHistory; f: Formatters; rangeLabel: string }) {
  const { tr, locale } = useLocale();
  const c = (key: 'month' | 'days' | 'gross' | 'discounts' | 'net' | 'orders' | 'avg' | 'group' | 'units' | 'sales' | 'share' | 'costKnown' | 'kept' | 'product' | 'price' | 'unitCost') =>
    tr(`ws.analytics.oldTill.cols.${key}`);
  const unknown = tr('ws.analytics.oldTill.unknown');
  const pct = (n: number | null) => (n == null ? unknown : f.pct(n));
  const monthName = (iso: string) => formatMonthYear(new Date(`${iso}T12:00:00Z`), locale);

  const monthRows = history.months.map((m) => ({ label: monthName(m.month), value: m.netIqd }));
  const groupRows = history.groups.map((g) => ({ label: groupName(g.key, tr), value: g.grossIqd }));
  const top = history.products.slice(0, TOP_PRODUCTS);
  const productRows = top.map((p) => ({ label: productLabel(p, history.products, f), value: p.grossIqd }));

  return (
    <Zone zone={OLD_TILL_ZONE} lead={oldTillTakeaway(history, tr, f)}>
      <ZoneRow columns={3} min="20rem">
        <ChartCard
          title={tr('ws.analytics.oldTill.cards.months')}
          tip={tr('ws.analytics.oldTill.tips.months')}
          state="ready"
          height={Math.max(160, ROW_PX * monthRows.length + 40)}
          twin={{
            columns: [
              { key: 'month', label: c('month') },
              { key: 'days', label: c('days'), numeric: true },
              { key: 'gross', label: c('gross'), numeric: true },
              { key: 'discounts', label: c('discounts'), numeric: true },
              { key: 'net', label: c('net'), numeric: true },
              { key: 'orders', label: c('orders'), numeric: true },
              { key: 'avg', label: c('avg'), numeric: true },
            ],
            rows: history.months.map((m) => ({
              month: monthName(m.month),
              days: m.days,
              gross: m.grossIqd,
              // A month whose every day lacks a discount figure has none to print.
              discounts: m.discountUnknownDays === m.days ? unknown : m.discountIqd,
              net: m.netIqd,
              orders: m.orders,
              avg: m.orders > 0 ? Math.round(m.grossIqd / m.orders) : null,
            })),
            file: `old-till-months-${rangeLabel}`,
          }}
        >
          <HBarChart rows={monthRows} format={(n) => f.compact(n)} name={c('net')} axisWidth={110} />
        </ChartCard>

        <ChartCard
          title={tr('ws.analytics.oldTill.cards.groups')}
          tip={tr('ws.analytics.oldTill.tips.groups')}
          state="ready"
          height={Math.max(160, ROW_PX * groupRows.length + 40)}
          twin={{
            columns: [
              { key: 'group', label: c('group') },
              { key: 'units', label: c('units'), numeric: true },
              { key: 'sales', label: c('sales'), numeric: true },
              { key: 'share', label: c('share'), numeric: true },
              { key: 'costKnown', label: c('costKnown'), numeric: true },
              { key: 'kept', label: c('kept'), numeric: true },
            ],
            rows: history.groups.map((g) => ({
              group: groupName(g.key, tr),
              units: g.units,
              sales: g.grossIqd,
              share: pct(sharePct(g.grossIqd, history.items.grossIqd)),
              costKnown: g.costKnownGrossIqd,
              kept: pct(keptPct(g.costKnownGrossIqd, g.costIqd)),
            })),
            file: `old-till-groups-${rangeLabel}`,
          }}
        >
          <HBarChart rows={groupRows} format={(n) => f.compact(n)} name={c('sales')} axisWidth={170} />
        </ChartCard>

        <ChartCard
          title={tr('ws.analytics.oldTill.cards.products')}
          tip={tr('ws.analytics.oldTill.tips.products')}
          state="ready"
          height={Math.max(160, ROW_PX * productRows.length + 40)}
          twin={{
            columns: [
              { key: 'product', label: c('product') },
              { key: 'group', label: c('group') },
              { key: 'price', label: c('price'), numeric: true },
              { key: 'units', label: c('units'), numeric: true },
              { key: 'sales', label: c('sales'), numeric: true },
              { key: 'unitCost', label: c('unitCost'), numeric: true },
              { key: 'kept', label: c('kept'), numeric: true },
            ],
            rows: history.products.map((p) => ({
              product: p.product,
              group: groupName(p.group, tr),
              price: p.unitPriceIqd,
              units: p.units,
              sales: p.grossIqd,
              unitCost: p.unitCostIqd ?? unknown,
              kept: p.unitCostIqd == null ? unknown : pct(keptPct(p.unitPriceIqd, p.unitCostIqd)),
            })),
            file: `old-till-products-${rangeLabel}`,
          }}
        >
          <HBarChart rows={productRows} format={(n) => f.compact(n)} name={c('sales')} axisWidth={150} />
        </ChartCard>
      </ZoneRow>
    </Zone>
  );
}
