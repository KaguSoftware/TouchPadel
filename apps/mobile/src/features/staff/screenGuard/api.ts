/**
 * The owner's list of reported staff screenshots: the audit log read through
 * `audit_log_page` with the `staff.screenshot` prefix (the same rows the
 * desktop's Audit log shows), newest first.
 */
import { staffRpc } from '../api';

export const screenshotKeys = {
  list: ['staff', 'screenshots'] as const,
};

export interface ScreenshotEvent {
  id: number | string;
  at: string;
  /** The page as the router named it, e.g. `/staff-order`. */
  page: string;
  staffName: string | null;
}

interface AuditRow {
  id: number | string;
  at: string;
  entityId: string | null;
  actorName: string | null;
}

const WINDOW_DAYS = 90;
const LIMIT = 200;

export async function fetchScreenshotEvents(): Promise<ScreenshotEvent[]> {
  const now = Date.now();
  const res = await staffRpc<{ rows?: AuditRow[] } | null>('audit_log_page', {
    p_from: new Date(now - WINDOW_DAYS * 86_400_000).toISOString(),
    p_to: new Date(now + 3_600_000).toISOString(),
    p_actor_id: null,
    p_action_prefix: 'staff.screenshot',
    p_limit: LIMIT,
    p_offset: 0,
  });
  return (res?.rows ?? []).map((r) => ({
    id: r.id,
    at: r.at,
    page: r.entityId ?? '/',
    staffName: r.actorName,
  }));
}
