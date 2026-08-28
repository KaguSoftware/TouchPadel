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
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocale } from '../lib/i18n';
import { captureException, describeError } from '../lib/telemetry';
import { Button, card } from './ui';

const wrap = {
  display: 'flex',
  minBlockSize: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
  paddingBlock: '2rem',
  paddingInline: '2rem',
} as const;

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
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBlockStart: '1rem' }}>
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
}: {
  error: unknown;
  onRetry?: () => void;
  onHome?: () => void;
}) {
  const { tr } = useLocale();
  return (
    <div style={wrap}>
      <div style={{ ...card, maxInlineSize: '32rem' }} role="alert">
        <h1 style={{ marginBlockStart: 0, fontSize: '1.2rem' }}>{tr('op.crash.title')}</h1>
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.crash.body')}</p>
        <Actions
          onRetry={onRetry}
          onHome={onHome}
          retryLabel={tr('op.crash.retry')}
          homeLabel={tr('op.crash.home')}
          reloadLabel={tr('op.crash.reload')}
        />
        <details style={{ marginBlockStart: '1rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
            {tr('op.crash.details')}
          </summary>
          <pre
            dir="ltr"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.75rem',
              color: 'var(--tp-muted-fg)',
              marginBlockStart: '0.5rem',
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
export function NotFoundPanel({ onHome }: { onHome?: () => void }) {
  const { tr } = useLocale();
  return (
    <div style={wrap}>
      <div style={{ ...card, maxInlineSize: '32rem' }} role="alert">
        <h1 style={{ marginBlockStart: 0, fontSize: '1.2rem' }}>{tr('op.crash.notFoundTitle')}</h1>
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
