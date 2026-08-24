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
import { supabase } from './supabase';

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

/** Route -> roles allowed. Manager/owner see everything. */
export const ROUTE_ROLES: Record<string, readonly StaffRole[]> = {
  '/till': ['cashier', 'manager', 'owner'],
  '/desk': ['court_desk', 'manager', 'owner'],
  '/kds': ['prep', 'manager', 'owner'],
  '/stock': ['manager', 'owner'],
  '/admin': ['manager', 'owner'],
};

export function allowedRoutes(role: StaffRole): string[] {
  return Object.entries(ROUTE_ROLES)
    .filter(([, roles]) => roles.includes(role))
    .map(([route]) => route);
}

export function canAccess(role: StaffRole | undefined, route: string): boolean {
  if (!role) return false;
  const roles = ROUTE_ROLES[route];
  return roles ? roles.includes(role) : true;
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
