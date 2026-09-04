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
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
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
import { Button, ErrorText, Field, Modal, Spinner, card, inputStyle, trapTab } from '../components/ui';
import { PermissionRefusedNotice, StatusBadge } from '../components/kit';
import { Icon, CourtLines } from '../components/icons';
import { BrandLockup, BrandSwoosh } from '../components/brand';
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

  if (loading) return <AppBootScreen fullBleed />;
  if (!session) return <SignInScreen />;
  if (notStaff || !staff) {
    return (
      <AppBootScreen
        fullBleed
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
/**
 * Exported because routes/index.tsx resolves auth too and used to render a bare
 * centred Spinner at 40vh — a second, plainer appearance for the SAME wait, and
 * the first thing a staff member sees on every cold start. One boot screen, one
 * appearance.
 *
 * `fullBleed` is the same distinction CrashPanel draws: only the three call
 * sites above the router own the viewport. Rendered inside <main> — which is
 * already the shell's height minus the connectivity strip — a 100vh box would
 * centre the message below the fold on a kiosk with nothing to scroll it with.
 */
export function AppBootScreen({
  error,
  onRetry,
  onSignOut,
  fullBleed = false,
}: {
  error?: string;
  onRetry?: () => void;
  onSignOut?: () => void;
  fullBleed?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={{
        minBlockSize: fullBleed ? '100vh' : '100%',
        display: 'grid',
        placeItems: 'center',
        paddingBlock: 'var(--tp-sp-6)',
        background: 'var(--tp-bg)',
      }}
    >
      <div className="tp-rise" style={{ display: 'grid', gap: 'var(--tp-sp-4)', justifyItems: 'center', textAlign: 'center', maxInlineSize: '24rem' }}>
        <BrandLockup size={36} title="Touch Padel" />
        {error ? (
          <>
            <p style={{ fontWeight: 600 }}>{tr('ws.shell.boot.failed')}</p>
            <p style={{ color: 'var(--tp-muted-fg)' }}>{error}</p>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
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
        <SkipToMain />
        <IdleLock />
        <VenueStatusBanner state={venue} />
        <div style={{ display: 'flex', flex: 1, minBlockSize: 0 }}>
          {!noNav && <WorkspaceNav workspaceKey={active} path={path} />}
          {/* tabIndex -1 so the skip link has somewhere to land; the routed
              screen's own first heading is the next stop from here. */}
          <main
            id="tp-main"
            tabIndex={-1}
            style={{
              flex: 1,
              minInlineSize: 0,
              minBlockSize: 0,
              overflow: 'auto',
              paddingBlock: noNav ? 'var(--tp-sp-3)' : 'var(--tp-sp-4)',
              paddingInline: noNav ? 'var(--tp-sp-3)' : 'var(--tp-sp-5)',
            }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

/**
 * The first thing a keyboard reaches on every screen. The owner's rail renders
 * 17 links and four footer controls ahead of the routed content, so without it
 * every navigation costs up to 21 Tab presses on a workspace PRODUCT.md calls
 * keyboard-first. Invisible until it is focused, so a mouse never meets it.
 *
 * It moves focus to #tp-main itself instead of letting the browser follow the
 * fragment: a bare hash href would push '#tp-main' into the router's location
 * and leave it hanging off every URL after it.
 */
function SkipToMain() {
  const { tr } = useLocale();
  const [shown, setShown] = useState(false);
  return (
    <a
      href="#tp-main"
      className={shown ? undefined : 'tp-sr-only'}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById('tp-main')?.focus();
      }}
      style={
        shown
          ? {
              position: 'fixed',
              insetBlockStart: 'var(--tp-sp-2)',
              insetInlineStart: 'var(--tp-sp-2)',
              zIndex: 'var(--tp-z-popover)',
              background: 'var(--tp-surface)',
              color: 'var(--tp-accent)',
              border: '1px solid var(--tp-border-input)',
              borderRadius: 'var(--tp-radius-ctl)',
              boxShadow: 'var(--tp-shadow-popover)',
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-3)',
              fontWeight: 600,
              textDecoration: 'none',
            }
          : undefined
      }
    >
      {tr('ws.shell.nav.skipToMain')}
    </a>
  );
}

/**
 * The rail's ONE start edge (rulebook 10.8). Header, group label, link and
 * identity line all resolve to RAIL_PAD + RAIL_ITEM_PAD from the rail's inline
 * start, so nothing sits a few pixels off its neighbour. The header used to be
 * inset 0.9rem against everything else's 1.2rem, and the rhythm around it was
 * freehand — 0.9 / 0.7 / 0.6 / 0.5 / 0.45 / 0.4 / 0.2 / 0.15rem, not one of
 * them on the 4px scale.
 *
 * RAIL_ITEM_PAD is applied inline rather than in GlobalStyles because
 * .tp-nav-item's own 0.7rem is shared with consumers outside this file.
 */
const RAIL_PAD = 'var(--tp-sp-2)';
const RAIL_ITEM_PAD = 'var(--tp-sp-3)';
const RAIL_EDGE = `calc(${RAIL_PAD} + ${RAIL_ITEM_PAD})`;

const navItemStyle: CSSProperties = { paddingInline: RAIL_ITEM_PAD };
/** A rail control that is a <button>, not a <Link>: same box, no chrome. */
const navButtonStyle: CSSProperties = {
  ...navItemStyle,
  background: 'transparent',
  border: 'none',
  inlineSize: '100%',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'start',
};

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
      <div style={{ position: 'relative', paddingBlock: 'var(--tp-sp-4) var(--tp-sp-3)', paddingInline: RAIL_EDGE, borderBlockEnd: '1px solid var(--tp-rail-border)', overflow: 'hidden' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <CourtLines opacity={0.16} />
        </div>
        <div style={{ position: 'relative' }}>
          <BrandLockup size={26} tone="onDark" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'var(--tp-sp-2-5)' }}>
            <span style={{ display: 'inline-flex', color: 'var(--tp-rail-green)' }}>
              <Icon name={workspace.icon} size={16} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)', color: 'var(--tp-brand-white)' }}>
              {tr(`ws.shell.workspace.${workspaceKey}`)}
            </span>
          </div>
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', marginBlockStart: 'var(--tp-sp-0)' }}>
            {tr(`ws.shell.workspaceLead.${workspaceKey}`)}
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: RAIL_PAD, display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
        {workspace.groups.map((group, gi) => (
          <div key={gi} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {group.labelKey && (
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, paddingInline: RAIL_ITEM_PAD, marginBlockEnd: 'var(--tp-sp-1)' }}>
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
                    style={navItemStyle}
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

      <div style={{ borderBlockStart: '1px solid var(--tp-rail-border)', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: RAIL_PAD, display: 'grid', gap: 'var(--tp-sp-0)' }}>
        {canSwitch && (
          <Link to="/workspaces" className="tp-nav-item" style={navItemStyle} data-active={path === '/workspaces' ? 'true' : undefined}>
            <Icon name="repeat" size={16} />
            <span>{tr('ws.shell.nav.switchWorkspace')}</span>
          </Link>
        )}
        <button type="button" className="tp-nav-item" onClick={toggleLocale} style={navButtonStyle}>
          <Icon name="globe" size={16} />
          <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>
        </button>
        <button type="button" className="tp-nav-item" onClick={() => void signOut()} style={navButtonStyle}>
          <Icon name="logOut" size={16} />
          <span>{tr('auth.signOut')}</span>
        </button>

        {/* Rulebook 4.5 wants the role and the scoped context legible at all
            times. One line reading "Mohammed Al-Rashid · Court desk · TILL-01"
            inside a 13.5rem rail truncated to about the first name, so in
            practice neither the role nor the station was visible at all. Name
            and role share a line because they answer "who is signed in"; the
            station answers "which till" and gets its own, using the
            ws.shell.nav.station key that had been sitting unused. */}
        <div style={{ paddingInline: RAIL_ITEM_PAD, paddingBlockStart: 'var(--tp-sp-2)', display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
            <bdi
              title={staff?.displayName}
              style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-brand-white)' }}
            >
              {staff?.displayName}
            </bdi>
            <StatusBadge
              size="sm"
              dot={false}
              label={tr(`op.roles.${staff?.role ?? 'cashier'}`)}
              style={{ flexShrink: 0 }}
            />
          </div>
          <p
            title={tr('ws.shell.nav.station', { id: station.stationId })}
            style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {tr('ws.shell.nav.station', { id: station.stationId })}
          </p>
        </div>

        <QuitToDesktop />
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
  const cardRef = useRef<HTMLDivElement>(null);

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
      className="tp-fade"
      /*
       * The overlay declared aria-modal and trapped nothing. The screens behind
       * it stay mounted, so Tab walked straight out of this card into the till
       * grid, the rail links and Sign out, and Enter fired them — a locked
       * shared till was fully operable by whoever walked up to it.
       *
       * Tab only. Escape is deliberately NOT wired: every other dialog in the
       * app closes on it, and this is the one that must not, because a lock a
       * keypress dismisses is not a lock.
       */
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Tab') trapTab(e, cardRef.current);
      }}
      /*
       * The trap above only sees keydowns that bubble through this overlay, and
       * neither the overlay nor the card was focusable — so a press on the dark
       * area outside the card, which is exactly what someone walking up to a
       * locked till touches first, moved focus to <body>. The next Tab was
       * dispatched on body, never reached this handler, and walked into the
       * rail behind the lock. Pulling focus back to the card closes that door.
       */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          cardRef.current?.focus();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--tp-z-lock)',
        background: 'var(--tp-rail)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* One opacity, in one place. This used to be 0.6 on the wrapper times
          0.14 on the motif = 0.084, i.e. an undifferentiated navy rectangle —
          on the longest-lived full-screen brand moment in a shift. */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
        <CourtLines opacity={0.2} />
      </div>
      <BrandLockup
        size={28}
        tone="onDark"
        style={{ position: 'absolute', insetBlockStart: '2rem', insetInlineStart: '2rem' }}
      />
      <div ref={cardRef} tabIndex={-1} className="tp-rise" style={{ ...card, position: 'relative', outline: 'none', inlineSize: 'min(22rem, 92vw)', boxShadow: 'var(--tp-shadow-dialog)', paddingBlock: 'var(--tp-sp-5)', paddingInline: 'var(--tp-sp-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-1-5)' }}>
          <Icon name="lock" size={18} style={{ color: 'var(--tp-accent)' }} />
          <h2 style={{ fontSize: 'var(--tp-fs-xl)' }}>{tr('ws.shell.lock.title')}</h2>
        </div>
        <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-sm)' }}>
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
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button kind="ghost" icon="users" onClick={() => void signOut()} disabled={busy}>
            {tr('ws.shell.lock.switchUser')}
          </Button>
          <span style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
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
 *
 * Rulebook 7.8: it carries its own separator and its own muted weight because
 * it ENDS SERVICE on this till, and it used to sit directly beneath "Sign out"
 * at identical weight in the same 2px-gap grid — one row's slip from a routine
 * action to a destructive one. The rule lives here rather than in the rail so
 * that in browser mode, where this component renders nothing, it leaves no
 * stray line behind (rulebook 4.4).
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
      <div style={{ marginBlockStart: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-1)', borderBlockStart: '1px solid var(--tp-rail-border)' }}>
        <button
          type="button"
          className="tp-nav-item"
          onClick={() => setOpen(true)}
          style={{ ...navButtonStyle, color: 'var(--tp-rail-muted)', fontWeight: 500 }}
        >
          <Icon name="x" size={16} />
          <span>{tr('ws.shell.nav.quit')}</span>
        </button>
      </div>
      {/*
        * This was a bare fixed <div>: no Escape, no focus trap, no click
        * outside, no focus return to the control that opened it, and no
        * autoFocus on the PIN field a cashier had opened it to type into. The
        * shared Modal does all five, so the fork is deleted rather than
        * repaired (rulebook 12.1) — and its z-index comes from the scale with
        * it, replacing a hand-typed 40.
        */}
      {open && (
        <Modal
          title={tr('ws.shell.nav.quit')}
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{tr('common.back')}</Button>
              <Button kind="danger" busy={busy} disabled={pin.length < 4} onClick={() => void quit()}>
                {tr('ws.shell.nav.quit')}
              </Button>
            </>
          }
        >
          <Field label={tr('op.common.pin')}>
            <input
              style={inputStyle}
              type="password"
              inputMode="numeric"
              dir="ltr"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <ErrorText error={error} />
        </Modal>
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
        {/* The swoosh, bleeding off the inline end the way it does across the
            brand deck's covers. It settles in behind the lockup; the ONE call
            site of --tp-dur-ceremony in the codebase. Court lines are retired
            here — swoosh or court lines on one navy panel, never both. */}
        <div
          className="tp-swoosh-in"
          style={{ position: 'absolute', insetBlock: '22%', insetInline: '4%' }}
        >
          <BrandSwoosh opacity={0.5} />
        </div>
        <BrandLockup size={40} tone="onDark" style={{ position: 'relative' }} />
        <p style={{ position: 'relative', fontSize: 'var(--tp-fs-3xl)', fontWeight: 700, lineHeight: 1.1, maxInlineSize: '9ch' }}>
          {tr('ws.shell.signIn.tagline')}
        </p>
      </aside>
      <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--tp-sp-6)' }}>
        <form onSubmit={(e) => void submit(e)} className="tp-rise" style={{ inlineSize: 'min(22rem, 100%)', display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <h1 style={{ fontSize: 'var(--tp-fs-2xl)', marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('op.signIn.title')}</h1>
          <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-4)' }}>{tr('ws.shell.signIn.lead')}</p>
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
            <p role="alert" style={{ color: 'var(--tp-danger-fg)', background: 'var(--tp-danger-soft)', borderRadius: 'var(--tp-radius-ctl)', paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-2-5)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>
              {error === 'network' ? tr('ws.shell.signIn.network') : tr('op.signIn.failed')}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBlockStart: 'var(--tp-sp-2)' }}>
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
/**
 * Least-privileged first. `requiredRoleFor` names the SMALLEST role the route
 * table already admits by asking the same `canAccess` the guard above asks —
 * never a second copy of the rules — so the sentence a refused operator reads
 * cannot drift from the check that produced it. Nothing here decides access; it
 * only names what decided it.
 */
const ROLE_ORDER: readonly StaffRole[] = ['prep', 'cashier', 'court_desk', 'manager', 'owner'];
function requiredRoleFor(route: string): StaffRole {
  return ROLE_ORDER.find((r) => canAccess(r, route)) ?? 'owner';
}

export function RequireRole({ route, children }: { route: string; children: ReactNode }) {
  const { staff } = useAuth();
  const { tr } = useLocale();
  if (!canAccess(staff?.role as StaffRole | undefined, route)) {
    return (
      <div style={{ ...card, display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', maxInlineSize: 'var(--tp-measure-form)' }} role="alert">
        {/* This forked its own card with a generic sentence and never said
            which role was missing, so the operator had nothing to act on and no
            one to ask. PermissionRefusedNotice exists for exactly this and
            names the role. */}
        <PermissionRefusedNotice
          action={tr('ws.shell.forbidden.action')}
          requiredRole={requiredRoleFor(route)}
        />
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
