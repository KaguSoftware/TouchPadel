/**
 * The guest bill — SOW L456, "Printed or on-screen bill for the guest".
 *
 * There was neither. The till could take the money and had no way to show the
 * guest what they were paying for, which is also the thing a cashier hands
 * across when a total is questioned.
 *
 * On-screen satisfies the clause today; the thermal path (L425-433, Arabic
 * composed as a rendered image because low-cost printers cannot shape it from
 * their built-in fonts) is the Electron half and lands with the print pipeline.
 * This component is deliberately the same markup either way: `GlobalStyles`
 * already carries a print stylesheet keyed on `data-no-print`, so the browser's
 * own print is a usable stopgap on a station whose printer is not installed yet.
 *
 * Money comes from `tabTotals`, the same computation the settle buttons use —
 * a bill that disagrees with the amount charged is worse than no bill.
 */
import { formatIQD, formatTime } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import type { TabTotals } from './tabTotals';

export interface BillLine {
  id: string;
  qty: number;
  line_total_iqd: number;
  voided: boolean;
  menu_item: { name_en: string; name_ar: string } | null;
  variant: { name_en: string; name_ar: string } | null;
  order_item_modifiers: {
    qty: number;
    price_delta_iqd: number;
    modifier: { name_en: string; name_ar: string } | null;
  }[];
}

export interface BillOrder {
  id: string;
  status: string;
  order_items: BillLine[];
}

export function BillView({
  venueName,
  heading,
  orders,
  totals,
  payments,
  taxInclusive,
  onClose,
}: {
  venueName: string;
  /** Table number, guest name or tab label — whatever identifies this bill. */
  heading: string;
  orders: readonly BillOrder[];
  totals: TabTotals;
  payments: readonly { id: string; method: string; amount_iqd: number }[];
  taxInclusive: boolean;
  onClose(): void;
}) {
  const { tr, locale } = useLocale();
  const lines = orders
    .filter((o) => o.status !== 'voided')
    .flatMap((o) => o.order_items.filter((i) => !i.voided));

  return (
    <Modal title={tr('op.till.bill')} onClose={onClose}>
      {/* data-bill so the print stylesheet can isolate it from the shell. */}
      <div data-bill style={{ fontSize: '0.9rem' }}>
        <div style={{ textAlign: 'center', marginBlockEnd: '0.6rem' }}>
          <div style={{ fontWeight: 700 }}>{venueName}</div>
          <div style={{ color: 'var(--tp-muted-fg)' }}>{heading}</div>
          <div style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
            {formatTime(new Date(), locale)}
          </div>
        </div>

        <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td style={{ textAlign: 'start', paddingBlock: '0.15rem' }}>
                  {l.qty}× {pickName(locale, l.menu_item)}
                  {l.variant && ` (${pickName(locale, l.variant)})`}
                  {/* Modifiers are itemised: "why is this 1,000 more?" is the
                      most common question a bill has to answer by itself. */}
                  {l.order_item_modifiers.length > 0 && (
                    <div style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
                      {l.order_item_modifiers
                        .map((m) => pickName(locale, m.modifier))
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'end', whiteSpace: 'nowrap', paddingBlock: '0.15rem' }}>
                  {formatIQD(l.line_total_iqd, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr style={{ border: 'none', borderBlockStart: '1px solid var(--tp-border)' }} />

        <BillRow label={tr('common.subtotal')} value={formatIQD(totals.subtotal, locale)} />
        {totals.discount > 0 && (
          <BillRow label={tr('common.discount')} value={`−${formatIQD(totals.discount, locale)}`} />
        )}
        {totals.tax > 0 && (
          <BillRow
            // SOW L708-710: the rate is configurable and shown SEPARATELY on the
            // bill. When it is inclusive it is stated as already contained
            // rather than added again.
            label={taxInclusive ? tr('op.till.taxIncluded') : tr('op.till.tax')}
            value={formatIQD(totals.tax, locale)}
          />
        )}
        <BillRow label={tr('common.total')} value={formatIQD(totals.total, locale)} strong />

        {payments.map((p) => (
          <BillRow
            key={p.id}
            label={tr(p.method === 'cash' ? 'op.till.payCash' : 'op.till.payCard')}
            value={`−${formatIQD(p.amount_iqd, locale)}`}
          />
        ))}
        {totals.due > 0 && (
          <BillRow
            label={tr('op.till.remaining', { amount: formatIQD(totals.due, locale) })}
            value=""
          />
        )}

        <p style={{ textAlign: 'center', color: 'var(--tp-muted-fg)', marginBlockStart: '0.8rem' }}>
          {tr('op.till.billThanks')}
        </p>
      </div>

      <div data-no-print style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.close')}</Button>
        <Button kind="primary" onClick={() => window.print()}>
          {tr('op.till.printBill')}
        </Button>
      </div>
    </Modal>
  );
}

function BillRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '0.5rem',
        fontWeight: strong ? 700 : 400,
        paddingBlock: '0.1rem',
      }}
    >
      <span>{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );
}
