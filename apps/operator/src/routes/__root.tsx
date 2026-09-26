/**
 * Application shell (spec §05): AppBootScreen, StaffSignInScreen,
 * WorkspaceSwitcher entry, SessionLockScreen, WorkspaceShell with the
 * per-workspace navigation rail and the global DegradedBanner region.
 *
 * Six workspaces on one build: the rail is chosen by the ACTIVE WORKSPACE
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
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { useAuth, can, canAccess, homeRoute, type StaffRole } from '../lib/auth';
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
  type NavSection,
  type WorkspaceKey,
} from '../lib/workspaces';
import { QK } from '../lib/queryKeys';
import { fetchProtocolsWaiting, protocolsWaitingTotal } from '../features/ops/protocolsWaiting';
import { fetchSuggestionsNew } from '../features/roleExtras/api';
import { newSuggestionCount } from '../features/roleExtras/roleExtrasLogic';
// Wave 5, people records: the rail's three counts (wave5-addendum-2026-09-25 §5.2).
import { fetchDeductionsWaiting } from '../features/deductions/api';
import { deductionsWaitingCount } from '../features/deductions/deductionsLogic';
import { fetchIncidentsOpen } from '../features/incidents/api';
import { incidentsOpenCount } from '../features/incidents/incidentsLogic';
import { fetchContentWaiting } from '../features/content/api';
import { contentWaitingCount } from '../features/content/contentLogic';
import { Button, ErrorText, Field, Modal, Spinner, card, inputStyle, trapTab } from '../components/ui';
import { PermissionRefusedNotice, StatusBadge } from '../components/kit';
import { ChevronBack, ChevronForward, Icon, CourtLines, ThemeModeIcon } from '../components/icons';
import { RAIL_EDGE, RAIL_ITEM_PAD, RAIL_PAD, navButtonStyle, navItemStyle } from '../components/railStyles';
import { RailMoreMenu } from '../components/RailMoreMenu';
import { BrandLockup, BrandSwoosh } from '../components/brand';
import { appRpc, AppRpcError } from '../lib/appRpc';
import { supabase } from '../lib/supabase';
import { useCafeSettings } from '../lib/settings';
import { GlobalStyles } from '../components/GlobalStyles';
import { ToastProvider } from '../components/toast';
import { ConfirmProvider, useConfirm } from '../components/ConfirmDialog';
import { touch, type LeaveResult, type UpdateReadyInfo } from '../ipc/bridge';
import { useHeartbeat, type HeartbeatState } from '../lib/heartbeat';
import { VenueStatusBanner } from '../components/VenueStatusBanner';
import { isElectron } from '../lib/mutate';
import { ScreenOwnerClaim, ScreenOwnerProvider, useScreenOwned } from '../lib/screenOwner';
import { useUpdateReady } from '../lib/updates';
import { UpdateReadyControl } from '../components/UpdateReady';
import { StationSetupContainer } from '../features/setup/StationSetupContainer';
import { QueueFailureToasts } from '../components/QueueFailureToasts';
import { BreakProvider, useBreak } from '../features/breaks/BreakProvider';
import { BreakOverlay } from '../features/breaks/BreakOverlay';
import { BreakRailControl } from '../features/breaks/BreakRailControl';
import { AssistantDrawer, AssistantDrawerProvider } from '../features/assistant/AssistantDrawer';
import { ShiftProvider } from '../features/tillShift/ShiftProvider';
import { ShiftRailControl } from '../features/tillShift/ShiftRailControl';
import { useTillShift } from '../features/tillShift/shiftContext';
import { LockLeaveGuard } from '../features/tillShift/LockLeaveGuard';

export const rootRoute = createRootRoute({
  component: RootProviders,
});

// Global CSS (keyframes + print) and the toast / confirm hosts sit above every
// screen, including sign-in, so any component may call useToast / useConfirm.
function RootProviders() {
  return (
    <>
      <GlobalStyles />
      {/* Wraps the strip AND everything that can open an overlay, so an
          overlay's claim reaches the strip. */}
      <ScreenOwnerProvider>
        <WindowDragStrip />
        <ToastProvider>
          {/* A queued write the server refused after its caller stopped waiting
              (item 9): the toast is the cue, Day close holds the row. */}
          <QueueFailureToasts />
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
      </ScreenOwnerProvider>
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
  const owned = useScreenOwned();
  // An overlay is up and owns its own top edge. Not painting the strip is the
  // only thing that frees those pixels — see lib/screenOwner.tsx.
  if (!inset || owned) return null;
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
  // The dark wall-screen theme belongs to the BOARD, not to every screen of
  // the navless workspace: the bar and kitchen roles open My tasks from the
  // board's header (/tasks, build-contracts-2026-09-23 §5.1), and a desk page
  // on the board's black ground would be unreadable. The page carries its own
  // way back to the board.
  const board = noNav && (path === '/kds' || path.startsWith('/kds/'));
  // The kitchen screen is wall-mounted: no traffic lights over its header, and
  // so no room to reserve for them either. Both follow noNav, not the board:
  // My tasks opened from it has no rail to keep the lights off its title
  // either. Both are restored the moment the operator leaves the workspace.
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
      {/* Till shifts (wave5-addendum §2.9): the station's shift, read once for
          the rail row, the payment pane's gate and the leaving guard. Offline
          (the beat itself failed) the gate fails open. */}
      <ShiftProvider offline={venue?.error != null}>
      {/* The owner assistant's drawer (docs/design/assistant §5.1) is one
          sheet for the whole shell: the rail footer row and Ctrl/⌘ K open it,
          and it is mounted once, beside the break overlay. */}
      <AssistantDrawerProvider>
      <div
        data-workspace={noNav && !board ? undefined : active}
        style={{ display: 'flex', flexDirection: 'column', blockSize: '100vh', background: board ? 'var(--tp-kds-bg)' : 'var(--tp-bg)' }}
      >
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
      </ShiftProvider>
      </BreakProvider>
    </WorkspaceContext.Provider>
  );
}

/**
 * A rail row's live count (NavItem.badge): what waits on the signed-in person
 * behind that row (build-contracts-2026-09-23 §5.1, §5.4). Each badge is one
 * shared read, refetched every minute and on focus, so every row and screen
 * that shows the same count agrees with the others.
 */
function useNavBadge(badge: NavItem['badge'] | undefined): number {
  return useBadgeSum(badge ? [badge] : []);
}

/**
 * What a set of rows counts between them: a section's button (Observe) and a
 * closed rail group (the manager's Run the day) show it, so a count is never
 * tucked away where the operator cannot see it.
 */
function useRowsBadge(items: readonly NavItem[]): number {
  return useBadgeSum(items.filter((i) => !i.hidden).map((i) => i.badge));
}

/**
 * The sum of the named badges' counts, one shared read each. A wave-5 count
 * (wave5-addendum-2026-09-25 §5.2) is read only by the role that acts on it:
 * the Incidents row sits on the desk's and the till's rail too, and
 * app.incidents_page would refuse them, so theirs carries no count.
 */
function useBadgeSum(badges: readonly (NavItem['badge'] | undefined)[]): number {
  const { staff } = useAuth();
  const on = new Set(badges);
  const protocols = useQuery({
    queryKey: QK.protocolsWaiting,
    queryFn: fetchProtocolsWaiting,
    enabled: on.has('protocolsWaiting'),
    refetchInterval: 60_000,
  });
  const suggestions = useQuery({
    queryKey: QK.suggestionsNew,
    queryFn: fetchSuggestionsNew,
    enabled: on.has('suggestionsNew'),
    refetchInterval: 60_000,
  });
  // A row counts only what it names: a disabled query still hands back what
  // another row cached under the same key, so the flag gates the sum too.
  const deductionsOn = on.has('deductionsWaiting') && can(staff?.role, 'decideDeductions');
  const incidentsOn = on.has('incidentsOpen') && can(staff?.role, 'reviewIncidents');
  const contentOn = on.has('contentWaiting') && can(staff?.role, 'decideContent');
  const deductions = useQuery({
    queryKey: QK.deductionsWaiting,
    queryFn: fetchDeductionsWaiting,
    enabled: deductionsOn,
    refetchInterval: 60_000,
  });
  const incidents = useQuery({
    queryKey: QK.incidentsOpen,
    queryFn: fetchIncidentsOpen,
    enabled: incidentsOn,
    refetchInterval: 60_000,
  });
  const content = useQuery({
    queryKey: QK.contentWaiting,
    queryFn: fetchContentWaiting,
    enabled: contentOn,
    refetchInterval: 60_000,
  });
  return (
    (on.has('protocolsWaiting') ? protocolsWaitingTotal(protocols.data) : 0) +
    (on.has('suggestionsNew') ? newSuggestionCount(suggestions.data) : 0) +
    (deductionsOn && deductions.isSuccess ? deductionsWaitingCount(deductions.data) : 0) +
    (incidentsOn && incidents.isSuccess ? incidentsOpenCount(incidents.data) : 0) +
    (contentOn && content.isSuccess ? contentWaitingCount(content.data) : 0)
  );
}

/** The count at a row's end: nothing at zero, so a quiet rail stays quiet. */
function RailCount({ count }: { count: number }) {
  const { tr, locale } = useLocale();
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          minInlineSize: '1.4rem',
          paddingInline: 'var(--tp-sp-1-5)',
          borderRadius: 'var(--tp-radius-pill)',
          background: 'var(--tp-rail-green)',
          color: 'var(--tp-rail)',
          fontSize: 'var(--tp-fs-xs)',
          fontWeight: 700,
          lineHeight: 1.6,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatNumber(count, locale)}
      </span>
      <span className="tp-sr-only">{tr('ws.shell.nav.badge', { count: formatNumber(count, locale) })}</span>
    </>
  );
}

/** One rail destination. Same row whether it comes from a group or a section. */
function RailLink({ item, path }: { item: NavItem; path: string }) {
  const { tr } = useLocale();
  const active = isNavActive(item, path);
  const count = useNavBadge(item.badge);
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
      <RailCount count={count} />
    </Link>
  );
}

/** A section's row on the workspace rail: it opens a place, so a forward chevron, and its count. */
function SectionLink({ section }: { section: NavSection }) {
  const { tr } = useLocale();
  const count = useRowsBadge(section.items);
  return (
    <Link to={section.home} className="tp-nav-item" style={navItemStyle}>
      <Icon name={section.icon} size={17} />
      <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tr(`ws.shell.section.${section.key}`)}
      </span>
      <RailCount count={count} />
      <ChevronForward size={14} />
    </Link>
  );
}

const RAIL_OPEN_KEY = 'touch-operator-rail-open';

function loadOpenGroup(): string | null {
  try {
    return localStorage.getItem(RAIL_OPEN_KEY);
  } catch {
    return null;
  }
}

function saveOpenGroup(key: string | null): void {
  try {
    if (key) localStorage.setItem(RAIL_OPEN_KEY, key);
    else localStorage.removeItem(RAIL_OPEN_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * A titled group of rail rows that opens and closes from its title.
 *
 * Closed by default so the rail reads as a short list of places (Today, Run
 * the day, Records, Setup) rather than twelve rows. Only one group is open at
 * a time — opening one closes whichever other group was open, so the rail
 * never grows into the full twelve-row list. Two rules keep it from hiding
 * where the operator is:
 *
 *  - The group holding the current screen opens itself, including when the
 *    operator arrives there from a link on another screen, so the lit row is
 *    never tucked away inside a closed group.
 *  - What the operator opened by hand is remembered on this station, so a
 *    manager who keeps Setup open does not have to reopen it every shift.
 *
 * The rows are `inert` while closed, so Tab never lands on something that
 * cannot be seen. The height animates through a 0fr → 1fr grid track, which
 * needs no measured height and is cut to nothing by the reduced-motion rule
 * in GlobalStyles.
 */
function RailGroup({
  labelKey,
  items,
  path,
  open,
  onToggle,
}: {
  labelKey: NonNullable<NavGroup['labelKey']>;
  items: readonly NavItem[];
  path: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { tr } = useLocale();
  const listId = `rail-group-${labelKey}`;
  // Open, the rows show their own counts.
  const count = useRowsBadge(items);

  return (
    <div style={{ display: 'grid' }}>
      <button
        type="button"
        className="tp-nav-item tp-rail-group"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        style={navButtonStyle}
      >
        <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tr(`ws.shell.nav.${labelKey}`)}
        </span>
        {!open && <RailCount count={count} />}
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
  const { tr } = useLocale();
  const { staff, signOut } = useAuth();
  const { available } = useWorkspace();
  const tillShift = useTillShift();
  const station = touch.getStation();
  const workspace = WORKSPACES[workspaceKey];
  // Only the jokers change workspace (owner call, 2026-09-18): a cashier or a
  // desk clerk has one, and the row was never more than a dead end for them.
  const canSwitch = available.length > 1 && (staff?.role === 'manager' || staff?.role === 'owner');
  const navigate = useNavigate();
  const confirm = useConfirm();
  // Leaving a section for its workspace is a move the person may not have
  // meant, so it asks first. Switch workspace does not: it only opens the
  // picker, and the picker asks when a different workspace is chosen.
  const leaveTo = async (to: string, destination: string) => {
    const ok = await confirm({
      title: tr('ws.shell.nav.leaveTitle', { destination }),
      body: tr('ws.shell.nav.leaveBody'),
      confirmLabel: tr('ws.shell.nav.leaveConfirm'),
      kind: 'primary',
    });
    if (ok) void navigate({ to });
  };
  // Sign out asks first, through the same dialog the leave paths use. It is
  // one press on the rail foot and it ends the shift, so a stray touch while
  // reaching for the identity block should not drop the till to a sign-in.
  const confirmSignOut = async () => {
    // Wave 5 §5.1: with the person's own till shift open here, Sign out asks
    // about the drawer instead (End my shift, Sign out anyway, Cancel).
    if (tillShift.guardSignOut(() => void signOut())) return;
    const ok = await confirm({
      title: tr('ws.shell.nav.signOutTitle'),
      body: tr('ws.shell.nav.signOutBody'),
      confirmLabel: tr('ws.shell.nav.signOutConfirm'),
      // Red, and the confirm button says the deed rather than "Yes, …" —
      // the words that were pressed on the rail come back on the button that
      // carries them out.
      kind: 'danger',
      // Beside Cancel, not pushed to the far edge (owner call, 2026-09-21).
      // Rulebook 7.8 spreads a destructive confirm so a mis-tap cannot land
      // on it; signing out is red but REVERSIBLE — you sign back in — so it
      // pairs like every other dialog instead. A real destructive write keeps
      // the spread.
      pairActions: true,
    });
    if (ok) await signOut();
  };
  // Inside a section the rail IS the section: its name, its list, and one way
  // back. Read from the path, so the rail and the screen can never disagree.
  const section = sectionForPath(workspace, path);
  const sections = (workspace.sections ?? []).filter((sec) => canAccess(staff?.role, sec.home));

  // Accordion: at most one group open at a time. The group holding the
  // current screen always wins, so arriving via a link never leaves the lit
  // row buried in a closed group; otherwise the last group opened by hand on
  // this station, remembered across shifts.
  const visibleGroups = workspace.groups
    .map((group) => ({ group, items: group.items.filter((item) => canAccess(staff?.role, item.to)) }))
    .filter(({ items }) => items.length > 0);
  const activeGroupKey = visibleGroups.find(({ items }) => items.some((item) => isNavActive(item, path)))?.group.labelKey ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(() => activeGroupKey ?? loadOpenGroup());

  useEffect(() => {
    if (activeGroupKey) setOpenGroup(activeGroupKey);
  }, [activeGroupKey]);

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
          {/* The title sits straight under the lockup; in a section the back
              control follows the lead, below. */}
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
          {/* The way out of a section, below the name of where you are and
              its lead, so the title reads first. Sizing, surface and
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
            {visibleGroups.map(({ group, items }, gi) =>
              group.labelKey ? (
                <RailGroup
                  key={group.labelKey}
                  labelKey={group.labelKey}
                  items={items}
                  path={path}
                  open={openGroup === group.labelKey}
                  onToggle={() =>
                    setOpenGroup((cur) => {
                      const next = cur === group.labelKey ? null : group.labelKey!;
                      saveOpenGroup(next);
                      return next;
                    })
                  }
                />
              ) : (
                <div key={gi} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                  {items.map((item) => (
                    <RailLink key={item.to} item={item} path={path} />
                  ))}
                </div>
              ),
            )}

            {/* One row per section, chevron forward: this opens a place, it
                does not switch a screen. */}
            {sections.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                {sections.map((sec) => (
                  <SectionLink key={sec.key} section={sec} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ borderBlockStart: '1px solid var(--tp-rail-border)', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: RAIL_PAD, display: 'grid', gap: 'var(--tp-sp-0)' }}>
        {/* Workspace, assistant, language and appearance behind one row. The
            assistant is owner-only and the switch manager-and-up, so the menu
            holds two items for a cashier and four for an owner. */}
        <RailMoreMenu
          canSwitch={canSwitch}
          // On the picker the row is lit rather than hidden, so the menu holds
          // the same items on every screen. RailMoreMenu makes the press a no-op
          // there, so pressing it never reloads the screen already showing.
          onWorkspacePicker={path === '/workspaces'}
          // Straight to the picker: looking at the list of workspaces moves
          // nothing. The question is asked on the picker, when a DIFFERENT
          // workspace is chosen (owner call, 2026-09-22) — that is the step
          // that changes the whole rail.
          onSwitchWorkspace={() => void navigate({ to: '/workspaces' })}
        />
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

        {/* Wave 5 §5.1: the till shift, under the break row and drawn the same
            way: "Start my shift", or "End my shift" over "My shift · since …". */}
        <ShiftRailControl
          style={navButtonStyle}
          captionStyle={{ paddingInline: RAIL_ITEM_PAD, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)' }}
        />

        {/* Who is at this till, and the way off it.

            Rulebook 4.5 wants the role and the scoped context legible at all
            times. One line reading "Mohammed Al-Rashid · Court desk · TILL-01"
            inside a 13.5rem rail truncated to about the first name, so in
            practice neither the role nor the station was visible at all. Name
            and role share a line because they answer "who is signed in"; the
            station answers "which till" and gets its own, using the
            ws.shell.nav.station key that had been sitting unused.

            The build is NOT here. It used to sit under the station as a
            third line, answering a question asked about twice a year in
            front of every shift all day. It now stands once, centred at the
            foot of the workspace chooser (routes/workspaces.tsx), where
            somebody looking up "which version is that till on" can be sent.

            Sign out is an icon button on the END edge, beside those two lines
            (owner call, 2026-09-21). It ends the shift, it does not go
            anywhere, so it should not read as one more nav row above rows that
            navigate; and standing beside the name and the station, it is
            unmistakably the control that ends THAT session. Icon-only,
            because the glyph plus its aria-label says it in the width a
            13.5rem rail can spare next to the text.

            `flex-start` + the name row's own half-leading, NOT `center`: the
            text beside it is a two-line stack, and centring against both
            floats the button down by the station line — a muted caption it
            has nothing to do with. Sitting on the name's optical centre makes
            it read as that person's control. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--tp-sp-2)', minInlineSize: 0, paddingInline: RAIL_ITEM_PAD, paddingBlockStart: 'var(--tp-sp-2)' }}>
          {/* sp-2, not sp-1: the name and the station answer two different
              questions — who is signed in, and which till — and at 0.25rem
              the station read as a second line of the name rather than as
              its own fact. */}
          <div style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <RailIdentity />
            <p
              title={tr('ws.shell.nav.station', { id: station.stationId })}
              style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-rail-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {tr('ws.shell.nav.station', { id: station.stationId })}
            </p>
          </div>
          <Button
            size="sm"
            icon="logOut"
            onClick={() => void confirmSignOut()}
            aria-label={tr('auth.signOut')}
            title={tr('auth.signOut')}
            data-testid="rail.signOut"
            /* Rail palette + the rail's hover ground; see .tp-rail-btn. */
            className="tp-rail-btn"
            style={{
              flexShrink: 0,
              /* The full touch target on EVERY rail, not just the two that get
                 it from [data-workspace='cashier'|'prep'] in GlobalStyles
                 (owner call, 2026-09-23). Sign out ends the shift and it is
                 the one control on the rail with no label to aim at, so the
                 desk clerk and the manager get the same square the till has
                 always had. Set here rather than by dropping size="sm",
                 because the size also carries the glyph and padding scale the
                 rail's other footer rows are drawn at. */
              inlineSize: 'var(--tp-touch)',
              minBlockSize: 'var(--tp-touch)',
              /* The square is taller than the name it sits beside, so a flush
                 top sets it a touch high. Half that difference puts its glyph
                 on the name's optical centre. */
              marginBlockStart: '-0.1rem',
              /* Pull the border box onto the rail's true end edge, so the
                 button's edge lines up with RAIL_EDGE the way every other
                 row's text does rather than sitting a border in from it. */
              marginInlineEnd: '-1px',
            }}
          />
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
    /* No padding of its own: the rail's foot now wraps this and the station /
       version lines in one padded row beside the sign-out button. */
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
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
  // Wave 5 §5.1, the leaving guard: Switch user with the signed-in person's
  // own till shift open here asks first, inside this card. A dialog over the
  // lock would sit under it (--tp-z-lock), and the lock is not closable.
  const tillShift = useTillShift();
  const [leaving, setLeaving] = useState(false);
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
    setLeaving(false);
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

  /**
   * The line under "Station locked", or null when there is nothing worth
   * saying. A plain idle lock is the null case: the title and the PIN box
   * already say it. The three that remain each carry a fact the screen does
   * not otherwise give — who is covering, that the break is ending, and why
   * a password is being asked of somebody who has no PIN.
   */
  const lead = cover
    ? ownerBack
      ? tr('ws.shell.break.endLead')
      : tr('ws.shell.break.lockCovering', { name: cover.display_name })
    : hasPin === false && usePassword
      ? tr('ws.shell.lock.hintPassword')
      : null;

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
      // Only an authorising role's pin feeds the offline manager-pin cache,
      // tagged as this person's own: offline, it is what stops them letting
      // themselves out of the station with it (Quit / Exit full screen).
      if (staff && (staff.role === 'manager' || staff.role === 'owner')) {
        touch.pinObserved(pin, staff.id);
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
      <ScreenOwnerClaim />
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
        <div ref={cardRef} tabIndex={-1} className="tp-rise" style={{ ...card, outline: 'none', inlineSize: 'min(24rem, 92vw)', boxShadow: 'var(--tp-shadow-dialog)', paddingBlock: 'var(--tp-sp-6)', paddingInline: 'var(--tp-sp-5)', display: 'grid', gap: 'var(--tp-sp-5)' }}>
          {/* The header is one centred column: who is signed in, and — only
              when there is something to say — one line under it.

              Neither the lock glyph nor "Station locked" is drawn any more. A
              full-screen card asking for a PIN over the darkened station is
              already unmistakably a lock, so the eyebrow named what the person
              could see and pushed the thing they came for down the card. It
              survives as the overlay's aria-label, which is where it does real
              work: a screen reader still announces "Station locked" on open.

              The line beneath carries only what the screen does NOT otherwise
              say — who is covering, that a break is ending, and (SEC-34) why a
              password is being asked of somebody with no PIN. A plain idle lock
              has nothing to add, so the line is absent rather than empty. */}
          <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 'var(--tp-sp-2)' }}>
            <h2 style={{ fontSize: 'var(--tp-fs-2xl)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              <bdi>{cover && !ownerBack ? cover.display_name : staff.displayName}</bdi>
              {cover && !ownerBack ? (
                <StatusBadge size="sm" dot={false} tone="warn" label={tr('ws.shell.break.covering')} />
              ) : (
                <StatusBadge size="sm" dot={false} label={tr(`op.roles.${staff.role}`)} />
              )}
            </h2>
            {lead !== null && (
              <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', textWrap: 'balance' }}>{lead}</p>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}
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
            {/* The other-credential link belongs to the button above it: it
                changes what you are about to type, so it sits just under
                Unlock rather than a full card gap away down with Sign out.
                Inside the form for that reason, at the form's own tighter
                rhythm, with the ghost button's padding pulled back so the
                gap reads as sp-1 rather than sp-1 plus its own box.

                Offered only to somebody who HAS a PIN. For a cashier with
                none, the password is the only route, and a PIN link would
                imply a PIN they could have used. */}
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
                style={{ justifySelf: 'center', marginBlockStart: 'calc(-1 * var(--tp-sp-2))' }}
              >
                {ownerBack ? tr('ws.shell.break.chooseAgain') : tr('ws.shell.break.lockOwnerBack', { cover: cover.display_name, name: staff.displayName })}
              </Button>
            ) : hasPin !== false ? (
              <Button
                kind="ghost"
                size="sm"
                onClick={() => switchMode(!usePassword)}
                disabled={busy}
                style={{ justifySelf: 'center', marginBlockStart: 'calc(-1 * var(--tp-sp-2))' }}
              >
                {usePassword ? tr('ws.shell.lock.usePin') : tr('ws.shell.lock.usePassword')}
              </Button>
            ) : null}
          </form>
          {/* The way OFF the station rather than into it, so it stands alone at
              the foot of the card, centred, divided from the unlock path by a
              rule.

              `flex-shrink: 0` is what keeps the icon on the label's line. This
              is the widest control on the card — "Not {name}? Sign out" carries
              a name, and the Arabic is wider still — so in a flex row it was
              squeezed below its content width. .tp-btn's own `white-space:
              nowrap` cannot help there: the icon is a flex SIBLING of the text
              with `flex: 0 0 auto`, so it held its box while the label took the
              whole squeeze and dropped beneath it. Refusing to shrink lets the
              button keep its natural width; the card is 24rem and the label
              fits, and a name long enough to exceed it now widens the button
              rather than folding the glyph off its line. */}
          {leaving ? (
            /* The leaving guard, in place of the way off it guards. */
            <LockLeaveGuard name={staff.displayName} onBack={() => setLeaving(false)} onSignOut={() => void signOut()} />
          ) : (
          <div style={{ display: 'flex', justifyContent: 'center', borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-3)' }}>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => (tillShift.mineHere ? setLeaving(true) : void signOut())}
              disabled={busy}
              style={{ flexShrink: 0, maxInlineSize: '100%' }}
            >
              {/* The glyph is button CONTENT rather than the `icon` prop so it
                  can be nudged. `align-items: center` centres the icon's box
                  against the label's LINE box, and a 1.25 line-height line box
                  is taller than the letters it holds — the extra sits mostly
                  below the baseline, as descender space this label barely uses.
                  Centred against that, the arrow rides above the visual middle
                  of the words. 1px down puts it on the text's optical centre.
                  Done here, not in Button's shared slot, which every other
                  icon button in the app depends on. */}
              <Icon name="logOut" size={14} style={{ marginBlockStart: '1px' }} />
              <bdi style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr('ws.shell.lock.switchUser', { name: staff.displayName })}</bdi>
            </Button>
          </div>
          )}
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
 * So this leaves the kiosk and leaves the app running. Nothing is lost and
 * the station keeps trading, but it is still leaving: on a locked station it
 * takes a manager's PIN that is not the signed-in person's own (owner call,
 * 2026-09-23 — staff are kept inside the app), and main locks the window
 * again at the next sign-in or sign-out. It stays quieter than Quit — same
 * muted rail weight, no danger colour — because it is the reversible one.
 *
 * Electron fixes `frame` at window creation, so a production window cannot
 * grow a titlebar here; main compensates by resizing it off full-bleed, which
 * is what actually reads as "you are out" on both platforms.
 *
 * Nothing at all in browser mode (rulebook 4.4), where there is no kiosk.
 */
function ExitFullscreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
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
  const locked = touch.getStation().locked === true;

  function close() {
    setOpen(false);
    setPin('');
    setError(null);
  }

  async function exit() {
    setBusy(true);
    setError(null);
    try {
      if (locked) await proveLeavePin(pin, staff?.id ?? null);
      const refusal = leaveRefusal(await touch.exitFullscreen(pin));
      if (refusal) throw refusal;
      // No success line: the window visibly leaving full screen IS the
      // feedback, and a rail that keeps a sentence around after the fact only
      // adds something to ignore. A failure still speaks, below.
      close();
    } catch (e) {
      setError(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="tp-nav-item"
        onClick={() => (locked ? setOpen(true) : void exit())}
        disabled={busy}
        style={{ ...navButtonStyle, color: 'var(--tp-rail-muted)' }}
      >
        <Icon name="shrink" size={16} />
        <span>{tr('ws.shell.nav.exitFullscreen')}</span>
      </button>
      {!locked && error != null && (
        <div style={{ paddingInline: RAIL_ITEM_PAD }}>
          <ErrorText error={error} />
        </div>
      )}
      {open && (
        <Modal
          title={tr('ws.shell.nav.exitFullscreen')}
          size="sm"
          onClose={close}
          footer={
            <>
              <Button onClick={close}>{tr('common.back')}</Button>
              <Button kind="primary" busy={busy} disabled={pin.length < 4} onClick={() => void exit()}>
                {tr('ws.shell.nav.exitFullscreen')}
              </Button>
            </>
          }
        >
          <LeavePinField pin={pin} setPin={setPin} busy={busy} onEnter={() => void exit()} />
          <ErrorText error={error} />
        </Modal>
      )}
    </>
  );
}

/**
 * Staff are kept inside the app (owner call, 2026-09-23): on a locked station
 * (StationInfo.locked — every configured production one) Quit and Exit forced
 * full screen take a manager's PIN, and never the signed-in person's own.
 *
 * Signed in, the PIN is proved to verify_manager_pin first. It returns the
 * manager's id, which is how "not your own" is told, and the PIN is then
 * cached tagged with that id so main — which re-checks every exit against the
 * offline cache (pin-cache.ts mayLeave) — can tell the same thing offline.
 * Offline, the call fails as UNKNOWN and main's cache is the whole check.
 * Signed out there is no session to ask the server with, and no "own" to
 * exclude: main's cache alone decides.
 */
async function proveLeavePin(pin: string, signedInStaffId: string | null): Promise<void> {
  if (!signedInStaffId) return;
  try {
    const authorizer = await appRpc<string | null>('verify_manager_pin', {
      p_pin: pin,
      p_device_id: touch.getStation().stationId,
    });
    // null is a wrong PIN (the function raises only for a lockout or a
    // non-staff caller); refused before the cache can learn it.
    if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
    if (authorizer === signedInStaffId) throw new AppRpcError('PIN_OWN', 'PIN_OWN');
    touch.pinObserved(pin, authorizer);
  } catch (e) {
    if (e instanceof AppRpcError && e.code !== 'UNKNOWN') throw e;
  }
}

/** Main's answer to quitApp / exitFullscreen, as the error the dialog shows (null: let out). */
function leaveRefusal(res: LeaveResult): Error | null {
  if (res.ok) return null;
  if (res.error === 'own pin') return new AppRpcError('PIN_OWN', res.error);
  // The same fact the server states as PIN_INVALID, so it reads "Incorrect
  // PIN." — at sign-in the cache is the only check that ran.
  if (res.error === 'pin not recognised') return new AppRpcError('PIN_INVALID', res.error);
  return new Error(res.error);
}

function LeavePinField({
  pin,
  setPin,
  busy,
  onEnter,
}: {
  pin: string;
  setPin: (pin: string) => void;
  busy: boolean;
  onEnter: () => void;
}) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.shell.nav.leavePin')} hint={tr('ws.shell.nav.leavePinHint')}>
      <input
        style={inputStyle}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        autoFocus
        maxLength={12}
        disabled={busy}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && !busy && onEnter()}
      />
    </Field>
  );
}

/**
 * "Quit to desktop" (design-arch §2.5) — production kiosk windows are not
 * closable any other way. Hidden entirely in browser mode.
 *
 * MANAGER PIN, NOT YOUR OWN. The PIN gate was taken off by request once, and
 * is back (owner call, 2026-09-23): staff are kept inside the app, so on a
 * locked station the dialog names the cost AND takes a manager's PIN that is
 * not the signed-in person's (proveLeavePin; main re-checks it). In dev and
 * on first run it is the plain confirmation it was.
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
  const { staff } = useAuth();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
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
  const locked = touch.getStation().locked === true;

  function close() {
    setOpen(false);
    setPin('');
    setError(null);
  }

  async function quit() {
    setBusy(true);
    setError(null);
    try {
      if (locked) await proveLeavePin(pin, staff?.id ?? null);
      // Main exits ~50 ms after replying, so `busy` is the last thing the
      // screen shows on success.
      const refusal = leaveRefusal(await touch.quitApp(pin));
      if (refusal) throw refusal;
    } catch (e) {
      setError(e);
      setPin('');
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
        * replacing a hand-typed 40. Escape and the returned focus are the
        * undo for a mis-tap.
        */}
      {open && (
        <Modal
          title={tr('ws.shell.nav.quit')}
          size="sm"
          onClose={close}
          footer={
            <>
              <Button onClick={close}>{tr('common.back')}</Button>
              <Button kind="danger" busy={busy} disabled={locked && pin.length < 4} onClick={() => void quit()}>
                {tr('ws.shell.nav.quit')}
              </Button>
            </>
          }
        >
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.nav.quitConfirm')}</p>
          {locked && <LeavePinField pin={pin} setPin={setPin} busy={busy} onEnter={() => void quit()} />}
          <ErrorText error={error} />
        </Modal>
      )}
    </>
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
      // Stays busy on success: the shell replaces this screen once the role
      // lookup lands (AuthProvider publishes the session after it), and the
      // button coming back for that round trip invited a second submit.
    } catch (err) {
      setBusy(false);
      const kind = signInFailure(err);
      setError(kind);
      // A wrong password is retyped, not edited: clear it and put the cursor
      // back. A network failure keeps both, because nothing was wrong with them.
      if (kind === 'invalid') setPassword('');
      passwordRef.current?.focus();
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
          {/* The glyph is button CONTENT, not the `icon` prop: `icon` takes a
              name out of the set and swaps the whole <svg> on a flip, which is
              the blink ThemeModeIcon exists to replace. 14px is what `size="sm"`
              gives its own icon slot, so the row is unchanged. */}
          <Button kind="ghost" size="sm" onClick={toggleMode} aria-pressed={mode === 'blue'}>
            <ThemeModeIcon mode={mode} size={14} />
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
 *
 * Driver, marketing and the waiter hold the any-staff baseline alone, so they
 * lead. The assistant barista holds the board and My tasks and nothing more,
 * so he comes before the barista (wave 5 §2.1.6). Prep sits after the bar and
 * kitchen family it was split into (0155): every route prep opens, they open
 * too, so a refusal names a role the owner can still assign rather than the
 * retired one.
 */
const ROLE_ORDER: readonly StaffRole[] = [
  'driver',
  'marketing',
  'waiter',
  'assistant_barista',
  'barista',
  'chef',
  'head_barista',
  'head_chef',
  'prep',
  'cashier',
  'court_desk',
  'manager',
  'owner',
];
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
