/**
 * The Monitoring page's reads (0393). Every key sits under ['monitoring'].
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { PAGE_SIZE, bucketFor, filterArgs, readEventsPage, readSummary, type EventsPage, type Filters, type Summary } from './monitoringLogic';

export const MK = {
  all: ['monitoring'] as const satisfies QueryKey,
  events: (f: Filters) => ['monitoring', 'events', f] as const satisfies QueryKey,
  summary: (f: Filters) => ['monitoring', 'summary', f] as const satisfies QueryKey,
} as const;

export async function fetchEvents(f: Filters, beforeId: number | null, now = new Date()): Promise<EventsPage> {
  const raw = await appRpc<unknown>('monitoring_events_page', {
    ...filterArgs(f, now),
    p_before_id: beforeId,
    p_limit: PAGE_SIZE,
  });
  return readEventsPage(raw);
}

export async function fetchSummary(f: Filters, now = new Date()): Promise<Summary> {
  const raw = await appRpc<unknown>('monitoring_summary', {
    ...filterArgs(f, now),
    p_bucket: bucketFor(f.period),
  });
  return readSummary(raw);
}
