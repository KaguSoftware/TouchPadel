import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth, canAccess, allowedRoutes, homeRoute, type StaffRole } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { Button, Field, card, inputStyle } from '../components/ui';
import { GlobalStyles } from '../components/GlobalStyles';
import { ToastProvider } from '../components/toast';
import { ConfirmProvider } from '../components/ConfirmDialog';
import { touch } from '../ipc/bridge';
import { useHeartbeat, type HeartbeatState } from '../lib/heartbeat';
import { VenueStatusBanner } from '../components/VenueStatusBanner';

export const rootRoute = createRootRoute({
  component: RootProviders,
});

// Global CSS (keyframes + print) and the toast / confirm hosts sit above every
// screen, including sign-in, so any component may call useToast / useConfirm.
function RootProviders() {
  return (
    <>
      <GlobalStyles />
      <ToastProvider>
        <ConfirmProvider>
          <RootShell />
        </ConfirmProvider>
      </ToastProvider>
    </>
  );
}

type NavKey = 'till' | 'desk' | 'kds' | 'stock' | 'admin' | 'analytics';

/** Stamped into device_heartbeats so a station's build is visible server-side. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

const NAV: readonly { to: string; key: NavKey }[] = [
  { to: '/till', key: 'till' },
  { to: '/desk', key: 'desk' },
  { to: '/kds', key: 'kds' },
  { to: '/stock', key: 'stock' },
  { to: '/admin', key: 'admin' },
  { to: '/analytics', key: 'analytics' },
];

// Nav filtering is UX only; RLS + in-RPC role guards are the real wall.
function RootShell() {
  const { session, staff, loading, notStaff, signOut } = useAuth();
  const { tr, toggleLocale } = useLocale();
  const station = touch.getStation();
  const [venue, setVenue] = useState<HeartbeatState | null>(null);

  // SOW L666: "The desktop app sends a heartbeat to the server on a short
  // interval." Nothing in the product ever did — see lib/heartbeat.ts. It runs
  // here because it needs a staff session and the whole shell has one.
  useHeartbeat({
    enabled: !!staff,
    appVersion: APP_VERSION,
    onState: useCallback((s: HeartbeatState) => setVenue(s), []),
  });

  if (loading) {
    return <p style={{ paddingBlock: '2rem', paddingInline: '2rem' }}>{tr('common.loading')}</p>;
  }
  if (!session) return <SignInScreen />;
  if (notStaff || !staff) {
    return (
      <div style={{ paddingBlock: '2rem', paddingInline: '2rem' }}>
        <p style={card}>{tr('op.signIn.notStaff')}</p>
        <Button onClick={() => void signOut()}>{tr('auth.signOut')}</Button>
      </div>
    );
  }

  const routes = allowedRoutes(staff.role);

  return (
    <div style={{ display: 'flex', minBlockSize: '100vh', flexDirection: 'column' }}>
      <VenueStatusBanner state={venue} />
      <div style={{ display: 'flex', flex: 1, minBlockSize: 0 }}>
      <nav
        data-no-print
        style={{
          inlineSize: '12rem',
          flexShrink: 0,
          borderInlineEnd: '1px solid var(--tp-border)',
          paddingBlock: '1rem',
          paddingInline: '0.8rem',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <p style={{ fontWeight: 700, marginBlockStart: 0 }}>{tr('operator.appName')}</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--tp-muted-fg)', marginBlockStart: 0 }}>
          {station.stationId} · {staff.displayName} · {tr(`op.roles.${staff.role}` as const)}
        </p>
        {NAV.filter((n) => routes.includes(n.to)).map((n) => (
          <Link
            key={n.to}
            to={n.to}
            style={{ display: 'block', paddingBlock: '0.5rem', color: 'var(--tp-accent)' }}
            activeProps={{ style: { fontWeight: 700, color: 'var(--tp-fg)' } }}
          >
            {tr(`${n.key}.title` as const)}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <Button kind="ghost" onClick={toggleLocale}>
          {tr('op.common.language')}
        </Button>
        <Button kind="ghost" onClick={() => void signOut()}>
          {tr('auth.signOut')}
        </Button>
      </nav>
        <main style={{ flex: 1, paddingBlock: '1rem', paddingInline: '1rem', minInlineSize: 0 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SignInScreen() {
  const { signIn } = useAuth();
  const { tr, toggleLocale } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await signIn(email, password);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minBlockSize: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form onSubmit={(e) => void submit(e)} style={{ ...card, inlineSize: 'min(22rem, 92vw)' }}>
        <h1 style={{ marginBlockStart: 0, fontSize: '1.2rem' }}>{tr('op.signIn.title')}</h1>
        <Field label={tr('auth.emailLabel')}>
          <input
            style={inputStyle}
            dir="ltr"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={tr('auth.passwordLabel')}>
          <input
            style={inputStyle}
            dir="ltr"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {failed && (
          <p role="alert" style={{ color: 'var(--tp-danger)', fontSize: '0.9rem' }}>
            {tr('op.signIn.failed')}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button kind="ghost" onClick={toggleLocale}>
            {tr('op.common.language')}
          </Button>
          <Button kind="primary" type="submit" disabled={busy || !email || !password}>
            {tr('op.signIn.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Per-route role guard (belt; RLS + the in-RPC guards are braces).
 *
 * Deliberately a RENDER-time guard rather than a router `beforeLoad`
 * redirect. `beforeLoad` runs before the Supabase session resolves, so on a cold
 * start it would see `staff === undefined`, deny, and redirect — on a kiosk
 * that is a redirect loop with no address bar to escape from. Rendering the
 * guard lets it simply wait for auth, which is what `AuthProvider` already
 * does correctly.
 *
 * It shows a way out rather than a bare sentence: a cashier who lands here
 * from a stale bookmark on a kiosk has no back button.
 */
export function RequireRole({ route, children }: { route: string; children: ReactNode }) {
  const { staff } = useAuth();
  const { tr } = useLocale();
  if (!canAccess(staff?.role as StaffRole | undefined, route)) {
    return (
      <div style={card} role="alert">
        <p style={{ marginBlockStart: 0 }}>{tr('op.common.forbidden')}</p>
        {staff && (
          <Link to={homeRoute(staff.role)} style={{ color: 'var(--tp-accent)' }}>
            {tr('op.crash.home')}
          </Link>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
