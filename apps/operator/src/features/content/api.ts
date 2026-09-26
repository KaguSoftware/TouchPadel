/**
 * The content reads more than one screen shares (wave5-addendum-2026-09-25
 * §5.2). QK.contentWaiting holds the Waiting filter's first page as returned:
 * its waiting_count is the owner's Marketing rail badge and the "N posts to
 * approve" rows. Every other read sits under the same ['content'] root, so one
 * invalidation after a send, a revision, a withdrawal or a decision refreshes
 * them all. Only marketing and the owners can read any of it (§8 Q14).
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { CONTENT_PAGE_SIZE, readCampaignOptions, type AboutOption } from './contentLogic';

export function fetchContentWaiting(): Promise<unknown> {
  return appRpc<unknown>('content_page', { p_filter: 'waiting', p_limit: CONTENT_PAGE_SIZE, p_offset: 0 });
}

/** The menu items a new post may be about: the active ones, as marketing reads them on /tasks. */
export async function fetchAboutItems(): Promise<AboutOption[]> {
  const { data, error } = await supabase.from('menu_items').select('id, name_en, name_ar').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []).map((i) => ({ id: i.id, nameEn: i.name_en ?? '', nameAr: i.name_ar ?? '' }));
}

/** The campaigns a new post may be about (app.marketing_campaign_results, marketing's own read, 0187). */
export async function fetchAboutCampaigns(): Promise<AboutOption[]> {
  return readCampaignOptions(await appRpc<unknown>('marketing_campaign_results', {}));
}

/** Feature-private keys, all under ['content'] (QK.contentWaiting is ['content', 'waiting']). */
export const CK = {
  all: ['content'] as const satisfies QueryKey,
  page: (filter: string, offset: number) => ['content', 'page', filter, offset] as const satisfies QueryKey,
  detail: (id: string) => ['content', 'detail', id] as const satisfies QueryKey,
  about: (kind: 'item' | 'campaign') => ['content', 'about', kind] as const satisfies QueryKey,
} as const;
