/**
 * Management's Today row count, "Incidents (N to review)"
 * (wave5-addendum-2026-09-25 §5.3): the incidents page's own Open read under
 * the same key, so a review there moves the number here. The viewer's own
 * open reports come off it (toReviewCount): nobody reviews their own.
 */
import { useQuery } from '@tanstack/react-query';
import { staffKeys } from '../keys';
import { fetchIncidentsPage } from './api';
import { toReviewCount } from './logic';

export function useToReviewCount(venueId: string | null, enabled: boolean): number {
  const on = enabled && !!venueId;
  const page = useQuery({
    queryKey: staffKeys.incidents(venueId ?? '', 'open'),
    queryFn: () => fetchIncidentsPage(venueId ?? '', 'open'),
    enabled: on,
  });
  return on ? toReviewCount(page.data) : 0;
}
