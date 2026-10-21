/**
 * What a station shows when a screen throws, and the boundary that catches it.
 *
 * The operator had neither. Till and KDS stations run `kiosk: true` with
 * `autoHideMenuBar: true` (operator-shell/src/main/index.ts:21-22), so an
 * uncaught render error left a cashier looking at a white rectangle with no
 * menu, no address bar and no way out — mid-service. The shell's
 * `render-process-gone` reload (index.ts:57) does not help: a React exception
 * is not a process crash.
 *
 * Three escapes, in increasing order of disruption, because the cheapest one
 * that works is the one a cashier should take:
 *   1. re-render this screen (TanStack Router's `reset`);
 *   2. navigate to the role's home screen — the rest of the app is fine;
 *   3. reload the whole renderer.
 */
import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { useLocale } from '../lib/i18n';
import { captureException, describeError } from '../lib/telemetry';
import { Button, card } from './ui';
import { Icon, type IconName } from './icons';

/**
 * Where the recovery card sits.
 *
 * This used to force `minBlockSize: '100vh'` unconditionally, and CrashPanel is
 * the router's `defaultErrorComponent` — so it renders INSIDE <main>, which is
 * already a 100vh shell minus the status strip minus its own padding. A 100vh
 * box centred inside a shorter scrolling box puts the card BELOW THE FOLD: on a
 * kiosk with no menu bar a cashier saw an empty area and had to scroll to find
 * "Try this screen again", mid-service.
 *
 * `fullBleed` is therefore opt-IN. Only the shell boundary in main.tsx (which
 * really does own the whole viewport, because the crash may BE the shell) wants
 * the viewport height; everything routed fills its container instead.
 *
 * Either way the card is centred in that box (Sait, 2026-10-21). That is safe
 * here because the box is only as tall as its container, never taller: the
 * card lands mid-screen, and `min-block-size` lets the box grow rather than
 * clip when the window is too short for the card.
 */
function wrapStyle(fullBleed: boolean): CSSProperties {
  return {
    display: 'flex',
    minBlockSize: fullBleed ? '100vh' : '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 'var(--tp-sp-6)',
    paddingInline: 'var(--tp-sp-6)',
  };
}

/**
 * The card both panels share (Sait, 2026-10-21, option B): the glyph at the
 * start with the title and body beside it, then the ways out stacked
 * full-width so each is an easy target on a touch till.
 */
/** 20px: the mockup's rhythm between the card's rows, between two rungs of the scale. */
const rowGap = 'calc(var(--tp-sp-4) + var(--tp-sp-1))';

const panelCard: CSSProperties = {
  ...card,
  inlineSize: '100%',
  maxInlineSize: '27.5rem',
  borderRadius: 'calc(var(--tp-radius-dialog) + var(--tp-sp-0))',
  paddingBlockStart: 'var(--tp-sp-6)',
  paddingBlockEnd: rowGap,
  paddingInline: 'calc(var(--tp-sp-5) + var(--tp-sp-1))',
  display: 'grid',
  gap: rowGap,
};

/** The two cheap escapes, one above the other. */
const stack: CSSProperties = { display: 'grid', gap: 'var(--tp-sp-2-5)' };

const hint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--tp-fs-sm)',
  color: 'var(--tp-muted-fg)',
  textAlign: 'center',
};

const divider: CSSProperties = { blockSize: '1px', background: 'var(--tp-border)' };

function PanelHeader({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--tp-sp-4)' }}>
      <span
        aria-hidden
        style={{
          display: 'grid',
          placeItems: 'center',
          inlineSize: '3rem',
          blockSize: '3rem',
          flex: '0 0 auto',
          borderRadius: 'var(--tp-radius-pill)',
          background: 'var(--tp-warn-soft)',
          color: 'var(--tp-warn-mark)',
        }}
      >
        <Icon name={icon} size={24} />
      </span>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', minInlineSize: 0 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--tp-fs-2xl)', lineHeight: 1.25 }}>{title}</h1>
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{body}</p>
      </div>
    </div>
  );
}

/** The two big escapes: full width and 48px tall. */
const fullWidth: CSSProperties = { inlineSize: '100%', minBlockSize: '3rem' };

/**
 * Restart is the strongest way out, so it sits below the divider, small and
 * amber (.tp-crash-restart in GlobalStyles): set apart from the two cheap
 * escapes without reading as an error.
 */
function RestartButton({ label }: { label: string }) {
  return (
    <Button
      icon="power"
      className="tp-crash-restart"
      onClick={() => window.location.reload()}
      style={{ minBlockSize: 0, paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-3)', gap: 'var(--tp-sp-1-5)' }}
    >
      {label}
    </Button>
  );
}

/**
 * Presentational crash panel. `error` is rendered only inside a collapsed
 * <details> — a guest can see this screen over a cashier's shoulder, and a
 * stack trace is not something to put in front of them.
 */
export function CrashPanel({
  error,
  onRetry,
  onHome,
  fullBleed = false,
}: {
  error: unknown;
  onRetry?: () => void;
  onHome?: () => void;
  /** Only the pre-router shell boundary owns the viewport. See wrapStyle. */
  fullBleed?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <div style={wrapStyle(fullBleed)}>
      <div style={panelCard} role="alert">
        <PanelHeader icon="alert" title={tr('op.crash.title')} body={tr('op.crash.body')} />
        <div style={stack}>
          {onRetry && (
            <Button kind="primary" size="lg" icon="refresh" onClick={onRetry} style={fullWidth}>
              {tr('op.crash.retry')}
            </Button>
          )}
          {/* Home is the primary way out when there is nothing to retry. */}
          {onHome && (
            <Button kind={onRetry ? 'default' : 'primary'} size="lg" icon="home" onClick={onHome} style={fullWidth}>
              {tr('op.crash.home')}
            </Button>
          )}
        </div>
        {/* What to do if the cheap escapes do not hold, in words: nothing on
            this screen can report the fault, a person can. */}
        <p style={hint}>{tr('op.crash.again')}</p>
        <div style={divider} />
        <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--tp-sp-2)' }}>
          {/* Reload always works, so the station is never left with zero ways out. */}
          <RestartButton label={tr('op.crash.reload')} />
          <details style={{ inlineSize: '100%' }}>
            {/* The marker is our own chevron (.tp-crash-details), centred with
                the label; it turns down when the details are open. */}
            <summary className="tp-crash-details">
              <span className="tp-crash-chev" aria-hidden>
                <Icon name="chevronEnd" size={14} dataChevron />
              </span>
              {tr('op.crash.details')}
            </summary>
            <pre
              dir="ltr"
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 'var(--tp-fs-xs)',
                color: 'var(--tp-muted-fg)',
                textAlign: 'start',
                background: 'var(--tp-surface-3)',
                borderRadius: 'calc(var(--tp-radius-ctl) + var(--tp-sp-0))',
                paddingBlock: 'var(--tp-sp-3)',
                paddingInline: 'calc(var(--tp-sp-3) + var(--tp-sp-0))',
                marginBlock: 'var(--tp-sp-2) 0',
                maxBlockSize: '11.25rem',
                overflow: 'auto',
              }}
            >
              {describeError(error)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

/**
 * The 404 screen. Same shape, no retry and no restart — retrying or reloading
 * a bad address lands on the same bad address, so the only offer is home.
 */
export function NotFoundPanel({
  onHome,
  fullBleed = false,
}: {
  onHome?: () => void;
  fullBleed?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <div style={wrapStyle(fullBleed)}>
      <div style={panelCard} role="alert">
        <PanelHeader icon="search" title={tr('op.crash.notFoundTitle')} body={tr('op.crash.notFoundBody')} />
        {/* Restart stays only as the last resort when there is no home to
            offer, so the screen is never left with zero ways out. */}
        {onHome ? (
          <Button kind="primary" size="lg" icon="home" onClick={onHome} style={fullWidth}>
            {tr('op.crash.home')}
          </Button>
        ) : (
          <div style={{ display: 'grid', justifyItems: 'center' }}>
            <RestartButton label={tr('op.crash.reload')} />
          </div>
        )}
      </div>
    </div>
  );
}

interface BoundaryState {
  error: unknown;
}

/**
 * Class boundary for everything ABOVE the router — the providers, the sidebar
 * shell, the sign-in screen. TanStack Router's own `errorComponent` covers
 * route content; this covers the frame around it, which the router cannot see.
 *
 * `fallback` is a render prop rather than an element so the reset callback can
 * be threaded through without a context.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: unknown, reset: () => void) => ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    captureException(error, { boundary: 'app', componentStack: info.componentStack });
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
