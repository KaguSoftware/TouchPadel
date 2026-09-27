/**
 * The day close's Shop block (0246, app.day_close_shop): the Touch Shop's own
 * money for the day, by method, its refunds and net, any sale left unpaid (it
 * holds close_day, 0216) and the shop PC's drawer. The venue's one close is
 * still the day close around it. Shows nothing on a day the shop never sold
 * or opened its drawer.
 */
import { useQuery } from '@tanstack/react-query';
import { formatIQD, formatTime } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { ErrorText } from '../../components/ui';
import { MessagePresenter, Money, Panel } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';

export interface DayCloseShopData {
  day_session_id: string;
  business_date: string;
  sales_iqd: number;
  by_method: Record<string, number>;
  refunds_iqd: number;
  net_iqd: number;
  settled_sales: number;
  open_sales: { tab_id: string; label: string | null; opened_at: string; total_iqd: number | null }[];
  shifts: {
    till_shift_id: string;
    station_id: string;
    staff_name: string;
    opened_at: string;
    closed_at: string | null;
    opening_float_iqd: number;
    cash_expected_iqd: number | null;
    cash_counted_iqd: number | null;
    cash_variance_iqd: number | null;
    card_payments_iqd: number | null;
  }[];
}

/** A day with nothing to show: no shop sale, nothing open, no shop drawer. */
export function shopDayIsEmpty(d: DayCloseShopData | undefined): boolean {
  return !d || (Number(d.sales_iqd) === 0 && Number(d.refunds_iqd) === 0 && d.open_sales.length === 0 && d.shifts.length === 0);
}

export function DayCloseShop({ daySessionId }: { daySessionId?: string | null }) {
  const { tr, locale } = useLocale();
  const q = useQuery({
    queryKey: ['dayClose', 'shop', daySessionId ?? 'open'] as const,
    queryFn: () => appRpc<DayCloseShopData>('day_close_shop', daySessionId ? { p_day_session_id: daySessionId } : {}),
    refetchInterval: 60_000,
  });
  const d = q.data;
  if (q.isError) {
    return (
      <Panel title={<CardTitle icon="tag">{tr('ws.shop.dayClose.title')}</CardTitle>}>
        <ErrorText error={q.error} />
      </Panel>
    );
  }
  if (shopDayIsEmpty(d)) return null;
  const methods = Object.entries(d!.by_method).filter(([, v]) => Number(v) !== 0);
  return (
    <Panel title={<CardTitle icon="tag">{tr('ws.shop.dayClose.title')}</CardTitle>} data-testid="day-close-shop">
      <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.shop.dayClose.lead')}
      </p>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--tp-sp-1) var(--tp-sp-3)', margin: 0 }}>
        <dt>{tr('ws.shop.dayClose.sales')}</dt>
        <dd style={{ margin: 0 }}><Money amount={Number(d!.sales_iqd)} /></dd>
        {methods.map(([method, amount]) => (
          <FragmentRow
            key={method}
            label={method === 'cash' || method === 'card' ? tr(`ws.shop.dayClose.method.${method}`) : tr('ws.shop.dayClose.method.other')}
            amount={Number(amount)}
          />
        ))}
        <dt>{tr('ws.shop.dayClose.refunds')}</dt>
        <dd style={{ margin: 0 }}><Money amount={-Number(d!.refunds_iqd)} /></dd>
        <dt style={{ fontWeight: 700 }}>{tr('ws.shop.dayClose.net')}</dt>
        <dd style={{ margin: 0 }}><Money amount={Number(d!.net_iqd)} strong /></dd>
      </dl>
      <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.shop.dayClose.settled', { count: d!.settled_sales })}
      </p>
      {d!.open_sales.length > 0 && (
        <MessagePresenter
          tone="refused"
          style={{ marginBlockStart: 'var(--tp-sp-3)' }}
          message={
            <>
              <strong>{tr('ws.shop.dayClose.openSales', { count: d!.open_sales.length })}</strong>
              <br />
              {tr('ws.shop.dayClose.openSalesHint')}
            </>
          }
        />
      )}
      <h3 style={{ fontSize: 'var(--tp-fs-sm)', margin: 0, marginBlockStart: 'var(--tp-sp-3)' }}>{tr('ws.shop.dayClose.drawers')}</h3>
      {d!.shifts.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.shop.dayClose.noDrawer')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {d!.shifts.map((s) => (
            <li key={s.till_shift_id} style={{ fontSize: 'var(--tp-fs-sm)' }}>
              <bdi>{s.staff_name}</bdi> · <span dir="ltr">{s.station_id}</span> ·{' '}
              {s.closed_at === null ? (
                tr('ws.shop.dayClose.drawerOpen', { time: formatTime(new Date(s.opened_at), locale) })
              ) : (
                <span>
                  {tr('ws.shop.dayClose.drawerCounted', {
                    counted: formatIQD(Number(s.cash_counted_iqd ?? 0), locale),
                    expected: formatIQD(Number(s.cash_expected_iqd ?? 0), locale),
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FragmentRow({ label, amount }: { label: string; amount: number }) {
  return (
    <>
      <dt style={{ paddingInlineStart: 'var(--tp-sp-3)', color: 'var(--tp-muted-fg)' }}>{label}</dt>
      <dd style={{ margin: 0, color: 'var(--tp-muted-fg)' }}><Money amount={amount} /></dd>
    </>
  );
}
