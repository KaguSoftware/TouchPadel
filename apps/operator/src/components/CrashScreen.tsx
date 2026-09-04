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
 * the viewport height; everything routed wants to fill its container and start
 * at the top of it.
 */
function wrapStyle(fullBleed: boolean): CSSProperties {
  return {
    display: 'flex',
    minBlockSize: fullBleed ? '100vh' : '100%',
    alignItems: fullBleed ? 'center' : 'flex-start',
    justifyContent: 'center',
    paddingBlock: 'var(--tp-sp-6)',
    paddingInline: 'var(--tp-sp-6)',
  };
}

function Actions({
  onRetry,
  onHome,
  retryLabel,
  homeLabel,
  reloadLabel,
}: {
  onRetry?: () => void;
  onHome?: () => void;
  retryLabel: string;
  homeLabel: string;
  reloadLabel: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-4)' }}>
      {onRetry && (
        <Button kind="primary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {onHome && <Button onClick={onHome}>{homeLabel}</Button>}
      <Button kind="ghost" onClick={() => window.location.reload()}>
        {reloadLabel}
      </Button>
    </div>
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
      <div style={{ ...card, maxInlineSize: '32rem' }} role="alert">
        <h1 style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-2xl)' }}>{tr('op.crash.title')}</h1>
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.crash.body')}</p>
        <Actions
          onRetry={onRetry}
          onHome={onHome}
          retryLabel={tr('op.crash.retry')}
          homeLabel={tr('op.crash.home')}
          reloadLabel={tr('op.crash.reload')}
        />
        <details style={{ marginBlockStart: 'var(--tp-sp-4)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('op.crash.details')}
          </summary>
          <pre
            dir="ltr"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 'var(--tp-fs-xs)',
              color: 'var(--tp-muted-fg)',
              marginBlockStart: 'var(--tp-sp-2)',
            }}
          >
            {describeError(error)}
          </pre>
        </details>
      </div>
    </div>
  );
}

/** The 404 screen. Same shape, no retry — retrying a bad URL changes nothing. */
export function NotFoundPanel({ onHome, fullBleed = false }: { onHome?: () => void; fullBleed?: boolean }) {
  const { tr } = useLocale();
  return (
    <div style={wrapStyle(fullBleed)}>
      <div style={{ ...card, maxInlineSize: '32rem' }} role="alert">
        <h1 style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-2xl)' }}>{tr('op.crash.notFoundTitle')}</h1>
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.crash.notFoundBody')}</p>
        <Actions onHome={onHome} retryLabel="" homeLabel={tr('op.crash.home')} reloadLabel={tr('op.crash.reload')} />
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
