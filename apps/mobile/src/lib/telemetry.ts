/**
 * Error reporting seam.
 *
 * The app previously had NO crash reporting and three silent `catch {}` blocks,
 * which made it a total black box in production. This module is the one place
 * errors are funnelled through, so:
 *   - nothing is swallowed silently ever again;
 *   - swapping in Sentry later is a single `setReporter` call, not a hunt
 *     through every catch block.
 *
 * Sentry is deliberately NOT wired in here yet: @sentry/react-native needs a
 * native module, which breaks the Expo Go dev loop that SDK 54 was chosen to
 * preserve. Call `setReporter` from a dev-client-only entry once an EAS
 * development build exists — see docs/design/mobile-audit-2026-08-27.md.
 *
 * Every function here is failure-proof by construction: telemetry must never be
 * the reason a screen crashes.
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

/** Install a real backend (Sentry) — safe to call once, at startup. */
export function setReporter(next: Reporter | null): void {
  reporter = next;
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

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  try {
    reporter?.captureException(error, { ...context, breadcrumbs: crumbs });
  } catch {
    /* ignore */
  }
  if (__DEV__) {
    console.error('[telemetry]', describeError(error), context ?? '');
  }
}

export function captureMessage(
  message: string,
  severity: Severity = 'info',
  context?: Record<string, unknown>,
): void {
  try {
    reporter?.captureMessage(message, severity, { ...context, breadcrumbs: crumbs });
  } catch {
    /* ignore */
  }
  if (__DEV__ && severity !== 'info') {
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
