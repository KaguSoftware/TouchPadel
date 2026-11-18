import { useLocale } from '../../i18n/LocaleProvider';
import { useToast } from '../../components/overlays';
import { mapErrorToKey } from '../booking/errors';
import { useClaimCardReward } from './hooks';

/**
 * Redeem on the free drink and the card gifts (Majed, 2026-11-15), for the Club tab and Points &
 * rewards: one press at a time, "Redeemed" said once it holds, and the member code brought into
 * view (`onShowCode`) for an item, which the cashier scans. A court hour comes off a booking at
 * the desk, so it stays where it is. A refusal says why in the shared words (`mapErrorToKey`).
 */
export function useCardRedeem(onShowCode: () => void) {
  const { t } = useLocale();
  const toast = useToast();
  const claim = useClaimCardReward();
  const run = (kind: 'stamp' | 'gift', perkId: string | null, toCode: boolean) => {
    if (claim.isPending) return;
    claim.mutate(
      { kind, perkId },
      {
        onSuccess: () => {
          toast(t('loyalty.guest.redeem.done'), 'success');
          if (toCode) onShowCode();
        },
        onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
      },
    );
  };
  const busy = claim.isPending ? claim.variables : undefined;
  return {
    redeemDrink: () => run('stamp', null, true),
    redeemGift: (perkId: string, court = false) => run('gift', perkId, !court),
    drinkBusy: busy?.kind === 'stamp',
    giftBusyId: busy?.kind === 'gift' ? busy.perkId : null,
  };
}
