/**
 * Error reporting seam for the operator.
 *
 * The operator had NO crash reporting, no error boundary and no 404 route —
 * in an app whose till and KDS stations run `kiosk: true` with
 * `autoHideMenuBar: true` (operator-shell/src/main/index.ts:21-22). A React
 * render throw there is a blank screen with no menu, no address bar and no way
 * back, and the shell's `render-process-gone` reload does not fire because a
 * render throw is not a process crash.
 *
 * This module is the one place failures are funnelled through, so:
 *   - nothing is swallowed silently;
 *   - swapping in Sentry (SOW L256-257, "error tracking and uptime monitoring
 *     on the booking and ordering paths") is a single `setReporter` call rather
 *     than a hunt through every catch block.
 *
 * Mirrors apps/mobile/src/lib/telemetry.ts deliberately: one shape of reporter
 * across the two clients, so the Sentry wiring is written once.
 *
 * Every function here is failure-proof by construction — telemetry must never
 * be the reason a station goes dark.
 */

export type Severity = 'info' | 'warning' | 'error' | 'fatal';

export interface Breadcrumb {
  at: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface Reporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, severity: Severity, context?: Record<string, unknown>): void;
  addBreadcrumb(crumb: Breadcrumb): void;
}

const MAX_CRUMBS = 40;
const crumbs: Breadcrumb[] = [];
let reporter: Reporter | null = null;

/** Station / staff context attached to every report. Set once auth resolves. */
let scope: Record<string, unknown> = {};

/** Install a real backend (Sentry) — safe to call once, at startup. */
export function setReporter(next: Reporter | null): void {
  reporter = next;
}

/**
 * Identify the station and the signed-in operator. Never include a PIN, a
 * token or a guest's personal data — this payload leaves the building.
 */
export function setScope(next: Record<string, unknown>): void {
  scope = { ...scope, ...next };
}

/** The recent breadcrumb trail, oldest first. Attached to every report. */
export function breadcrumbs(): readonly Breadcrumb[] {
  return crumbs;
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  const crumb: Breadcrumb = { at: Date.now(), message, data };
  crumbs.push(crumb);
  if (crumbs.length > MAX_CRUMBS) crumbs.shift();
  try {
    reporter?.addBreadcrumb(crumb);
  } catch {
    // A telemetry backend must never break the app.
  }
}

/** Normalise anything throwable into something loggable. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const isDev = (): boolean => {
  try {
    return !!import.meta.env?.DEV;
  } catch {
    return false;
  }
};

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  try {
    reporter?.captureException(error, { ...scope, ...context, breadcrumbs: crumbs });
  } catch {
    /* ignore */
  }
  if (isDev()) {
    console.error('[telemetry]', describeError(error), context ?? '');
  }
}

export function captureMessage(
  message: string,
  severity: Severity = 'info',
  context?: Record<string, unknown>,
): void {
  try {
    reporter?.captureMessage(message, severity, { ...scope, ...context, breadcrumbs: crumbs });
  } catch {
    /* ignore */
  }
  if (isDev() && severity !== 'info') {
    console.warn('[telemetry]', message, context ?? '');
  }
}

/**
 * Replacement for a bare `catch {}`. Records the failure and returns a
 * fallback, so a non-critical path can degrade without going silent.
 */
export function swallow<T>(label: string, error: unknown, fallback: T): T {
  captureException(error, { label, swallowed: true });
  return fallback;
}

let globalHandlersInstalled = false;

/**
 * Catch what React cannot: errors thrown outside the render tree (event
 * handlers that escape, timers, and every unawaited promise). Without this an
 * `onClick` that throws leaves no trace at all on a kiosk with no devtools.
 *
 * Returns a teardown so tests can install and remove it cleanly.
 */
export function installGlobalHandlers(target: Window = window): () => void {
  if (globalHandlersInstalled) return () => {};
  globalHandlersInstalled = true;

  const onError = (event: ErrorEvent) => {
    captureException(event.error ?? event.message, {
      kind: 'window.onerror',
      source: event.filename,
      line: event.lineno,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    captureException(event.reason, { kind: 'unhandledrejection' });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    globalHandlersInstalled = false;
  };
}
