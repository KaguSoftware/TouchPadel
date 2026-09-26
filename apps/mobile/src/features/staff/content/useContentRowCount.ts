/**
 * The content row's count on Today (wave5-addendum-2026-09-25 §5.3): for the
 * owner, the posts waiting for a decision ("Content for approval (N)"); for
 * marketing, the ones sent back for changes ("(N to change)"). Each is the
 * content page's own read under the same key, so a decision or a new version
 * there moves the number here. Nobody else reads content (§8 Q14).
 */
import { useQuery } from '@tanstack/react-query';
import type { StaffRole } from '@touch/core';
import { staffKeys } from '../keys';
import { fetchContentPage } from './api';
import { contentAccess } from './logic';

export function useContentRowCount(
  venueId: string | null,
  role: StaffRole | null,
): { count: number; changes: boolean } {
  const access = role ? contentAccess(role) : { sends: false, decides: false };
  const on = !!venueId && (access.sends || access.decides);
  const filter = access.sends ? 'changes' : 'waiting';
  const page = useQuery({
    queryKey: staffKeys.content(venueId ?? '', filter),
    queryFn: () => fetchContentPage(venueId ?? '', filter),
    enabled: on,
  });
  if (!on || !page.data) return { count: 0, changes: access.sends };
  return {
    count: access.sends ? page.data.total : page.data.waiting_count,
    changes: access.sends,
  };
}
