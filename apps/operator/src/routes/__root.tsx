/**
 * Application shell (spec §05): AppBootScreen, StaffSignInScreen,
 * WorkspaceSwitcher entry, SessionLockScreen, WorkspaceShell with the
 * per-workspace navigation rail and the global DegradedBanner region.
 *
 * Five workspaces on one build: the rail is chosen by the ACTIVE WORKSPACE
 * (lib/workspaces.ts), never by filtering one shared menu. The prep workspace
 * renders no navigation at all — a wall-mounted kitchen screen has nothing to
 * get lost in.
 */
import { Link, Outlet, createRootRoute, useRouterState } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useAuth, canAccess, homeRoute, type StaffRole } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import {
  WORKSPACES,
  isNavActive,
  loadWorkspace,
  saveWorkspace,
  workspaceForRoute,
  workspacesForRole,
  type WorkspaceKey,
} from '../lib/workspaces';
import { Button, ErrorText, Field, Spinner, card, inputStyle } from '../components/ui';
import { Icon, BrandMark, CourtLines } from '../components/icons';
import { appRpc, AppRpcError } from '../lib/appRpc';
import { supabase } from '../lib/supabase';
import { useCafeSettings } from '../lib/settings';
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

/** Stamped into device_heartbeats so a station's build is visible server-side. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

// ---------------------------------------------------------------------------
// Workspace context — which rail is showing. Consumers: the switcher screen
// and any screen that wants to know where it sits (e.g. prep full-bleed).
// ---------------------------------------------------------------------------
interface WorkspaceContextValue {
  active: WorkspaceKey;
  available: readonly WorkspaceKey[];
  setActive: (key: WorkspaceKey) => void;
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceShell');
  return ctx;
}

// Nav filtering is UX only; RLS + in-RPC role guards are the real wall.
function RootShell() {
  const { session, staff, loading, notStaff, signOut } = useAuth();
  const { tr } = useLocale();
  const [venue, setVenue] = useState<HeartbeatState | null>(null);

  // SOW L666: "The desktop app sends a heartbeat to the server on a short
  // interval." It runs here because it needs a staff session and the whole
  // shell has one.
  useHeartbeat({
    enabled: !!staff,
    appVersion: APP_VERSION,
    onState: useCallback((s: HeartbeatState) => setVenue(s), []),
  });

  if (loading) return <AppBootScreen />;
  if (!session) return <SignInScreen />;
  if (notStaff || !staff) {
    return (
      <AppBootScreen
        error={tr('op.signIn.notStaff')}
        onRetry={() => window.location.reload()}
        onSignOut={() => void signOut()}
      />
    );
  }

  return <WorkspaceShell role={staff.role} venue={venue} />;
}

// ---------------------------------------------------------------------------
// AppBootScreen — covers boot while session, permissions and venue config resolve.
// ---------------------------------------------------------------------------
function AppBootScreen({ error, onRetry, onSignOut }: { error?: string; onRetry?: () => void; onSignOut?: () => void }) {
  const { tr } = useLocale();
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={{ minBlockSize: '100vh', display: 'grid', placeItems: 'center', background: 'var(--tp-bg)' }}
    >
      <div className="tp-rise" style={{ display: 'grid', gap: '1rem', justifyItems: 'center', textAlign: 'center', maxInlineSize: '24rem' }}>
        <BrandMark />
        {error ? (
          <>
            <p style={{ fontWeight: 600 }}>{tr('ws.shell.boot.failed')}</p>
            <p style={{ color: 'var(--tp-muted-fg)' }}>{error}</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {onRetry && (
                <Button kind="primary" icon="refresh" onClick={onRetry}>
                  {tr('ws.shell.boot.retry')}
                </Button>
              )}
              {onSignOut && (
                <Button icon="logOut" onClick={onSignOut}>
                  {tr('auth.signOut')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Spinner size="md" style={{ color: 'var(--tp-accent)' }} />
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.shell.boot.body')}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceShell — rail + banner region + routed screen
// ---------------------------------------------------------------------------
function WorkspaceShell({ role, venue }: { role: StaffRole; venue: HeartbeatState | null }) {
  const available = useMemo(() => workspacesForRole(role), [role]);
  const [active, setActiveState] = useState<WorkspaceKey>(() => loadWorkspace(role));
  const path = useRouterState({ select: (s) => s.location.pathname });

  // A role change (re-login as someone else on the same station) re-validates.
  useEffect(() => {
    setActiveState((cur) => ((available as readonly string[]).includes(cur) ? cur : loadWorkspace(role)));
  }, [available, role]);

  // Following a link into another workspace's home keeps the rail coherent:
  // a manager who opens /kds sees the kitchen board full-bleed, not the ops rail.
  useEffect(() => {
    const ws = workspaceForRoute(path);
    if (ws && ws !== active && (available as readonly string[]).includes(ws)) setActiveState(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const setActive = useCallback((key: WorkspaceKey) => {
    setActiveState(key);
    saveWorkspace(key);
  }, []);

  const value = useMemo(() => ({ active, available, setActive }), [active, available, setActive]);
  const workspace = WORKSPACES[active];
  const noNav = workspace.groups.length === 0;

  return (
    <WorkspaceContext.Provider value={value}>
      <div
        data-workspace={active}
        style={{ display: 'flex', flexDirection: 'column', blockSize: '100vh', background: noNav ? 'var(--tp-kds-bg)' : 'var(--tp-bg)' }}
      >
        <IdleLock />
        <VenueStatusBanner state={venue} />
        <div style={{ display: 'flex', flex: 1, minBlockSize: 0 }}>
          {!noNav && <WorkspaceNav workspaceKey={active} path={path} />}
          <main
            style={{
              flex: 1,
              minInlineSize: 0,
              minBlockSize: 0,
              overflow: 'auto',
              paddingBlock: noNav ? '0.75rem' : '1.25rem',
              paddingInline: noNav ? '0.75rem' : '1.5rem',
            }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceNav — the rail. Props: items, activeKey, role (spec §07).
// ---------------------------------------------------------------------------
function WorkspaceNav({ workspaceKey, path }: { workspaceKey: WorkspaceKey; path: string }) {
  const { tr, toggleLocale, locale } = useLocale();
  const { staff, signOut } = useAuth();
  const { available } = useWorkspace();
  const station = touch.getStation();
  const workspace = WORKSPACES[workspaceKey];
  const canSwitch = available.length > 1;

  return (
    <nav
      data-no-print
      aria-label={tr(`ws.shell.workspace.${workspaceKey}`)}
      style={{
        inlineSize: 'var(--tp-rail-w)',
        flexShrink: 0,
        background: 'var(--tp-rail)',
        color: 'var(--tp-rail-fg)',
        display: 'flex',
        flexDirection: 'column',
        minBlockSize: 0,
        overflow: 'hidden',
      }}
    >
      {/* Rail header: the one committed brand surface. */}
      <div style={{ position: 'relative', paddingBlock: '1rem 0.9rem', paddingInline: '0.9rem', borderBlockEnd: '1px solid var(--tp-rail-border)', overflow: 'hidden' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <CourtLines opacity={0.16} />
        </div>
        <div style={{ position: 'relative' }}>
          <BrandMark compact style={{ color: 'var(--tp-brand-white)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBlockStart: '0.6rem' }}>
            <span style={{ display: 'inline-flex', color: 'var(--tp-rail-green)' }}>
              <Icon name={workspace.icon} size={16} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)', color: 'var(--tp-brand-white)' }}>
              {tr(`ws.shell.workspace.${workspaceKey}`)}
            </span>
          </div>
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', marginBlockStart: '0.15rem' }}>
            {tr(`ws.shell.workspaceLead.${workspaceKey}`)}
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBlock: '0.6rem', paddingInline: '0.5rem', display: 'grid', gap: '0.9rem', alignContent: 'start' }}>
        {workspace.groups.map((group, gi) => (
          <div key={gi} style={{ display: 'grid', gap: '2px' }}>
            {group.labelKey && (
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, paddingInline: '0.7rem', marginBlockEnd: '0.2rem' }}>
                {tr(`ws.shell.nav.${group.labelKey}`)}
              </p>
            )}
            {group.items
              .filter((item) => canAccess(staff?.role, item.to))
              .map((item) => {
                const active = isNavActive(item, path);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="tp-nav-item"
                    data-active={active ? 'true' : undefined}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={17} />
                    <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tr(`ws.shell.nav.${item.labelKey}`)}
                    </span>
                  </Link>
                );
              })}
          </div>
        ))}
      </div>

      <div style={{ borderBlockStart: '1px solid var(--tp-rail-border)', paddingBlock: '0.6rem', paddingInline: '0.5rem', display: 'grid', gap: '2px' }}>
        {canSwitch && (
          <Link to="/workspaces" className="tp-nav-item" data-active={path === '/workspaces' ? 'true' : undefined}>
            <Icon name="repeat" size={16} />
            <span>{tr('ws.shell.nav.switchWorkspace')}</span>
          </Link>
        )}
        <button type="button" className="tp-nav-item" onClick={toggleLocale} style={{ background: 'transparent', border: 'none', inlineSize: '100%', cursor: 'pointer', font: 'inherit' }}>
          <Icon name="globe" size={16} />
          <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>
        </button>
        <button type="button" className="tp-nav-item" onClick={() => void signOut()} style={{ background: 'transparent', border: 'none', inlineSize: '100%', cursor: 'pointer', font: 'inherit' }}>
          <Icon name="logOut" size={16} />
          <span>{tr('auth.signOut')}</span>
        </button>
        <QuitToDesktop />
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', paddingInline: '0.7rem', paddingBlockStart: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${station.stationId} · ${staff?.displayName ?? ''}`}>
          <bdi>{staff?.displayName}</bdi> · {tr(`op.roles.${staff?.role ?? 'cashier'}`)} · <bdi>{station.stationId}</bdi>
        </p>
      </div>
    </nav>
  );
}

/**
 * Idle lock — SessionLockScreen (spec §05). The Supabase session stays signed
 * in; after `till_idle_lock_seconds` without a touch the OVERLAY locks the
 * screen without losing in-progress state. Unlock = the signed-in staff
 * member's OWN pin (app.verify_own_pin, 0064) or their password. "Switch
 * user" signs out. UI-only by design: the RPCs remain the wall.
 */
function IdleLock() {
  const { tr } = useLocale();
  const { staff, session, signOut } = useAuth();
  const { settings } = useCafeSettings();
  const timeoutS = settings.till_idle_lock_seconds;
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const lastActivity = useRef(Date.now());

  const enabled = !!staff && timeoutS > 0;

  useEffect(() => {
    if (!enabled) return;
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= timeoutS * 1000) setLocked(true);
    }, 5_000);
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump);
      clearInterval(timer);
    };
  }, [enabled, timeoutS]);

  function clearAndUnlock() {
    setLocked(false);
    setPin('');
    setPassword('');
    setUsePassword(false);
    setError(null);
    lastActivity.current = Date.now();
  }

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      if (usePassword) {
        const email = session?.user.email;
        if (!email) throw new Error('no email on session');
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        clearAndUnlock();
        return;
      }
      const ok = await appRpc<boolean>('verify_own_pin', {
        p_pin: pin,
        p_device_id: touch.getStation().stationId,
      });
      if (!ok) {
        setError(new AppRpcError('PIN_INVALID', 'PIN_INVALID'));
        setPin('');
        return;
      }
      // Only an authorising role's pin feeds the offline manager-pin cache.
      if (staff && (staff.role === 'manager' || staff.role === 'owner')) {
        touch.pinObserved(pin);
      }
      clearAndUnlock();
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'NO_PIN_SET') {
        setUsePassword(true);
        setError(null);
      } else {
        setError(e);
      }
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  if (!locked || !staff) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('ws.shell.lock.title')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        background: 'var(--tp-rail)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0.6 }}>
        <CourtLines opacity={0.14} />
      </div>
      <div className="tp-rise" style={{ ...card, position: 'relative', inlineSize: 'min(22rem, 92vw)', boxShadow: 'var(--tp-shadow-dialog)', paddingBlock: '1.25rem', paddingInline: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBlockEnd: '0.4rem' }}>
          <Icon name="lock" size={18} style={{ color: 'var(--tp-accent)' }} />
          <h2 style={{ fontSize: 'var(--tp-fs-xl)' }}>{tr('ws.shell.lock.title')}</h2>
        </div>
        <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.9rem', fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.shell.lock.hint', { name: staff.displayName })}
        </p>
        {usePassword ? (
          <Field label={tr('auth.passwordLabel')}>
            <input
              style={inputStyle}
              type="password"
              value={password}
              autoFocus
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            />
          </Field>
        ) : (
          <Field label={tr('ws.shell.lock.pin')}>
            <input
              style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
              type="password"
              inputMode="numeric"
              dir="ltr"
              value={pin}
              autoFocus
              disabled={busy}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            />
          </Field>
        )}
        <ErrorText error={error} />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button kind="ghost" icon="users" onClick={() => void signOut()} disabled={busy}>
            {tr('ws.shell.lock.switchUser')}
          </Button>
          <span style={{ display: 'flex', gap: '0.5rem' }}>
            {!usePassword && (
              <Button kind="ghost" onClick={() => setUsePassword(true)} disabled={busy}>
                {tr('ws.shell.lock.usePassword')}
              </Button>
            )}
            <Button
              kind="primary"
              busy={busy}
              disabled={usePassword ? password.length === 0 : pin.length < 4}
              onClick={() => void unlock()}
            >
              {tr('ws.shell.lock.unlock')}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Manager-PIN "Quit to desktop" (design-arch §2.5) — production kiosk windows
 * are not closable any other way. Hidden entirely in browser mode.
 */
function QuitToDesktop() {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (typeof window === 'undefined' || !window.touch) return null;

  async function quit() {
    setBusy(true);
    setError(null);
    try {
      try {
        await appRpc('verify_manager_pin', { p_pin: pin, p_device_id: touch.getStation().stationId });
        touch.pinObserved(pin);
      } catch (e) {
        // Offline: fall through to the cache check in main. A server REFUSAL
        // (PIN_INVALID / PIN_LOCKED) still surfaces — do not quit around it.
        if (e instanceof AppRpcError && e.code !== 'UNKNOWN') throw e;
      }
      const res = await touch.quitApp(pin);
      if (!res.ok) throw new Error(res.error ?? 'refused');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="tp-nav-item" onClick={() => setOpen(true)} style={{ background: 'transparent', border: 'none', inlineSize: '100%', cursor: 'pointer', font: 'inherit' }}>
        <Icon name="x" size={16} />
        <span>{tr('ws.shell.nav.quit')}</span>
      </button>
      {open && (
        <div style={{ ...card, position: 'fixed', insetBlockEnd: '1rem', insetInlineStart: '1rem', zIndex: 40, boxShadow: 'var(--tp-shadow-popover)', inlineSize: '16rem' }}>
          <Field label={tr('op.common.pin')}>
            <input
              style={inputStyle}
              type="password"
              inputMode="numeric"
              dir="ltr"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <ErrorText error={error} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setOpen(false)}>{tr('common.back')}</Button>
            <Button kind="danger" busy={busy} disabled={pin.length < 4} onClick={() => void quit()}>
              {tr('ws.shell.nav.quit')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// StaffSignInScreen — email + password. States: ready · busy · error.
// ---------------------------------------------------------------------------
function SignInScreen() {
  const { signIn } = useAuth();
  const { tr, toggleLocale, locale } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'invalid' | 'network' | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      setError(msg.includes('fetch') || msg.includes('network') ? 'network' : 'invalid');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minBlockSize: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)', background: 'var(--tp-bg)' }}>
      <aside
        aria-hidden="true"
        style={{ position: 'relative', background: 'var(--tp-rail)', color: 'var(--tp-brand-white)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '2rem' }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          <CourtLines opacity={0.22} />
        </div>
        <BrandMark style={{ position: 'relative', color: 'var(--tp-brand-white)', fontSize: '1.5rem' }} />
        <p style={{ position: 'relative', fontSize: 'var(--tp-fs-3xl)', fontWeight: 700, lineHeight: 1.1, maxInlineSize: '9ch' }}>
          {tr('ws.shell.signIn.tagline')}
        </p>
      </aside>
      <div style={{ display: 'grid', placeItems: 'center', padding: '2rem' }}>
        <form onSubmit={(e) => void submit(e)} className="tp-rise" style={{ inlineSize: 'min(22rem, 100%)', display: 'grid', gap: '0.25rem' }}>
          <h1 style={{ fontSize: 'var(--tp-fs-2xl)', marginBlockEnd: '0.25rem' }}>{tr('op.signIn.title')}</h1>
          <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '1rem' }}>{tr('ws.shell.signIn.lead')}</p>
          <Field label={tr('auth.emailLabel')}>
            <input
              style={inputStyle}
              dir="ltr"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              disabled={busy}
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
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" style={{ color: 'var(--tp-danger-fg)', background: 'var(--tp-danger-soft)', borderRadius: 'var(--tp-radius-ctl)', paddingBlock: '0.45rem', paddingInline: '0.6rem', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: '0.5rem' }}>
              {error === 'network' ? tr('ws.shell.signIn.network') : tr('op.signIn.failed')}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBlockStart: '0.5rem' }}>
            <Button kind="ghost" icon="globe" onClick={toggleLocale}>
              <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>
            </Button>
            <Button kind="primary" type="submit" busy={busy} disabled={!email || !password}>
              {tr('op.signIn.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Per-route role guard (belt; RLS + the in-RPC guards are braces). A RENDER-time
 * guard rather than a router `beforeLoad` redirect so a cold kiosk start never
 * loops. It shows a way out rather than a bare sentence.
 */
export function RequireRole({ route, children }: { route: string; children: ReactNode }) {
  const { staff } = useAuth();
  const { tr } = useLocale();
  if (!canAccess(staff?.role as StaffRole | undefined, route)) {
    return (
      <div style={{ ...card, display: 'grid', gap: '0.5rem', justifyItems: 'start', maxInlineSize: '32rem' }} role="alert">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 700 }}>
          <Icon name="shield" /> {tr('op.common.forbidden')}
        </div>
        {staff && (
          <Link to={homeRoute(staff.role)} className="tp-link">
            {tr('op.crash.home')}
          </Link>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
