/**
 * The words a discount is said in, in the screen's locale: a part ("20%",
 * "5,000 IQD"), a reason ("Coach"), and the label a bill row carries
 * ("Coach · 20%"; a court one-off keeps its own reason, a café one-off stores
 * none and reads "This bill · 20%").
 */
import { useLocale } from '../../lib/i18n';
import { formatPart, type DiscountPart, type DiscountReason } from './discountLogic';

export function useDiscountWords() {
  const { tr, locale } = useLocale();
  const part = (p: DiscountPart) => formatPart(p, locale, tr('ws.kit.common.percent'));
  const reason = (r: DiscountReason) => tr(`ws.discounts.reason.${r}`);
  /** A bill row's label: the reason (or "This bill") and the part. */
  const billLabel = (p: DiscountPart & { standing: boolean; reason?: DiscountReason | null }, standingReason: DiscountReason | null | undefined) => {
    const r = p.standing ? standingReason : p.reason;
    return `${r ? reason(r) : tr('ws.discounts.bill.once')} · ${part(p)}`;
  };
  /** "Café 20% · Court 5,000 IQD", the parts a customer has. */
  const parts = (d: { cafe: DiscountPart | null; court: DiscountPart | null }) =>
    [
      d.cafe ? `${tr('ws.discounts.part.cafeShort')} ${part(d.cafe)}` : null,
      d.court ? `${tr('ws.discounts.part.courtShort')} ${part(d.court)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return { part, reason, billLabel, parts };
}
