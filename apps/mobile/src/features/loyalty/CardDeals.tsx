import { useVenueSettings } from '../availability/hooks';
import { DEFAULT_TZ } from '../availability/assemble';
import { DealsSection } from './DealCards';
import { usableDeals } from './deals';
import { useMyDeals } from './hooks';

/**
 * The deals on the Club tab, under the member card (Majed, 2026-11-13; compact tiles and a deal's
 * own QR since 2026-11-15): the ones the guest can use now or later. Locked and used deals are
 * left out (`usableDeals`); Points & rewards shows no deals at all since 2026-11-15. With no deal
 * to use, or no answer, it draws nothing.
 */
export function CardDeals({
  testID,
  points12m,
}: {
  /** `<route>`; the section takes `${testID}.deals`, each deal DealsSection's ids under it. */
  testID: string;
  /** The member's points in the last 12 months (`my_loyalty.points_12m`). */
  points12m: number;
}) {
  const deals = useMyDeals(true);
  const tz = useVenueSettings().data?.timezone ?? DEFAULT_TZ;
  return <DealsSection testID={testID} deals={usableDeals(deals.data)} points12m={points12m} tz={tz} />;
}
