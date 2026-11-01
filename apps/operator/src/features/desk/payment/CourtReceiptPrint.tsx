/**
 * F-30: "Print receipt" on the court fee panel, with the shared print status
 * (Print again, a clear message and a monitoring report when the printer is
 * missing or fails). The receipt is courtReceipt.ts's lines in the till
 * bill's document (buildReceiptDoc), so desk and café paper look alike.
 */
import { useCallback } from 'react';
import { formatDateTime, formatIQD, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button } from '../../../components/ui';
import { PrintStatus, usePrint } from '../../../components/PrintStatus';
import { buildReceiptDoc } from '../../till/BillView';
import { courtReceiptBody, courtReceiptLines, hasCourtReceipt, type ReceiptLineKey } from './courtReceipt';
import type { BookingBill } from './deskPaymentLogic';

const LABEL: Record<Exclude<ReceiptLineKey, 'cafeItems'>, MessageKey> = {
  courtFee: 'ws.courtDesk.payment.courtFee',
  courtFeeRest: 'ws.courtDesk.payment.courtFeeRest',
  discount: 'ws.courtDesk.payment.discount',
  tax: 'ws.courtDesk.payment.tax',
  total: 'ws.courtDesk.payment.total',
  paidOnline: 'ws.courtDesk.payment.paidOnline',
  paidSoFar: 'ws.courtDesk.payment.paidSoFar',
  due: 'ws.courtDesk.payment.due',
  paidCash: 'ws.courtDesk.receipt.paidCash',
  paidCard: 'ws.courtDesk.receipt.paidCard',
  change: 'ws.courtDesk.receipt.change',
  refunded: 'ws.courtDesk.receipt.refunded',
};

export function CourtReceiptPrint({ bill, tz }: { bill: BookingBill; tz: string }) {
  const { tr, locale, dir } = useLocale();

  const build = useCallback((): string | null => {
    if (!hasCourtReceipt(bill)) return null;
    const r = bill.reservation;
    const court = pickName(locale, r.court_name_en || r.court_name_ar ? { name_en: r.court_name_en ?? '', name_ar: r.court_name_ar ?? '' } : null);
    const when = `${formatDateTime(new Date(r.start_at), locale, tz)} – ${formatTime(new Date(r.end_at), locale, tz)}`;
    const meta = [
      court ? `${tr('ws.courtDesk.receipt.court')}: ${court}` : null,
      `${tr('ws.courtDesk.receipt.time')}: ${when}`,
      r.guest_name ? `${tr('ws.courtDesk.receipt.guest')}: ${r.guest_name}` : null,
    ].filter((m): m is string => m !== null);
    const rows = courtReceiptLines(bill).map((line) => ({
      label:
        line.key === 'cafeItems'
          ? tr('ws.courtDesk.payment.cafeItems', { count: formatNumber(line.count ?? 0, locale) })
          : tr(LABEL[line.key]),
      value: line.amount < 0 ? `−${formatIQD(-line.amount, locale)}` : formatIQD(line.amount, locale),
      strong: line.strong,
    }));
    const body = courtReceiptBody({
      venue: tr('common.appName'),
      heading: tr('ws.courtDesk.receipt.heading'),
      meta,
      printedAt: formatDateTime(new Date(), locale, tz),
      rows,
      thanks: tr('ws.courtDesk.receipt.thanks'),
    });
    return buildReceiptDoc(body, dir);
  }, [bill, tz, locale, dir, tr]);

  // Browser mode prints the receipt alone: the panel behind it is not a bill.
  const printer = usePrint('court_receipt', build, 'document');
  if (!hasCourtReceipt(bill)) return null;
  return (
    <div data-no-print style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
      <Button
        icon="printer"
        data-testid="court-receipt-print"
        busy={printer.state === 'printing'}
        onClick={() => void printer.print()}
      >
        {tr('ws.courtDesk.receipt.print')}
      </Button>
      <PrintStatus printer={printer} />
    </div>
  );
}
