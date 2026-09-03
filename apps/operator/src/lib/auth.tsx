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

export type StaffRole = 'cashier' | 'prep' | 'court_desk' | 'manager' | 'owner';

export interface StaffInfo {
  id: string;
  displayName: string;
  role: StaffRole;
}

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

async function fetchStaff(userId: string): Promise<StaffInfo | null> {
  const { data, error } = await supabase
    .from('staff')
    .select('id, display_name, role, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.is_active) return null;
  return { id: data.id, displayName: data.display_name, role: data.role as StaffRole };
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
        const info = await fetchStaff(next.user.id);
        if (cancelled) return;
        setStaff(info);
        setNotStaff(info === null);
      } else {
        setStaff(null);
        setNotStaff(false);
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => void applySession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void applySession(next);
    });
    return () => {
      cancelled = true;
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
  '/kds': ['prep', 'manager', 'owner'],
  '/stock': ['manager', 'owner'],
  '/admin': ['manager', 'owner'],
  '/admin/telegram': ['owner'],
  '/admin/staff': ['owner'],
  '/analytics': ['owner'],
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
    '/admin/day-close',
    '/admin/telegram',
    '/admin/settings',
    '/admin/staff',
    '/admin/audit',
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

/** The screen a freshly signed-in staff member lands on. */
export function homeRoute(role: StaffRole): string {
  switch (role) {
    case 'cashier':
      return '/till';
    case 'prep':
      return '/kds';
    case 'court_desk':
      return '/desk';
    default:
      return '/desk';
  }
}
