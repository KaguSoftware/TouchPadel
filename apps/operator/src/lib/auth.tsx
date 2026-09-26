/**
 * Staff auth — email/password against seeded staff accounts. The role read
 * from the staff row drives NAV FILTERING ONLY; RLS + in-RPC role guards are
 * the real wall (design §3.2).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { touch } from '../ipc/bridge';
import { setMutateStaffId } from './mutate';
import {
  ROLE_RECHECK_MS,
  nextStaff,
  resolveStaffRow,
  shouldDropRealtime,
  type RoleResolution,
  type StaffInfo,
  type StaffRole,
} from './roleResolution';

// Defined in the pure roleResolution module so the SEC-35 policy can be tested
// under plain node; re-exported so every existing import site is unchanged.
export type { StaffInfo, StaffRole };

interface AuthContextValue {
  session: Session | null;
  staff: StaffInfo | null;
  loading: boolean;
  /** Set when the auth user has no active staff row ('op.signIn.notStaff'). */
  notStaff: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * SEC-35. Resolve the caller's staff row into active / revoked / unknown.
 *
 * This used to collapse all three into `null`, which meant a two-second network
 * blip threw a trading till onto the "you are not staff" screen — and, because
 * that was unacceptable, nothing re-ran the lookup, so a deactivated staff
 * member kept a live Realtime feed until their access token expired an hour
 * later. See roleResolution.ts.
 */
async function resolveStaff(userId: string): Promise<RoleResolution> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('id, display_name, role, is_active')
      .eq('id', userId)
      .maybeSingle();
    return resolveStaffRow(data, error);
  } catch (error) {
    // A thrown fetch is a transport failure, never an answer about the account.
    return resolveStaffRow(null, error ?? new Error('staff lookup threw'));
  }
}

/**
 * SEC-35, the actual drop.
 *
 * Realtime authorises a PRIVATE topic when the channel subscribes and does not
 * re-authorise one that is already open, so a channel opened before the
 * deactivation keeps delivering kds / floor / courts traffic for as long as the
 * signed JWT stays valid. Removing the channels is the only thing that stops
 * it from the client side.
 *
 * Order matters. `removeAllChannels` first, so nothing is left subscribed;
 * `setAuth(undefined)` after, so any later subscribe attempt carries the anon
 * key rather than the revoked staff token. Both are best-effort: this runs on
 * the path where the account is already gone, and throwing here would leave the
 * provider mid-update with the channels still up — the exact state it is
 * trying to leave.
 */
async function dropRealtime(): Promise<void> {
  try {
    await supabase.removeAllChannels();
  } catch {
    /* best effort — the setAuth below still de-privileges the socket */
  }
  try {
    await supabase.realtime.setAuth();
  } catch {
    /* nothing further to try */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notStaff, setNotStaff] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function applySession(next: Session | null) {
      if (cancelled) return;
      setSession(next);
      // The main-process sync worker replays the durable queue AS this staff
      // session (design-arch §2.2). Every auth change flows through here —
      // SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT — so the pushed token is always
      // the freshest one. No-op in browser mode.
      touch.pushAuthState(
        next
          ? {
              accessToken: next.access_token,
              staffId: next.user.id,
              supabaseUrl,
              anonKey: supabaseAnonKey,
            }
          : null,
      );
      setMutateStaffId(next?.user.id ?? null);
      if (next) {
        // Private realtime channels (kds/floor/courts) need realtime auth.
        supabase.realtime.setAuth(next.access_token);
        await applyResolution(await resolveStaff(next.user.id));
      } else {
        setStaff(null);
        setNotStaff(false);
      }
      setLoading(false);
    }

    /**
     * Apply one resolution. 'unknown' deliberately changes NOTHING — not the
     * staff info, not the notStaff flag — so a blip on the venue's wifi cannot
     * evict a cashier mid-sale.
     */
    async function applyResolution(resolution: RoleResolution) {
      if (cancelled) return;
      if (shouldDropRealtime(resolution)) await dropRealtime();
      if (cancelled) return;
      setStaff((prev) => nextStaff(prev, resolution));
      if (resolution.kind !== 'unknown') setNotStaff(resolution.kind === 'revoked');
    }

    /**
     * SEC-35. Re-resolve the role on a timer and whenever the window is
     * brought back to the front.
     *
     * Without this the role is only ever re-read on an auth state change, and
     * the next one is the token refresh — up to jwt_expiry away. That is the
     * whole hour 0081's header calls out as its honest limit. The visibility
     * hook is the cheap half: a manager deactivating somebody usually walks
     * over to that till next, and switching to it re-checks immediately.
     */
    async function recheck() {
      if (cancelled) return;
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid || cancelled) return;
      await applyResolution(await resolveStaff(uid));
    }

    supabase.auth.getSession().then(({ data }) => void applySession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void applySession(next);
    });

    const timer = setInterval(() => void recheck(), ROLE_RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, staff, loading, notStaff, signIn, signOut }),
    [session, staff, loading, notStaff, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/**
 * Route -> roles allowed. Resolved by LONGEST-PREFIX match, and a route that
 * matches no prefix is DENIED (operator-slice.md §1.3 — closes the old
 * default-allow hole). Sub-routes inherit the parent's roles unless listed
 * explicitly ('/admin/telegram' and '/admin/staff' are owner-only).
 */
export const ROUTE_ROLES: Record<string, readonly StaffRole[]> = {
  '/till': ['cashier', 'manager', 'owner'],
  '/desk': ['court_desk', 'manager', 'owner'],
  // Customers are shared between the desk and the till (spec 06.8: attach to booking OR tab).
  '/desk/customers': ['court_desk', 'cashier', 'manager', 'owner'],
  '/desk/customers/new': ['court_desk', 'manager', 'owner'],
  '/kds': ['prep', 'manager', 'owner'],
  '/stock': ['manager', 'owner'],
  '/admin': ['manager', 'owner'],
  '/admin/telegram': ['owner'],
  '/admin/staff': ['owner'],
  '/analytics': ['owner'],
  '/ops': ['manager', 'owner'],
  '/panel': ['owner'],
  '/reports': ['manager', 'owner'],
  '/reports/revenue': ['owner'],
  // The Setup section's landing screen. Its destinations are all under
  // /admin, which manager shares; the section itself is the owner's.
  '/setup': ['owner'],
  // Management's other two sections. Same shape as /setup: the landing screen
  // is the owner's even where individual destinations (day close, bookings,
  // the audit log) are shared with the manager through their own keys.
  '/financial': ['owner'],
  '/observation': ['owner'],
  // Campaigns move money and speak to guests in the venue's name, so this is
  // the owner's alone — not manager, the way /admin/telegram already is.
  '/marketing': ['owner'],
  '/workspaces': ['manager', 'owner'],
};

/** Every known sub-route per layout prefix — drives the admin sub-nav. */
export const SUB_ROUTES = {
  '/admin': [
    '/admin/menu',
    '/admin/categories',
    '/admin/addons',
    '/admin/suggested',
    '/admin/hero',
    '/admin/qr',
    '/admin/courts',
    '/admin/rates',
    '/admin/hours',
    '/admin/promotions',
    '/admin/day-close',
    '/admin/telegram',
    '/admin/settings',
    '/admin/staff',
    '/admin/audit',
  ],
  '/stock': [
    '/stock/ingredients',
    '/stock/receive',
    '/stock/waste',
    '/stock/recipes',
    '/stock/counts',
    '/stock/variance',
    '/stock/margins',
    '/stock/alerts',
    '/stock/expiry',
  ],
} as const satisfies Record<string, readonly string[]>;
export type SubRoutePrefix = keyof typeof SUB_ROUTES;

/** Strip query/hash and trailing slashes so '/admin/menu/?x' matches '/admin/menu'. */
function normalizeRoute(route: string): string {
  const bare = route.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return bare === '' ? '/' : bare;
}

/** Longest ROUTE_ROLES key equal to the route or one of its path ancestors. */
function matchRouteKey(route: string): string | undefined {
  const target = normalizeRoute(route);
  let best: string | undefined;
  for (const key of Object.keys(ROUTE_ROLES)) {
    if (target === key || target.startsWith(`${key}/`)) {
      if (best === undefined || key.length > best.length) best = key;
    }
  }
  return best;
}

export function canAccess(role: StaffRole | undefined, route: string): boolean {
  if (!role) return false;
  const key = matchRouteKey(route);
  if (key === undefined) return false;
  return ROUTE_ROLES[key]?.includes(role) ?? false;
}

/** Top-level routes (single path segment) the role may open — sidebar filtering. */
export function allowedRoutes(role: StaffRole): string[] {
  return Object.keys(ROUTE_ROLES)
    .filter((route) => route.lastIndexOf('/') === 0)
    .filter((route) => canAccess(role, route));
}

/** Sub-routes of a layout prefix the role may open — sub-nav filtering. */
export function allowedSubRoutes(role: StaffRole, prefix: SubRoutePrefix): string[] {
  return SUB_ROUTES[prefix].filter((route) => canAccess(role, route));
}

/**
 * Capabilities gated INSIDE a screen the role can otherwise open.
 *
 * These were inline `staff?.role === 'owner'` comparisons scattered through
 * two components, which is exactly the thing SOW L185 says must not happen:
 * "One codebase, one deployment, one place to change a permission." A route
 * matrix that only covers routes is not one place.
 *
 * Like ROUTE_ROLES this is UX only — the RPCs enforce these same rules
 * server-side, and that is the wall. What it buys is that a manager is not
 * shown a button that will refuse them.
 */
export const CAPABILITY_ROLES = {
  /** Rotate a table QR token — retires every printed card for that table. */
  rotateTableToken: ['owner'],
  /** Business-day start hour: moves every historical daily figure. */
  setBusinessDayStart: ['owner'],
  /** Exclude menu items from analytics. */
  setAnalyticsExclusions: ['owner'],
  /** Engagement floor: the date before which engagement data is ignored. */
  setEngagementFloor: ['owner'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Capability = keyof typeof CAPABILITY_ROLES;

/** Default-deny, exactly like `canAccess`: no role, no capability. */
export function can(role: StaffRole | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (CAPABILITY_ROLES[capability] as readonly StaffRole[]).includes(role);
}

/** The screen a freshly signed-in staff member lands on (spec §04 workspace map). */
export function homeRoute(role: StaffRole): string {
  switch (role) {
    case 'cashier':
      return '/till';
    case 'prep':
      return '/kds';
    case 'court_desk':
      return '/desk/today';
    case 'manager':
      return '/ops';
    case 'owner':
      return '/panel';
  }
}

/**
 * Spec §03 `Permissions` — the `can.*` map every screen receives. Screens
 * render a refused control with PermissionRefusedNotice instead of hiding it
 * (R9); they never compare roles themselves. UX only, like ROUTE_ROLES: the
 * RPCs re-check every one of these server-side.
 */
export interface Permissions {
  takePayment: boolean;
  discount: boolean;
  override: boolean;
  void: boolean;
  refund: boolean;
  adjustStock: boolean;
  closeDay: boolean;
  editMenu: boolean;
  editRates: boolean;
  editPromotions: boolean;
  manageStaff: boolean;
  viewReports: boolean;
  viewFinancials: boolean;
}

const MANAGEMENT: readonly StaffRole[] = ['manager', 'owner'];
const CASHIER_UP: readonly StaffRole[] = ['cashier', 'manager', 'owner'];

export function permissionsFor(role: StaffRole | undefined): Permissions {
  const is = (roles: readonly StaffRole[]) => role !== undefined && roles.includes(role);
  return {
    takePayment: is(CASHIER_UP),
    // A cashier may START a discount; the manager PIN prompt authorises it.
    discount: is(CASHIER_UP),
    override: is(CASHIER_UP),
    void: is(CASHIER_UP),
    refund: is(MANAGEMENT),
    adjustStock: is(MANAGEMENT),
    closeDay: is(MANAGEMENT),
    editMenu: is(MANAGEMENT),
    editRates: is(MANAGEMENT),
    editPromotions: is(MANAGEMENT),
    manageStaff: is(['owner']),
    viewReports: is(MANAGEMENT),
    viewFinancials: is(['owner']),
  };
}

/** The role a refused permission needs — for PermissionRefusedNotice copy. */
export function requiredRoleFor(permission: keyof Permissions): StaffRole {
  switch (permission) {
    case 'manageStaff':
    case 'viewFinancials':
      return 'owner';
    case 'takePayment':
    case 'discount':
    case 'override':
    case 'void':
      return 'cashier';
    default:
      return 'manager';
  }
}

/** Convenience hook: the signed-in role's permission map. */
export function usePermissions(): Permissions {
  const { staff } = useAuth();
  return useMemo(() => permissionsFor(staff?.role), [staff?.role]);
}
