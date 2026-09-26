/**
 * The five courts RPCs (migration 0093), kept in their own file so the
 * courts lane and the cafe/AI lane never edit lib/analyticsApi.ts at once.
 * Every function is owner-only on the server (app.analytics_guard) and takes
 * the same three arguments: the business-day range and an optional court.
 */
import type { Json } from '@touch/db';
import { appRpc } from '../../../lib/appRpc';

export type CourtsRpcName =
  | 'analytics_courts_summary'
  | 'analytics_courts_demand'
  | 'analytics_courts_endings'
  | 'analytics_courts_guests'
  | 'analytics_courts_cafe';

export interface CourtsRpcArgs {
  from: string;
  to: string;
  courtId?: string | undefined;
}

export function courtsRpc(name: CourtsRpcName, { from, to, courtId }: CourtsRpcArgs): Promise<Json> {
  return appRpc<Json>(name, { p_from: from, p_to: to, p_court_id: courtId ?? null });
}
