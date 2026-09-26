/**
 * The incident reads more than one screen shares (wave5-addendum-2026-09-25
 * §5.2). QK.incidentsOpen holds the Open tab's first page as returned: its
 * open_count is the rail badge, which counts for management only (the desk
 * and the till never read app.incidents_page, which refuses them). Every
 * other read sits under the same ['incidents'] root, so one invalidation
 * after a report, a review or a redaction refreshes them all.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { INCIDENTS_PAGE_SIZE, MY_INCIDENTS_LIMIT } from './incidentsLogic';

export function fetchIncidentsOpen(): Promise<unknown> {
  return appRpc<unknown>('incidents_page', { p_filter: 'open', p_limit: INCIDENTS_PAGE_SIZE, p_offset: 0 });
}

export function fetchMyIncidents(): Promise<unknown> {
  return appRpc<unknown>('my_incidents', { p_limit: MY_INCIDENTS_LIMIT });
}

/** Feature-private keys, all under ['incidents'] (QK.incidentsOpen is ['incidents', 'open']). */
export const IK = {
  all: ['incidents'] as const satisfies QueryKey,
  page: (filter: string, offset: number) => ['incidents', 'page', filter, offset] as const satisfies QueryKey,
  mine: ['incidents', 'mine'] as const satisfies QueryKey,
} as const;
