/**
 * Standing customer discounts (0342), the server half: the reads, the writes
 * and the bill's automatic refresh. Every call is an online-only app.* RPC
 * through appRpc, like the loyalty writes (no queued mutation type, no PIN).
 *
 * Keys ride under the keys their screens already invalidate, so nothing new
 * has to be remembered elsewhere:
 *   - the record's discount is a child of ['customer', id];
 *   - a bill's discount state is a child of ['bookingBill', reservationId]
 *     for a booking (the till re-reads that key whenever its tab changes, the
 *     desk on every settle) and of ['tab', tabId] for any other tab (the till's
 *     refresh, MemberAttach's attach). The host's `version` (its own figures:
 *     subtotal, lines, discounts) ends the key, so a bill whose goods changed is
 *     asked again and a percent stays right as items are added.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { can, type Capability, type StaffWho } from '../../lib/auth';
import {
  cafeApplyArgs,
  courtApplyArgs,
  readBillState,
  readCustomerDiscount,
  refreshSignature,
  type BillDiscountState,
  type BillStep,
  type CustomerDiscount,
} from './discountLogic';

/**
 * Who may read and set a customer's discount: court_desk, cashier, shop_staff,
 * manager, owner, the roles of app.customer_discount, set_customer_discount,
 * bill_customer_discount and apply_customer_discount. That is exactly
 * `attachMember`'s set (the member on a bill), so it is borrowed rather than
 * repeated; a `customerDiscount` entry in CAPABILITY_ROLES can take its place.
 * The court part's RPC also refuses shop_staff, who never sees a booking.
 */
export const DISCOUNT_CAPABILITY: Capability = 'attachMember';

export function canDiscount(who: StaffWho): boolean {
  return can(who, DISCOUNT_CAPABILITY);
}

/**
 * A server without 0342 (PGRST202, appRpc's RPC_MISSING): the feature renders
 * nothing. Read off the code rather than through isRpcMissing so a screen test
 * that mocks lib/appRpc with only `appRpc` still mounts.
 */
export function rpcMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'RPC_MISSING';
}

export const DISCOUNT_KEYS = {
  customer: (customerId: string) => ['customer', customerId, 'discount'] as const,
  bill: (tabId: string | null, reservationId: string | null) =>
    reservationId ? (['bookingBill', reservationId, 'customerDiscount', tabId] as const) : (['tab', tabId ?? '', 'customerDiscount'] as const),
};

/** The customer's standing discount, null when they have none. */
export function useCustomerDiscount(customerId: string, enabled: boolean): UseQueryResult<CustomerDiscount | null> {
  return useQuery({
    queryKey: DISCOUNT_KEYS.customer(customerId),
    enabled: enabled && Boolean(customerId),
    queryFn: async () => readCustomerDiscount((await appRpc<{ discount?: unknown } | null>('customer_discount', { p_customer_id: customerId }))?.discount),
    retry: (n, e) => !rpcMissing(e) && n < 1,
  });
}

/** A bill's discount state (app.bill_customer_discount): a tab, a booking, or both. */
export function useBillDiscount({
  tabId,
  reservationId,
  version,
  enabled,
}: {
  tabId: string | null;
  reservationId: string | null;
  /** The host's own figures, so a changed bill is asked again (see the header). */
  version: string;
  enabled: boolean;
}): UseQueryResult<BillDiscountState> {
  return useQuery({
    queryKey: [...DISCOUNT_KEYS.bill(tabId, reservationId), version],
    enabled: enabled && Boolean(tabId || reservationId),
    queryFn: async () => readBillState(await appRpc('bill_customer_discount', { p_tab_id: tabId, p_reservation_id: reservationId })),
    retry: (n, e) => !rpcMissing(e) && n < 1,
    placeholderData: (prev) => prev,
  });
}

/** After any discount write: the bill, its lists, the booking's bill, and the customer's record. */
export function invalidateDiscount(
  qc: QueryClient,
  ids: { customerId?: string | null; tabId?: string | null; reservationId?: string | null },
): void {
  if (ids.customerId) void qc.invalidateQueries({ queryKey: ['customer', ids.customerId] });
  if (ids.tabId) {
    void qc.invalidateQueries({ queryKey: ['tab', ids.tabId] });
    void qc.invalidateQueries({ queryKey: ['tabs'] });
  }
  if (ids.tabId || ids.reservationId) {
    void qc.invalidateQueries({ queryKey: ['bookingBill'] });
    void qc.invalidateQueries({ queryKey: ['bookingBillStates'] });
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** What a bill's steps came to: the bill may not take the discount the record now has. */
export interface StepsOutcome {
  /** The first part the server declined (COURT_FEE_PAID, DISCOUNT_REQUIRES_REFUND, …). */
  refused: string | null;
}

/**
 * Refusals that mean "this bill cannot take it", not "the press failed": after
 * Keep has already saved the record, they are told, and the other part still
 * goes on.
 */
const BILL_REFUSALS: ReadonlySet<string> = new Set(['COURT_FEE_PAID', 'DISCOUNT_REQUIRES_REFUND', 'COURT_BILL_CLOSED', 'NOTHING_OWED']);

/**
 * Run a bill dialog's steps in order (discountLogic.billSteps). Stops at the
 * first refusal, which the caller shows, except a bill refusal on a
 * 'standing' step (see BILL_REFUSALS).
 */
export async function runBillSteps(steps: readonly BillStep[], ids: { tabId: string | null; reservationId: string | null }): Promise<StepsOutcome> {
  let refused: string | null = null;
  for (const s of steps) {
    if (s.rpc === 'set_customer_discount') {
      await appRpc('set_customer_discount', s.args);
      continue;
    }
    const id = s.target === 'cafe' ? ids.tabId : ids.reservationId;
    if (!id) continue;
    try {
      const r =
        s.rpc === 'apply_customer_discount'
          ? await appRpc<{ refused?: unknown } | null>('apply_customer_discount', cafeApplyArgs(id, s.mode, deviceId()))
          : await appRpc<{ refused?: unknown } | null>('apply_customer_court_discount', courtApplyArgs(id, s.mode, deviceId()));
      if (typeof r?.refused === 'string') refused ??= r.refused;
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      if (s.mode.kind !== 'standing' || typeof code !== 'string' || !BILL_REFUSALS.has(code)) throw e;
      refused ??= code;
    }
  }
  return { refused };
}

// ---------------------------------------------------------------------------
// The automatic refresh
// ---------------------------------------------------------------------------

/**
 * While a bill is open: when its state says a refresh would change something
 * (the customer's standing discount is not on it yet, a percent no longer
 * matches the goods, the standing one was changed or removed), ask for one,
 * once per state, then re-read. Silent: a success shows on the bill's own rows,
 * and a refusal (DISCOUNT_REQUIRES_REFUND on a part-paid bill, COURT_FEE_PAID;
 * answered as data or raised) leaves the bill as it was. Never loops: the same state and figures are never asked twice
 * (refreshSignature), and a bill the desk took it off stays waived on the server.
 */
export function useAutoCustomerDiscount({
  tabId,
  reservationId,
  state,
  version,
  enabled,
}: {
  tabId: string | null;
  reservationId: string | null;
  state: BillDiscountState | undefined;
  version: string;
  enabled: boolean;
}): void {
  const qc = useQueryClient();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !state) return;
    // Never true on a bill that waived it: the server owns "not on this bill".
    const cafe = state.cafe_needs_refresh && tabId !== null;
    const court = state.court_needs_refresh && reservationId !== null;
    if (!cafe && !court) return;
    const signature = refreshSignature(state, version);
    if (asked.current === signature) return;
    asked.current = signature;
    void (async () => {
      if (cafe && tabId) {
        try {
          await appRpc('apply_customer_discount', cafeApplyArgs(tabId, { kind: 'refresh' }, deviceId()));
        } catch {
          // Left as it was; the bill's rows still say what it carries.
        }
      }
      if (court && reservationId) {
        try {
          await appRpc('apply_customer_court_discount', courtApplyArgs(reservationId, { kind: 'refresh' }, deviceId()));
        } catch {
          // As above.
        }
      }
      invalidateDiscount(qc, { tabId, reservationId });
    })();
  }, [enabled, state, version, tabId, reservationId, qc]);
}
