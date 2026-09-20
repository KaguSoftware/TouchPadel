/**
 * Application shell (spec §05): AppBootScreen, StaffSignInScreen,
 * WorkspaceSwitcher entry, SessionLockScreen, WorkspaceShell with the
 * per-workspace navigation rail and the global DegradedBanner region.
 *
 * Five workspaces on one build: the rail is chosen by the ACTIVE WORKSPACE
 * (lib/workspaces.ts), never by filtering one shared menu. The prep workspace
 * renders no navigation at all — a wall-mounted kitchen screen has nothing to
 * get lost in.
 *
 * A workspace with SECTIONS (Management: Setup, Operations) shows one rail
 * button per section; inside one, the rail IS the section — its own header,
 * its own list, and a way back to the workspace. Which section is open comes
 * from the URL, so a deep link and a reload land on the same rail as a click.
 */
import { Link, Outlet, createRootRoute, useNavigate, useRouterState } from '@tanstack/react-router';
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
import { useThemeMode } from '../lib/themeMode';
import {
  WORKSPACES,
  isNavActive,
  loadWorkspace,
  saveWorkspace,
  sectionForPath,
  sectionRailItems,
  workspaceForRoute,
  workspaceOwnsPath,
  workspacesForRole,
  type NavGroup,
  type NavItem,
  type WorkspaceKey,
} from '../lib/workspaces';
import { Button, ErrorText, Field, Modal, Spinner, card, inputStyle, trapTab } from '../components/ui';
import { PermissionRefusedNotice, StatusBadge } from '../components/kit';
import { ChevronBack, ChevronForward, Icon, CourtLines } from '../components/icons';
import { BrandLockup, BrandSwoosh } from '../components/brand';
import { appRpc, AppRpcError } from '../lib/appRpc';
import { supabase } from '../lib/supabase';
import { useCafeSettings } from '../lib/settings';
import { GlobalStyles } from '../components/GlobalStyles';
import { ToastProvider } from '../components/toast';
import { ConfirmProvider, useConfirm } from '../components/ConfirmDialog';
import { touch, type UpdateReadyInfo } from '../ipc/bridge';
import { useHeartbeat, type HeartbeatState } from '../lib/heartbeat';
import { VenueStatusBanner } from '../components/VenueStatusBanner';
import { isElectron } from '../lib/mutate';
import { useUpdateReady } from '../lib/updates';
import { UpdateReadyControl } from '../components/UpdateReady';
import { StationSetupContainer } from '../features/setup/StationSetupContainer';
import { BreakProvider, useBreak } from '../features/breaks/BreakProvider';
import { BreakOverlay } from '../features/breaks/BreakOverlay';
import { BreakRailControl } from '../features/breaks/BreakRailControl';
import { AssistantDrawer, AssistantDrawerProvider, AssistantRailButton } from '../features/assistant/AssistantDrawer';
import { formatPairingCode } from '@touch/core';

export const rootRoute = createRootRoute({
  component: RootProviders,
});

// Global CSS (keyframes + print) and the toast / confirm hosts sit above every
// screen, including sign-in, so any component may call useToast / useConfirm.
function RootProviders() {
  return (
    <>
      <GlobalStyles />
      <WindowDragStrip />
      <ToastProvider>
        <ConfirmProvider>
          {/* The macOS red traffic light's confirmation. It lives up here
              because that button works on EVERY screen — sign-in and the
              first-run setup included — while the rail's Quit row only
              exists once somebody is signed in. Renders nothing until main
              says the button was pressed. */}
          <QuitToDesktop variant="windowClose" />
          <RootShell />
        </ConfirmProvider>
      </ToastProvider>
    </>
  );
}

/**
 * Lets the operator move the macOS window by its top edge, on EVERY screen.
 *
 * It lives up here rather than in WorkspaceShell because most of the screens
 * that need it are the ones rendered before the shell exists — sign-in, first
 * run, the boot and config-error screens — and a window you cannot move while
 * signing in is the one place it is most annoying.
 *
 * Fixed and overlaid, not laid out: the pre-auth screens are 100vh boxes, so a
 * real row would push them past the viewport and grow a scrollbar.
 *
 * `pointerEvents: none` is what makes overlaying safe. A drag region otherwise
 * swallows the clicks under it (electron/electron#1354), which here would eat
 * the top of the rail and of every screen. Chromium registers the draggable
 * region with macOS from the painted box and does NOT consult pointer-events,
 * so the window still drags while the controls underneath stay clickable —
 * verified both ways with real OS mouse events, since the two behaviours look
 * contradictory and neither is documented.
 *
 * Electron on macOS only: titleBarInset is 0/absent on Windows, in browser dev
 * and on every kiosk, and this renders nothing there.
 */
/**
 * Height of the band the macOS traffic lights are drawn into, for the few
 * screens that put something in the top corners and would otherwise put it
 * underneath them. 0 everywhere the lights do not exist.
 */
function useTitleBarInset(): number {
  return useMemo(() => touch.getStation().titleBarInset ?? 0, []);
}

function WindowDragStrip() {
  const inset = useTitleBarInset();
  if (!inset) return null;
  return (
    <div
      aria-hidden="true"
      data-no-print
      style={
        {
          position: 'fixed',
          insetBlockStart: 0,
          insetInline: 0,
          blockSize: inset,
          zIndex: 'var(--tp-z-drag)',
          pointerEvents: 'none',
          WebkitAppRegion: 'drag',
        } as CSSProperties
      }
    />
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
/**
 * The same context for a screen that only ADDS something when it happens to
 * be inside the shell — the kitchen board's way back, which a unit test
 * renders on its own. Nothing depends on it being there, so an absent shell
 * is a fact to read, not a bug to throw on.
 */
export function useWorkspaceOrNull(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
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

  // Station identity comes before the human's (design-arch §2.1). A machine
  // without station.json shows the setup screen instead of sign-in; a machine
  // whose station.json is unreadable is a broken install, shown as such rather
  // than silently trading as TILL1. Both are Electron-only: the browser mock
  // always reports a configured station.
  const station = useMemo(() => touch.getStation(), []);
  if (isElectron() && !station.configured) return <StationSetupContainer />;
  if (isElectron() && station.configError) {
    return <AppBootScreen fullBleed error={tr('ws.shell.setup.configError', { error: station.configError })} />;
  }

  if (loading) return <AppBootScreen fullBleed />;
  if (!session) return <SignInScreen />;
  if (notStaff || !staff) {
    return <NotStaffScreen email={session.user.email ?? null} onSignOut={() => void signOut()} />;
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

/**
 * A signed-in account with no active staff row. This used to be the boot
 * screen's failure face — "The app could not start." over "This account is not
 * registered as staff." with Try again as the primary button — but the app had
 * started fine, and reloading cannot give an account a staff row. What the
 * person can actually do is sign in as somebody else, or have the owner add
 * them and check again, so those are the two buttons, in that order, and the
 * screen says which account it is talking about.
 */
function NotStaffScreen({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const { tr } = useLocale();
  return (
    <div role="alert" style={{ minBlockSize: '100vh', display: 'grid', placeItems: 'center', paddingBlock: 'var(--tp-sp-6)', paddingInline: 'var(--tp-sp-5)', background: 'var(--tp-bg)' }}>
      <div className="tp-rise" style={{ display: 'grid', gap: 'var(--tp-sp-3)', justifyItems: 'center', textAlign: 'center', maxInlineSize: '30rem' }}>
        <BrandLockup size={36} title="Touch Padel" />
        <span style={{ display: 'grid', placeItems: 'center', inlineSize: '3rem', blockSize: '3rem', borderRadius: '50%', background: 'var(--tp-warn-soft)', color: 'var(--tp-warn-fg)', marginBlockStart: 'var(--tp-sp-2)' }}>
          <Icon name="user" size={22} />
        </span>
        <h1 style={{ fontSize: 'var(--tp-fs-2xl)' }}>{tr('ws.shell.signIn.notStaffTitle')}</h1>
        <p style={{ color: 'var(--tp-muted-fg)' }}>
          {tr('ws.shell.signIn.notStaffBody', { email: email ?? '—' })}
        </p>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'center', marginBlockStart: 'var(--tp-sp-2)' }}>
          <Button kind="primary" icon="logOut" onClick={onSignOut}>
            {tr('ws.shell.signIn.otherAccount')}
          </Button>
          <Button icon="refresh" onClick={() => window.location.reload()}>
            {tr('ws.shell.signIn.checkAgain')}
          </Button>
        </div>
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
    if (!ws || ws === active || !(available as readonly string[]).includes(ws)) return;
    // A route the ACTIVE workspace already reaches keeps its own rail. The
    // owner's Observation section lands on /ops, which is also the manager's
    // home: without this, one click on Observation threw the owner out of
    // Management and into the manager rail.
    if (workspaceOwnsPath(active, path)) return;
    setActiveState(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const setActive = useCallback((key: WorkspaceKey) => {
    setActiveState(key);
    saveWorkspace(key);
  }, []);

  const value = useMemo(() => ({ active, available, setActive }), [active, available, setActive]);
  const workspace = WORKSPACES[active];
  const noNav = workspace.groups.length === 0;
  // The kitchen board is a wall-mounted screen: no traffic lights over its
  // header, and so no room to reserve for them either. Both follow noNav, and
  // both are restored the moment the operator leaves the board.
  useEffect(() => {
    touch.pushChromeless(noNav);
  }, [noNav]);
  // Browser mode has no kiosk window to hide chrome on, so the board asks the
  // OS itself for full screen instead — same "wall screen, no chrome" intent
  // as pushChromeless above, just through the other door. Electron already
  // opens its KDS window with `kiosk: true` (main/index.ts), so this would be
  // a no-op there at best and a fight with ExitFullscreen's own control at
  // worst; it runs in browser mode only. Best-effort: a browser can refuse
  // fullscreen (no prior user gesture, permission policy), and the board is
  // usable either way, so failures are swallowed rather than surfaced.
  useEffect(() => {
    if (isElectron()) return;
    if (noNav) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, [noNav]);
  // A downloaded update waiting for a restart: a rail row where there is a
  // rail, a floating pill on the kitchen screen, which has none.
  const update = useUpdateReady();

  return (
    <WorkspaceContext.Provider value={value}>
      {/* Break state (0105) sits above the rail, the routed screen and both
          locks: the rail row starts a break, the overlay owns the station
          while somebody is away, and the idle lock defers to it. */}
      <BreakProvider>
      {/* The owner assistant's drawer (docs/design/assistant §5.1) is one
          sheet for the whole shell: the rail footer row and Ctrl/⌘ K open it,
          and it is mounted once, beside the break overlay. */}
      <AssistantDrawerProvider>
      <div
        data-workspace={active}
        style={{ display: 'flex', flexDirection: 'column', blockSize: '100vh', background: noNav ? 'var(--tp-kds-bg)' : 'var(--tp-bg)' }}
      >
        <SkipToMain />
        <IdleLock />
        <BreakOverlay />
        <AssistantDrawer />
        {/* On the kitchen screen there is no rail, so the strip spans the
            window as it always has. Where there IS a rail it moves inside the
            content column instead — see below. */}
        {noNav && <VenueStatusBanner state={venue} />}
        {noNav && update && (
          <UpdateReadyControl variant="pill" version={update.version} onInstall={() => void touch.installUpdate()} />
        )}
        <div style={{ display: 'flex', flex: 1, minBlockSize: 0 }}>
          {!noNav && <WorkspaceNav workspaceKey={active} path={path} update={update} />}
          {/* tabIndex -1 so the skip link has somewhere to land; the routed
              screen's own first heading is the next stop from here. */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minInlineSize: 0, minBlockSize: 0 }}>
            {/* The strip starts where the rail ends, not at the window's edge.
                Full width, it ran under the macOS traffic lights: 'hiddenInset'
                draws them INSIDE the page, and the rail is the only thing that
                reserves room for them (its spacer). Beginning after the blue
                panel puts the strip clear of the buttons without a second
                inset to keep in step with the first. */}
            {!noNav && <VenueStatusBanner state={venue} />}
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
      </div>
      </AssistantDrawerProvider>
      </BreakProvider>
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
  // LONGHANDS, not `font: inherit`. The shorthand also resets font-weight, and
  // inline styles outrank class rules, so it silently overrode .tp-nav-item's
  // 500 and [data-active]'s 700 on every rail control that is a <button> —
  // leaving them a weight lighter than the <Link> rows beside them. Operations
  // is where that shows, because its collapsible group titles are the only
  // buttons sitting directly above links in the same list.
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  textAlign: 'start',
};

/** One rail destination. Same row whether it comes from a group or a section. */
function RailLink({ item, path }: { item: NavItem; path: string }) {
  const { tr } = useLocale();
  const active = isNavActive(item, path);
  return (
    <Link
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
}

const RAIL_OPEN_KEY = 'touch-operator-rail-open';

function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(RAIL_OPEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveOpenGroup(key: string, open: boolean): void {
  try {
    localStorage.setItem(RAIL_OPEN_KEY, JSON.stringify({ ...loadOpenGroups(), [key]: open }));
  } catch {
    /* private mode */
  }
}

/**
 * A titled group of rail rows that opens and closes from its title.
 *
 * Closed by default so the rail reads as a short list of places (Today, Run
 * the day, Records, Setup) rather than twelve rows. Two rules keep it from
 * hiding where the operator is:
 *
 *  - The group holding the current screen opens itself, including when the
 *    operator arrives there from a link on another screen, so the lit row is
 *    never tucked away inside a closed group.
 *  - What the operator opened or closed by hand is remembered on this station,
 *    so a manager who keeps Setup shut does not have to shut it every shift.
 *
 * The rows are `inert` while closed, so Tab never lands on something that
 * cannot be seen. The height animates through a 0fr → 1fr grid track, which
 * needs no measured height and is cut to nothing by the reduced-motion rule
 * in GlobalStyles.
 */
function RailGroup({ labelKey, items, path }: { labelKey: NonNullable<NavGroup['labelKey']>; items: readonly NavItem[]; path: string }) {
  const { tr } = useLocale();
  const holdsActive = items.some((item) => isNavActive(item, path));
  const [open, setOpen] = useState(() => holdsActive || loadOpenGroups()[labelKey] === true);
  const listId = `rail-group-${labelKey}`;

  useEffect(() => {
    if (holdsActive) setOpen(true);
  }, [holdsActive]);

  const toggle = () => {
    setOpen((cur) => {
      saveOpenGroup(labelKey, !cur);
      return !cur;
    });
  };

  return (
    <div style={{ display: 'grid' }}>
      <button
        type="button"
        className="tp-nav-item tp-rail-group"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        style={navButtonStyle}
      >
        <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tr(`ws.shell.nav.${labelKey}`)}
        </span>
        <span className="tp-rail-group-chevron" style={{ display: 'inline-flex' }}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      <div id={listId} className="tp-rail-group-body" data-open={open ? 'true' : undefined}>
        <div style={{ overflow: 'hidden', minBlockSize: 0 }} inert={!open}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', paddingBlockStart: 'var(--tp-sp-0)' }}>
            {items.map((item) => (
              <RailLink key={item.to} item={item} path={path} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceNav — the rail. Props: items, activeKey, role (spec §07).
// ---------------------------------------------------------------------------
function WorkspaceNav({
  workspaceKey,
  path,
  update,
}: {
  workspaceKey: WorkspaceKey;
  path: string;
  update: UpdateReadyInfo | null;
}) {
  const { tr, toggleLocale, locale } = useLocale();
  const { mode, toggleMode } = useThemeMode();
  const { staff, signOut } = useAuth();
  const { available } = useWorkspace();
  const station = touch.getStation();
  const workspace = WORKSPACES[workspaceKey];
  // Only the jokers change workspace (owner call, 2026-09-18): a cashier or a
  // desk clerk has one, and the row was never more than a dead end for them.
  const canSwitch = available.length > 1 && (staff?.role === 'manager' || staff?.role === 'owner');
  const navigate = useNavigate();
  const confirm = useConfirm();
  // Leaving a workspace, or a section for its workspace, is a move the person
  // may not have meant — the rail's foot is where fingers rest — so both ask
  // first, in the same words.
  const leaveTo = async (to: string, destination: string) => {
    const ok = await confirm({
      title: tr('ws.shell.nav.leaveTitle', { destination }),
      body: tr('ws.shell.nav.leaveBody'),
      confirmLabel: tr('ws.shell.nav.leaveConfirm'),
      kind: 'primary',
    });
    if (ok) void navigate({ to });
  };
  // Inside a section the rail IS the section: its name, its list, and one way
  // back. Read from the path, so the rail and the screen can never disagree.
  const section = sectionForPath(workspace, path);
  const sections = (workspace.sections ?? []).filter((sec) => canAccess(staff?.role, sec.home));

  return (
    <nav
      data-no-print
      aria-label={section ? tr(`ws.shell.section.${section.key}`) : tr(`ws.shell.workspace.${workspaceKey}`)}
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
      {/* Rail header: the one committed brand surface.

          Its top padding ALSO carries the room the macOS traffic lights need
          ('hiddenInset' draws them inside the page, right here). That used to
          be a separate spacer above this block, which read as an empty navy
          band between the buttons and the lockup — the court lines started
          below it and the header looked pushed down. Folding it into the
          header's own padding clears the buttons with no band. 0 on Windows,
          in browser dev, and on every kiosk, where the scale value stands. */}
      <div
        style={{
          position: 'relative',
          paddingBlockStart: station.titleBarInset ? `${station.titleBarInset}px` : 'var(--tp-sp-4)',
          paddingBlockEnd: 'var(--tp-sp-3)',
          paddingInline: RAIL_EDGE,
          borderBlockEnd: '1px solid var(--tp-rail-border)',
          overflow: 'hidden',
        }}
      >
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <CourtLines opacity={0.16} />
        </div>
        <div style={{ position: 'relative' }}>
          {/* 34, not the old 26: the header's top padding grew to clear the
              macOS traffic lights, and at 26 the lockup read as small against
              it. Still below the sign-in screen's 40, which is the hero. */}
          <BrandLockup size={34} tone="onDark" />
          {/* The way out of a section, in the place a browser back button
              would be and above the name of where you are. Sizing, surface and
              colour live in .tp-rail-back (GlobalStyles) — this is a control,
              not a footnote: a section is somewhere the operator passes
              through, so leaving it is the most-pressed row on the panel. */}
          {section && (
            /*
              The visible text is the DESTINATION's name; the chevron carries
              "back", the way a platform back control does. "Back to
              Management" does not fit a 208px rail at --tp-fs-sm/600 and was
              rendering as "Back to Managem…", which truncates the one word
              that says where you are going. The full phrase stays as the
              accessible name, so a screen reader still hears "Back to
              Management" and only the pixels are shorter.
            */
            <button
              type="button"
              className="tp-rail-back"
              style={{ marginBlockStart: 'var(--tp-sp-2-5)', font: 'inherit', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, cursor: 'pointer', textAlign: 'start' }}
              aria-label={tr('ws.shell.nav.backTo', { workspace: tr(`ws.shell.workspace.${workspaceKey}`) })}
              onClick={() => void leaveTo(workspace.home, tr(`ws.shell.workspace.${workspaceKey}`))}
            >
              <ChevronBack size={14} />
              <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tr(`ws.shell.workspace.${workspaceKey}`)}
              </span>
            </button>
          )}
          {/* One gap either way now. The section case used to be tightened to
              --tp-sp-1 so the back link read as part of the title below it;
              the back link is a bordered control now, and crowding a title
              against its edge just looks like a mistake. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'var(--tp-sp-2-5)' }}>
            <span style={{ display: 'inline-flex', color: 'var(--tp-rail-green)' }}>
              <Icon name={section ? section.icon : workspace.icon} size={16} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)', color: 'var(--tp-brand-white)' }}>
              {section ? tr(`ws.shell.section.${section.key}`) : tr(`ws.shell.workspace.${workspaceKey}`)}
            </span>
          </div>
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', marginBlockStart: 'var(--tp-sp-0)' }}>
            {section ? tr(`ws.shell.sectionLead.${section.key}`) : tr(`ws.shell.workspaceLead.${workspaceKey}`)}
          </p>
        </div>
      </div>

      {/* Collapsible groups carry their own 44px title row, so they stack at a
          small gap; the wide gap is for plain lists that have no title between
          them. */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingBlock: 'var(--tp-sp-2-5)',
          paddingInline: RAIL_PAD,
          display: 'grid',
          gap: !section && workspace.groups.some((g) => g.labelKey) ? 'var(--tp-sp-1)' : 'var(--tp-sp-4)',
          alignContent: 'start',
        }}
      >
        {section ? (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {sectionRailItems(section)
              .filter((item) => canAccess(staff?.role, item.to))
              .map((item) => (
                <RailLink key={item.to} item={item} path={path} />
              ))}
          </div>
        ) : (
          <>
            {workspace.groups.map((group, gi) => {
              const items = group.items.filter((item) => canAccess(staff?.role, item.to));
              if (items.length === 0) return null;
              return group.labelKey ? (
                <RailGroup key={group.labelKey} labelKey={group.labelKey} items={items} path={path} />
              ) : (
                <div key={gi} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                  {items.map((item) => (
                    <RailLink key={item.to} item={item} path={path} />
                  ))}
                </div>
              );
            })}

            {/* One row per section, chevron forward: this opens a place, it
                does not switch a screen. */}
            {sections.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                {sections.map((sec) => (
                  <Link key={sec.key} to={sec.home} className="tp-nav-item" style={navItemStyle}>
                    <Icon name={sec.icon} size={17} />
                    <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tr(`ws.shell.section.${sec.key}`)}
                    </span>
                    <ChevronForward size={14} />
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ borderBlockStart: '1px solid var(--tp-rail-border)', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: RAIL_PAD, display: 'grid', gap: 'var(--tp-sp-0)' }}>
        {canSwitch && path !== '/workspaces' && (
          <button type="button" className="tp-nav-item" style={navButtonStyle} onClick={() => void leaveTo('/workspaces', tr('ws.shell.nav.switchWorkspace'))}>
            <Icon name="repeat" size={16} />
            <span>{tr('ws.shell.nav.switchWorkspace')}</span>
          </button>
        )}
        {/* The owner assistant: owner only (it renders nothing otherwise). */}
        <AssistantRailButton style={navButtonStyle} />
        <button type="button" className="tp-nav-item" onClick={toggleLocale} style={navButtonStyle}>
          <Icon name="globe" size={16} />
          <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>
        </button>
        {/* The appearance switch sits with the language switch: both are
            station preferences, both name where the press takes you. */}
        <button type="button" className="tp-nav-item" onClick={toggleMode} style={navButtonStyle} aria-pressed={mode === 'blue'}>
          <Icon name={mode === 'blue' ? 'sun' : 'moon'} size={16} />
          <span>{tr(mode === 'blue' ? 'ws.shell.nav.lightMode' : 'ws.shell.nav.blueMode')}</span>
        </button>
        <button type="button" className="tp-nav-item" onClick={() => void signOut()} style={navButtonStyle}>
          <Icon name="logOut" size={16} />
          <span>{tr('auth.signOut')}</span>
        </button>
        <PairKitchenScreen />
        {update && (
          <UpdateReadyControl
            variant="rail"
            version={update.version}
            onInstall={() => void touch.installUpdate()}
            style={navButtonStyle}
          />
        )}

        {/* 0105: "Go on break" / "{name} is back". Same box as the rows above
            it; its caption uses the identity block's muted line. */}
        <BreakRailControl
          style={navButtonStyle}
          captionStyle={{ paddingInline: RAIL_ITEM_PAD, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)' }}
        />

        {/* Rulebook 4.5 wants the role and the scoped context legible at all
            times. One line reading "Mohammed Al-Rashid · Court desk · TILL-01"
            inside a 13.5rem rail truncated to about the first name, so in
            practice neither the role nor the station was visible at all. Name
            and role share a line because they answer "who is signed in"; the
            station answers "which till" and gets its own, using the
            ws.shell.nav.station key that had been sitting unused. */}
        <RailIdentity />
        <div style={{ paddingInline: RAIL_ITEM_PAD, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <p
            title={tr('ws.shell.nav.station', { id: station.stationId })}
            style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {tr('ws.shell.nav.station', { id: station.stationId })}
          </p>
          {/* The shell build, so "which version is that till on" is answerable
              from the till itself and not only from device_heartbeats. */}
          {/* The version is isolated, not the line: `dir="ltr"` on the whole
              paragraph pinned the Arabic "الإصدار dev" to the rail's left edge
              while every other identity line sat on the right. */}
          <p
            style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}
          >
            {/* U+2068/U+2069 isolate the Latin version inside either direction. */}
            {tr('ws.shell.nav.version', { version: `\u2068${station.appVersion}\u2069` })}
          </p>
        </div>

        <QuitToDesktop />
      </div>
    </nav>
  );
}

/**
 * Who is at this station. Normally the signed-in person and their role; while
 * a cover holds the till (0105) it is the cover's name with a "Covering"
 * badge and, underneath, whom they are covering for — the session behind the
 * screen is still the first person's, and the rail must not pretend otherwise.
 */
function RailIdentity() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const brk = useBreak();
  const cover = brk.phase === 'covered' ? (brk.status?.open?.cover ?? null) : null;
  const name = cover ? cover.display_name : staff?.displayName;
  return (
    <div style={{ paddingInline: RAIL_ITEM_PAD, paddingBlockStart: 'var(--tp-sp-2)', display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
        <bdi
          title={name}
          style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-brand-white)' }}
        >
          {name}
        </bdi>
        <StatusBadge
          size="sm"
          dot={false}
          tone={cover ? 'warn' : 'neutral'}
          label={cover ? tr('ws.shell.break.covering') : tr(`op.roles.${staff?.role ?? 'cashier'}`)}
          style={{ flexShrink: 0 }}
        />
      </div>
      {cover && (
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tr('ws.shell.break.coveringFor', { name: staff?.displayName ?? '' })}
        </p>
      )}
    </div>
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
  const brk = useBreak();
  /**
   * 0105. While somebody COVERS the station, the lock asks for THEIR PIN —
   * the signed-in person is on a break and not here to type theirs. The
   * cover's PIN is re-verified through app.cover_station, which is
   * idempotent for the same person. `ownerBack` is the other way off: the
   * person on break has returned to a locked till and ends the break with
   * their own PIN, which unlocks as well. While the person is AWAY with no
   * cover, the break screen is the lock, and this one stands down.
   */
  const cover = brk.phase === 'covered' ? (brk.status?.open?.cover ?? null) : null;
  const [ownerBack, setOwnerBack] = useState(false);
  const timeoutS = settings.till_idle_lock_seconds;
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const lastActivity = useRef(Date.now());
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // "Type your PIN first" — shown on the field when Unlock is pressed empty.
  const [empty, setEmpty] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const enabled = !!staff && timeoutS > 0 && brk.phase !== 'away';

  /**
   * SEC-34, the self-unlock gap. Does THIS person have an unlock PIN?
   *
   * PINs are only ever set on manager and owner accounts — a PIN is the manager
   * AUTHORISATION on the money paths, so nobody has had a reason to give the
   * cashier who actually works this till one. Until 0087 the screen could not
   * know that, so it showed everybody a PIN box and only offered the password
   * AFTER a wrong guess. A cashier had to fail at a credential they were never
   * issued, in front of a queue, before being shown the one they have. That is
   * how a lock becomes a nuisance and a shared manager PIN becomes the fix.
   *
   * `null` = not yet known. The screen renders the PIN field meanwhile, because
   * the answer arrives in one round trip and flipping a field out from under
   * somebody who has already started typing is worse than a brief default. The
   * NO_PIN_SET fallback in `unlock()` stays as the backstop for exactly that
   * race — and for an account whose PIN is cleared while the till sits locked.
   */
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!locked || hasPin !== null) return;
    let cancelled = false;
    void appRpc<boolean>('has_own_pin', {})
      .then((v) => {
        if (cancelled) return;
        setHasPin(v);
        // Only switch TO the password. Never switch away from it: if the person
        // has already chosen "Use password instead", this answer must not yank
        // the field back to a PIN box mid-typing.
        if (!v) setUsePassword(true);
      })
      // A failed probe is not an answer. Leaving hasPin null keeps the PIN
      // field and the NO_PIN_SET fallback, which is exactly the old behaviour.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locked, hasPin]);

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
    // SEC-34: an account with NO pin stays on the password field. Resetting to
    // the PIN box would put the cashier back in front of the credential they do
    // not have on the very next idle timeout, which is the whole gap.
    setUsePassword(hasPin === false);
    setOwnerBack(false);
    setError(null);
    setEmpty(false);
    lastActivity.current = Date.now();
  }

  /**
   * A wrong PIN used to leave focus nowhere: the field was `disabled` while
   * the check ran, and a disabled control drops focus, so every retry started
   * with a tap back into the box. The fields are read-only while busy instead
   * and focus is put back here, so a mistyped PIN is fixed by just typing.
   */
  function refocus() {
    requestAnimationFrame(() => fieldRef.current?.focus());
  }

  function switchMode(toPassword: boolean) {
    setUsePassword(toPassword);
    setError(null);
    setEmpty(false);
    setPin('');
    setPassword('');
    refocus();
  }

  // The password belongs to the signed-in account; a cover has only a PIN.
  const pinOnly = !!cover;
  const askPassword = usePassword && !pinOnly;

  async function unlock() {
    if (busy) return;
    if ((askPassword ? password : pin).length === 0) {
      setEmpty(true);
      refocus();
      return;
    }
    setEmpty(false);
    setBusy(true);
    setError(null);
    try {
      if (cover) {
        // Both throw PIN_INVALID / PIN_LOCKED like verify_own_pin would.
        if (ownerBack) await brk.end(pin);
        else await brk.cover(cover.id, pin);
        clearAndUnlock();
        return;
      }
      if (askPassword) {
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
        refocus();
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
      refocus();
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
      {/*
        Who is signed in is the headline, because it is the first thing anyone
        walking up to a locked till needs: is this my session or somebody
        else's? Then one field, one full-width Unlock, and the two ways out as
        quiet links underneath. The old card spread Switch user, Use password
        instead and Unlock over three ragged lines of equal-looking buttons,
        and once someone chose the password there was no way back to the PIN.

        The logo sits above the card, centered with it as one column, rather
        than pinned to the corner — this is the longest-lived full-screen
        brand moment in a shift, so the mark belongs with the card it is
        introducing, not off in a corner unrelated to it.
      */}
      <div style={{ position: 'relative', display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-6)' }}>
        <BrandLockup size={96} tone="onDark" />
        <div ref={cardRef} tabIndex={-1} className="tp-rise" style={{ ...card, outline: 'none', inlineSize: 'min(24rem, 92vw)', boxShadow: 'var(--tp-shadow-dialog)', paddingBlock: 'var(--tp-sp-5)', paddingInline: 'var(--tp-sp-5)', display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>
              <Icon name="lock" size={15} />
              {tr('ws.shell.lock.title')}
            </p>
            <h2 style={{ fontSize: 'var(--tp-fs-2xl)', display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              <bdi>{cover && !ownerBack ? cover.display_name : staff.displayName}</bdi>
              {cover && !ownerBack ? (
                <StatusBadge size="sm" dot={false} tone="warn" label={tr('ws.shell.break.covering')} />
              ) : (
                <StatusBadge size="sm" dot={false} label={tr(`op.roles.${staff.role}`)} />
              )}
            </h2>
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {/* SEC-34: say WHY the password is being asked for, so a cashier with
                  no PIN is not left wondering what they have forgotten. */}
              {cover
                ? ownerBack
                  ? tr('ws.shell.break.endLead')
                  : tr('ws.shell.break.lockCovering', { name: cover.display_name })
                : hasPin === false && usePassword
                  ? tr('ws.shell.lock.hintPassword')
                  : tr('ws.shell.lock.hint')}
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}
          >
            {askPassword ? (
              <Field
                label={tr('auth.passwordLabel')}
                error={empty ? tr('ws.shell.lock.passwordFirst') : undefined}
                hint={capsLock ? tr('ws.shell.signIn.capsLock') : undefined}
                style={{ marginBlockEnd: 0 }}
              >
                <input
                  ref={fieldRef}
                  style={inputStyle}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  autoFocus
                  readOnly={busy}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setEmpty(false);
                  }}
                  onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                  onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                />
              </Field>
            ) : (
              <Field label={tr('ws.shell.lock.pin')} error={empty ? tr('ws.shell.lock.pinFirst') : undefined} style={{ marginBlockEnd: 0 }}>
                <input
                  ref={fieldRef}
                  style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={pin}
                  autoFocus
                  readOnly={busy}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ''));
                    setEmpty(false);
                  }}
                />
              </Field>
            )}
            <ErrorText error={error} style={{ marginBlock: 0 }} />
            <Button kind="primary" size="lg" type="submit" icon="lock" busy={busy} style={{ inlineSize: '100%' }}>
              {tr('ws.shell.lock.unlock')}
            </Button>
          </form>
          {/*
           * Both links wrap. In Arabic the pair is wider than the card, and a
           * rigid row pushed the second one off the card's inline-end edge.
           */}
          <div style={{ display: 'flex', gap: 'var(--tp-sp-1) var(--tp-sp-2)', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Offered only to somebody who HAS a PIN. For a cashier with none,
                the password is the only route, and a PIN link would imply a PIN
                they could have used. */}
            {cover ? (
              <Button
                kind="ghost"
                size="sm"
                icon={ownerBack ? undefined : 'undo'}
                onClick={() => {
                  setOwnerBack((v) => !v);
                  setError(null);
                  setPin('');
                  refocus();
                }}
                disabled={busy}
              >
                {ownerBack ? tr('ws.shell.break.chooseAgain') : tr('ws.shell.break.lockOwnerBack', { cover: cover.display_name, name: staff.displayName })}
              </Button>
            ) : hasPin !== false ? (
              <Button kind="ghost" size="sm" onClick={() => switchMode(!usePassword)} disabled={busy}>
                {usePassword ? tr('ws.shell.lock.usePin') : tr('ws.shell.lock.usePassword')}
              </Button>
            ) : (
              <span />
            )}
            <Button kind="ghost" size="sm" icon="logOut" onClick={() => void signOut()} disabled={busy}>
              {tr('ws.shell.lock.switchUser', { name: staff.displayName })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "Exit forced full screen" — the middle ground between a kiosk and Quit.
 *
 * Production till and KDS windows open with `kiosk: true` (main/index.ts
 * createWindow), which on macOS takes the menu bar and the traffic lights and
 * on Windows takes the taskbar. That is right for trading and wrong for the
 * half hour where someone has to reach the OS: install a printer driver, take
 * a support call, open a PDF beside the till. Until now the only way out of
 * that was Quit, which ends service to answer a question that did not need
 * service ended.
 *
 * So this leaves the kiosk and leaves the app running. No confirmation and no
 * PIN: nothing is lost, the station keeps trading, and the operator can drop
 * back to full screen from the OS. It is deliberately quieter than Quit —
 * same muted rail weight, no danger colour — because it is the reversible one.
 *
 * Electron fixes `frame` at window creation, so a production window cannot
 * grow a titlebar here; main compensates by resizing it off full-bleed, which
 * is what actually reads as "you are out" on both platforms.
 *
 * Nothing at all in browser mode (rulebook 4.4), where there is no kiosk.
 */
function ExitFullscreen() {
  const { tr } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Only while the window IS full screen. Windowed, the macOS traffic lights
  // are right there and this row is a second control for what the green one
  // already does; full screen, they are hidden behind a mouse-to-the-top
  // reveal a touch station cannot perform, and this is the only way back.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.touch) return;
    return touch.onFullscreenState(setFullscreen);
  }, []);

  if (typeof window === 'undefined' || !window.touch) return null;
  if (!fullscreen) return null;

  async function exit() {
    setBusy(true);
    setError(null);
    try {
      const res = await touch.exitFullscreen();
      if (!res.ok) throw new Error(res.error ?? 'refused');
      // No success line: the window visibly leaving full screen IS the
      // feedback, and a rail that keeps a sentence around after the fact only
      // adds something to ignore. A failure still speaks, below.
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="tp-nav-item"
        onClick={() => void exit()}
        disabled={busy}
        style={{ ...navButtonStyle, color: 'var(--tp-rail-muted)' }}
      >
        <Icon name="shrink" size={16} />
        <span>{tr('ws.shell.nav.exitFullscreen')}</span>
      </button>
      {error != null && (
        <div style={{ paddingInline: RAIL_ITEM_PAD }}>
          <ErrorText error={error} />
        </div>
      )}
    </>
  );
}

/**
 * "Quit to desktop" (design-arch §2.5) — production kiosk windows are not
 * closable any other way. Hidden entirely in browser mode.
 *
 * NO CREDENTIAL. This sat behind the manager PIN (verify_manager_pin online,
 * main's offline cache otherwise) so a till could not be casually ended. That
 * gate is gone by request: what remains is a plain confirmation that names the
 * cost, and main exits on the word of the renderer alone. The dialog is the
 * whole protection against a stray tap now, which is why it stays.
 *
 * Rulebook 7.8: it carries its own separator and its own muted weight because
 * it ENDS SERVICE on this till, and it used to sit directly beneath "Sign out"
 * at identical weight in the same 2px-gap grid — one row's slip from a routine
 * action to a destructive one. The rule lives here rather than in the rail so
 * that in browser mode, where this component renders nothing, it leaves no
 * stray line behind (rulebook 4.4).
 *
 * TWO PLACEMENTS. The rail is only reachable once someone is signed
 * in, so a kiosk sitting at sign-in — powered on by mistake, or signed out at
 * the end of the night — had no way out of a frameless, non-closable window at
 * all. `variant="signIn"` puts the same control where that window's own close
 * button would be. It carries its own placement for the same reason the rail
 * variant carries its own separator: browser mode then renders nothing rather
 * than an empty corner box.
 */
function QuitToDesktop({ variant = 'rail' }: { variant?: 'rail' | 'signIn' | 'windowClose' }) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The sign-in variant sits in the top INLINE-END corner, inside the band
  // the window-drag strip covers. It has to out-rank that strip and opt out
  // of the drag, or the corner it lives in belongs to the window, not to it.
  const inset = useTitleBarInset();

  // 'windowClose' renders no control of its own: it is the macOS red traffic
  // light's dialog. Main prevents the close and pushes touch:close-requested,
  // and the window stays open until the operator confirms here.
  useEffect(() => {
    if (variant !== 'windowClose') return;
    if (typeof window === 'undefined' || !window.touch) return;
    return touch.onCloseRequested(() => setOpen(true));
  }, [variant]);

  if (typeof window === 'undefined' || !window.touch) return null;
  // The sign-in control stands down where the red traffic light already asks
  // this question. It stays on a till or a KDS: those kiosks have no traffic
  // lights, and with the rail behind a sign-in it is their only way out.
  if (variant === 'signIn' && inset) return null;

  async function quit() {
    setBusy(true);
    setError(null);
    try {
      // Main exits ~50 ms after replying, so `busy` is the last thing the
      // screen shows. A refusal only reaches here in browser mode, where the
      // control does not render at all — it is surfaced rather than swallowed
      // so a future refusal cannot fail silently on a station.
      const res = await touch.quitApp();
      if (!res.ok) throw new Error(res.error ?? 'refused');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <>
      {variant === 'windowClose' ? null : variant === 'rail' ? (
        <div style={{ marginBlockStart: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-1)', borderBlockStart: '1px solid var(--tp-rail-border)' }}>
          {/* Above Quit, inside Quit's separator rather than behind one of its
              own: both rows are "get out of the kiosk", and the destructive one
              stays last so the reversible one is what a hurried tap lands on. */}
          <ExitFullscreen />
          <button
            type="button"
            className="tp-nav-item"
            onClick={() => setOpen(true)}
            style={{ ...navButtonStyle, color: 'var(--tp-rail-muted)' }}
          >
            <Icon name="x" size={16} />
            <span>{tr('ws.shell.nav.quit')}</span>
          </button>
        </div>
      ) : (
        <Button
          kind="ghost"
          size="sm"
          icon="x"
          onClick={() => setOpen(true)}
          style={
            {
              position: 'absolute',
              insetBlockStart: 'var(--tp-sp-3)',
              insetInlineEnd: 'var(--tp-sp-3)',
              color: 'var(--tp-muted-fg)',
              // Above the drag strip, and not draggable itself: this corner is
              // the button's, even though the strip crosses it.
              ...(inset
                ? { zIndex: 'var(--tp-z-drag-over)', WebkitAppRegion: 'no-drag' }
                : {}),
            } as CSSProperties
          }
        >
          {tr('ws.shell.nav.quit')}
        </Button>
      )}
      {/*
        * This was a bare fixed <div>: no Escape, no focus trap, no click
        * outside, and no focus return to the control that opened it. The shared
        * Modal does all four, so the fork is deleted rather than repaired
        * (rulebook 12.1) — and its z-index comes from the scale with it,
        * replacing a hand-typed 40. With the PIN field gone, Escape and the
        * returned focus are the whole undo for a mis-tap.
        */}
      {open && (
        <Modal
          title={tr('ws.shell.nav.quit')}
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{tr('common.back')}</Button>
              <Button kind="danger" busy={busy} onClick={() => void quit()}>
                {tr('ws.shell.nav.quit')}
              </Button>
            </>
          }
        >
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.nav.quitConfirm')}</p>
          <ErrorText error={error} />
        </Modal>
      )}
    </>
  );
}

/**
 * "Pair a kitchen screen" — the till's pairing card (design-arch §2.4; SEC-31
 * "a bearer token minted at pairing"). The code IS the LAN secret, so it sits
 * behind the same manager-PIN gate as Quit: verify_manager_pin server-side
 * when online, the offline cache in main otherwise (touch:get-pairing-info
 * re-checks). Till stations only; nothing at all in browser mode.
 */
function PairKitchenScreen() {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ host: string | null; port: number; code: string } | null>(null);
  const [refusal, setRefusal] = useState<'not-a-till' | 'no-psk' | 'custom-psk' | null>(null);
  if (!isElectron() || touch.getStation().mode !== 'till') return null;

  function close() {
    setOpen(false);
    setPin('');
    setInfo(null);
    setRefusal(null);
    setError(null);
  }

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      try {
        // verify_manager_pin RETURNS null for a wrong PIN (it raises only for a
        // lockout or a non-staff caller). Treating that null as success cached the
        // wrong PIN as observed and the shell's cache check then passed it: any
        // PIN opened this gate while online. Refuse here, before the cache learns it.
        const authorizer = await appRpc<string | null>('verify_manager_pin', {
          p_pin: pin,
          p_device_id: touch.getStation().stationId,
        });
        if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
        touch.pinObserved(pin);
      } catch (e) {
        // Offline: fall through to the cache check in main. A server REFUSAL
        // (PIN_INVALID / PIN_LOCKED) still surfaces.
        if (e instanceof AppRpcError && e.code !== 'UNKNOWN') throw e;
      }
      const res = await touch.getPairingInfo(pin);
      if (!('ok' in res)) throw new Error(res.error);
      if (!res.ok) {
        if (res.error === 'pin not recognised') throw new Error(res.error);
        setRefusal(res.error);
        return;
      }
      setInfo({ host: res.host, port: res.port, code: res.code });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const refusalKey = { 'not-a-till': 'notTill', 'no-psk': 'noPsk', 'custom-psk': 'customPsk' } as const;

  return (
    <>
      <button type="button" className="tp-nav-item" onClick={() => setOpen(true)} style={navButtonStyle}>
        <Icon name="qr" size={16} />
        <span>{tr('ws.shell.nav.pairKitchen')}</span>
      </button>
      {open && (
        <Modal
          title={tr('ws.shell.pair.title')}
          size="sm"
          onClose={close}
          footer={
            info || refusal ? (
              <Button kind={info ? 'primary' : 'default'} onClick={close}>
                {tr(info ? 'ws.shell.pair.done' : 'common.back')}
              </Button>
            ) : (
              <>
                <Button onClick={close}>{tr('common.back')}</Button>
                {/* Says what it does. It used to repeat the dialog's title,
                    "Pair a kitchen screen", which pairs nothing: it shows a code. */}
                <Button kind="primary" icon="eye" busy={busy} disabled={pin.length < 4} onClick={() => void reveal()}>
                  {tr('ws.shell.pair.reveal')}
                </Button>
              </>
            )
          }
        >
          {info ? (
            /*
             * Two numbered steps with the code between them, in the order they
             * happen at the kitchen screen. The QR code that sat under the code
             * is gone: nothing reads it — the kitchen screen's setup has a text
             * field and no camera — so it was a large square that looked like
             * the thing to use. The port is gone too: nothing asks for it.
             */
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
              <PairStep n={1}>{tr('ws.shell.pair.step1')}</PairStep>
              <PairStep n={2}>
                {tr('ws.shell.pair.step2')}
                <p
                  dir="ltr"
                  aria-label={tr('ws.shell.pair.code')}
                  style={{
                    marginBlockStart: 'var(--tp-sp-2)',
                    paddingBlock: 'var(--tp-sp-3)',
                    paddingInline: 'var(--tp-sp-3)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                    textAlign: 'center',
                    fontSize: 'var(--tp-fs-3xl)',
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--tp-fg)',
                  }}
                >
                  {formatPairingCode(info.code)}
                </p>
              </PairStep>
              <li style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                {info.host ? tr('ws.shell.pair.host', { host: `\u2068${info.host}\u2069`, port: String(info.port) }) : tr('ws.shell.pair.noHost')}
              </li>
            </ol>
          ) : refusal ? (
            <p role="alert">{tr(`ws.shell.pair.${refusalKey[refusal]}`)}</p>
          ) : (
            <>
              <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.shell.pair.pinLead')}</p>
              <Field label={tr('op.common.pin')}>
                <input
                  style={inputStyle}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  autoFocus
                  value={pin}
                  readOnly={busy}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && !busy && void reveal()}
                />
              </Field>
              <ErrorText error={error} />
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** One numbered instruction in the pairing card. */
function PairStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1.5rem 1fr', columnGap: 'var(--tp-sp-2)', alignItems: 'start' }}>
      <span
        aria-hidden="true"
        style={{
          display: 'grid',
          placeItems: 'center',
          inlineSize: '1.375rem',
          blockSize: '1.375rem',
          borderRadius: '999px',
          fontSize: 'var(--tp-fs-xs)',
          fontWeight: 700,
          background: 'var(--tp-accent-soft)',
          color: 'var(--tp-accent-soft-fg)',
        }}
      >
        {n}
      </span>
      <div>{children}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// StaffSignInScreen — email + password. States: ready · busy · error.
// ---------------------------------------------------------------------------
type SignInFailure = 'invalid' | 'network' | 'disabled';

/**
 * What went wrong, in the three cases a person can do something different
 * about. Supabase says "User is banned" for an account an owner turned off —
 * that used to read as a wrong password, so a disabled cashier kept retyping
 * a password that was right. The "disabled" copy had been sitting unused.
 */
function signInFailure(err: unknown): SignInFailure {
  const e = err as { name?: string; message?: string; status?: number; code?: string } | null;
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.name === 'AuthRetryableFetchError' || e?.status === 0 || msg.includes('fetch') || msg.includes('network')) return 'network';
  if (e?.code === 'user_banned' || msg.includes('banned')) return 'disabled';
  return 'invalid';
}

function SignInScreen() {
  const { signIn } = useAuth();
  const { tr, toggleLocale, locale, dir } = useLocale();
  const { mode, toggleMode } = useThemeMode();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInFailure | null>(null);
  // Which field was empty on submit. The button used to sit disabled until
  // both were filled, which told nobody why it would not press.
  const [missing, setMissing] = useState<'email' | 'password' | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // The traffic lights stay at the window's physical top-LEFT in both
  // languages, while these two panels are placed logically — so the navy panel
  // is under them in English and the form panel is under them in Arabic.
  // Whichever is physically first takes the padding.
  const inset = useTitleBarInset();
  const navyIsUnderLights = dir === 'ltr';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) {
      setMissing('email');
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setMissing('password');
      passwordRef.current?.focus();
      return;
    }
    setMissing(null);
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const kind = signInFailure(err);
      setError(kind);
      // A wrong password is retyped, not edited: clear it and put the cursor
      // back. A network failure keeps both, because nothing was wrong with them.
      if (kind === 'invalid') setPassword('');
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const caps = (ev: KeyboardEvent<HTMLInputElement>) => setCapsLock(ev.getModifierState('CapsLock'));

  return (
    <div style={{ minBlockSize: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)', background: 'var(--tp-bg)' }}>
      <aside
        aria-hidden="true"
        style={
          {
            position: 'relative',
            background: 'var(--tp-rail)',
            color: 'var(--tp-brand-white)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '2rem',
            // Room for the macOS traffic lights, in English — in Arabic this
            // panel is on the right and the form takes the padding instead.
            // Dragging is WindowDragStrip's, across the whole top edge.
            paddingBlockStart: inset && navyIsUnderLights ? `${inset}px` : undefined,
          } as CSSProperties
        }
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
      <div
        style={{
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          padding: 'var(--tp-sp-6)',
          // Arabic: this panel is the physically first one, so the traffic
          // lights are over ITS corner.
          paddingBlockStart: inset && !navyIsUnderLights ? `${inset}px` : undefined,
        }}
      >
        {/* The language switch is a page control, so it sits in the page's
            outer BOTTOM corner: bottom-right in English, bottom-left in
            Arabic, which is what insetInlineEnd resolves to on its own. Not
            inline-START — that is this panel's inner edge, which put it in
            the middle of the window beside the form. And not the top corner,
            where it crowded the window controls. */}
        <div style={{ position: 'absolute', insetBlockEnd: 'var(--tp-sp-3)', insetInlineEnd: 'var(--tp-sp-3)', display: 'flex', gap: 'var(--tp-sp-1)' }}>
          <Button kind="ghost" size="sm" icon={mode === 'blue' ? 'sun' : 'moon'} onClick={toggleMode} aria-pressed={mode === 'blue'}>
            {tr(mode === 'blue' ? 'ws.shell.nav.lightMode' : 'ws.shell.nav.blueMode')}
          </Button>
          <Button kind="ghost" size="sm" icon="globe" onClick={toggleLocale}>
            <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>
          </Button>
        </div>
        {/* A till and a kitchen screen run frameless and non-closable, and the
            rail — the only other way out — is behind a sign-in. A station
            powered on by mistake, or signed out at the end of the night, was
            therefore a machine nobody could close. Only the placement is the
            window control's. */}
        <QuitToDesktop variant="signIn" />
        <form noValidate onSubmit={(e) => void submit(e)} className="tp-rise" style={{ inlineSize: 'min(22rem, 100%)', display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <h1 style={{ fontSize: 'var(--tp-fs-2xl)', marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('op.signIn.title')}</h1>
          <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-4)' }}>{tr('ws.shell.signIn.lead')}</p>
          <Field label={tr('auth.emailLabel')} error={missing === 'email' ? tr('ws.shell.signIn.emailRequired') : undefined}>
            <input
              ref={emailRef}
              style={inputStyle}
              dir="ltr"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              readOnly={busy}
              onChange={(e) => {
                setEmail(e.target.value);
                if (missing === 'email') setMissing(null);
              }}
            />
          </Field>
          <Field
            label={tr('auth.passwordLabel')}
            error={missing === 'password' ? tr('ws.shell.signIn.passwordRequired') : undefined}
            hint={capsLock ? tr('ws.shell.signIn.capsLock') : undefined}
          >
            <input
              ref={passwordRef}
              style={inputStyle}
              dir="ltr"
              type="password"
              autoComplete="current-password"
              value={password}
              readOnly={busy}
              onKeyDown={caps}
              onKeyUp={caps}
              onChange={(e) => {
                setPassword(e.target.value);
                if (missing === 'password') setMissing(null);
              }}
            />
          </Field>
          {error && (
            <p role="alert" style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start', color: 'var(--tp-danger-fg)', background: 'var(--tp-danger-soft)', borderRadius: 'var(--tp-radius-ctl)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-2-5)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>
              <Icon name={error === 'network' ? 'wifiOff' : 'alert'} size={16} style={{ flex: '0 0 auto', marginBlockStart: '0.1rem' }} />
              <span>
                {error === 'network' ? tr('ws.shell.signIn.network') : error === 'disabled' ? tr('ws.shell.signIn.disabled') : tr('ws.shell.signIn.invalid')}
              </span>
            </p>
          )}
          <Button kind="primary" size="lg" type="submit" busy={busy} style={{ inlineSize: '100%', marginBlockStart: 'var(--tp-sp-1)' }}>
            {tr('op.signIn.submit')}
          </Button>
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
