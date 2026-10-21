/**
 * The rewards a wage month carries (0333), one line each, as the Mark paid
 * dialog and a row's details list them: "October 2026: 200 orders, 50,000
 * IQD", and a prize as "October 2026: 300 orders, Dinner for two (hand
 * over)". The Touch Shop sales rewards (0355) follow: "October 2026: shop
 * sales of 250,000 IQD, 25,000 IQD". The amounts are the server's, copied
 * when the month they were reached in ended; nothing here adds them up.
 */
import { countPhrase, formatIQD, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { monthLabel } from '../deductions/venueDate';
import { bonusKind, type WageBonus, type WageShopReward } from './wagesLogic';

export function BonusList({
  bonuses,
  shopRewards = [],
  testId,
}: {
  bonuses: readonly WageBonus[];
  shopRewards?: readonly WageShopReward[];
  testId?: string;
}) {
  const { tr, locale } = useLocale();
  return (
    <ul data-testid={testId} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
      {bonuses.map((b) => {
        const vars = {
          month: b.earnedMonth ? monthLabel(b.earnedMonth, locale) : '',
          orders: countPhrase('ws.rewards.count.orders', b.target, locale),
          amount: isolate(formatIQD(b.rewardIqd, locale)),
          prize: isolate(b.prize ?? ''),
        };
        return (
          <li key={b.id} style={{ overflowWrap: 'anywhere' }}>
            {tr(`ws.wages.bonus.${bonusKind(b)}`, vars)}
          </li>
        );
      })}
      {shopRewards.map((s) => (
        <li key={s.id} style={{ overflowWrap: 'anywhere' }}>
          {tr('ws.wages.bonus.shopSales', {
            month: s.earnedMonth ? monthLabel(s.earnedMonth, locale) : '',
            sales: isolate(formatIQD(s.salesIqd, locale)),
            amount: isolate(formatIQD(s.rewardIqd, locale)),
          })}
        </li>
      ))}
    </ul>
  );
}
