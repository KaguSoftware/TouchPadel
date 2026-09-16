import type { ReasonCode } from '../../components/ui';

/**
 * Why a drawer is opened by hand. The shared list is written for voids and
 * cancellations — "Wrong item", "Weather", "Expired" — none of which is a
 * reason to open a cash drawer. Used by the tab panel and the drawer screen.
 */
export const DRAWER_REASONS = ['customer_request', 'staff_error', 'other'] as const satisfies readonly ReasonCode[];
