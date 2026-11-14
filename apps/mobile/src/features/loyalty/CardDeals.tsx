import { useLocale } from '../../i18n/LocaleProvider';
import { useToast } from '../../components/overlays';
import { mapErrorToKey } from '../booking/errors';
import { useVenueSettings } from '../availability/hooks';
import { DEFAULT_TZ } from '../availability/assemble';
import { DealsSection } from './DealCards';
import { usableDeals } from './deals';
import { useMyDeals, usePickDeal } from './hooks';

/**
 * The deals under the member card on the Club tab (Majed, 2026-11-13): the ones the guest can use
 * right now or later, the same deal cards as Points & rewards (DealCards.tsx), so a deal looks and
 * acts the same in both places. Locked and used deals stay on Points & rewards (`usableDeals`).
 *
 * The code is right above, so "Use at the cashier" and "Show my card" do not leave the tab: they
 * bring the code back into view (`onShowCard`), where the picked deal is now named on the paper
 * (DealNote). With no deal to use, or no answer, it draws nothing at all.
 */
export function CardDeals({
  testID,
  points12m,
  onShowCard,
}: {
  /** `<route>`; the section takes `${testID}.deals`, each deal DealsSection's ids under it. */
  testID: string;
  /** The member's points in the last 12 months (`my_loyalty.points_12m`). */
  points12m: number;
  /** Brings the member card's code into view. */
  onShowCard: () => void;
}) {
  const { t } = useLocale();
  const deals = useMyDeals(true);
  const pick = usePickDeal();
  const toast = useToast();
  const tz = useVenueSettings().data?.timezone ?? DEFAULT_TZ;

  const use = (id: string) => {
    if (pick.isPending) return;
    pick.mutate(id, {
      onSuccess: onShowCard,
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };
  const clear = () => {
    if (pick.isPending) return;
    pick.mutate(null, {
      onSuccess: () => toast(t('loyalty.guest.deals.cleared'), 'info'),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };

  return (
    <DealsSection
      testID={testID}
      deals={usableDeals(deals.data)}
      points12m={points12m}
      tz={tz}
      pending={pick.isPending ? pick.variables : undefined}
      onUse={use}
      onShowCard={onShowCard}
      onClear={clear}
    />
  );
}
