/**
 * Dev monitoring from the phone (F-15, F-26; migration 0393).
 *
 * `reportEvent` sends one event to `app.report_event`; the dev role's
 * Monitoring page on the operator lists it. It NEVER throws: a failure to
 * report must never be the reason a screen crashes.
 *
 * Best effort: one try, and one more after a short wait if the first did not
 * land (a phone between networks). An event that still cannot be delivered
 * is kept in memory (a handful at most) and goes out with the next report that
 * does. Nothing is written to disk: a crash report is worth little a week
 * later and the phone's storage is the guest's.
 *
 * telemetry.ts's reporter is wired to this (see `monitoringReporter`), so
 * every `captureException` in the app arrives here too.
 */
import Constants from 'expo-constants';
import {
  errorDetail,
  errorMessage,
  toReportArgs,
  type MonitorEventInput,
  type ReportEventArgs,
  type ReportOutcome,
} from '@touch/core/monitoring';
import { supabase } from './supabase';
import { breadcrumbs, setReporter, type Severity } from './telemetry';

export type { MonitorEventInput, ReportOutcome } from '@touch/core/monitoring';

export const RETRY_DELAY_MS = 2_000;
export const REPORT_TIMEOUT_MS = 8_000;
export const PENDING_MAX = 10;

let pending: ReportEventArgs[] = [];

function appVersion(): string | null {
  try {
    return Constants.expoConfig?.version ?? null;
  } catch {
    return null;
  }
}

function context(): Record<string, unknown> {
  try {
    const platform = (Constants as { platform?: Record<string, unknown> }).platform;
    return { platform: platform ? Object.keys(platform)[0] ?? null : null };
  } catch {
    return {};
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function send(args: ReportEventArgs): Promise<boolean> {
  try {
    const call = supabase.schema('app').rpc('report_event' as never, args as never) as unknown as {
      abortSignal?: (s: AbortSignal) => PromiseLike<{ error: unknown }>;
    } & PromiseLike<{ error: unknown }>;
    if (typeof AbortController !== 'undefined' && typeof call.abortSignal === 'function') {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), REPORT_TIMEOUT_MS);
      try {
        const answer = await call.abortSignal(ctl.signal);
        return !answer?.error;
      } finally {
        clearTimeout(timer);
      }
    }
    const answer = await call;
    return !answer?.error;
  } catch {
    return false;
  }
}

async function flushPending(): Promise<void> {
  const batch = pending;
  pending = [];
  for (const args of batch) {
    if (!(await send(args))) {
      pending = [...pending, args].slice(-PENDING_MAX);
    }
  }
}

/**
 * Report one event to dev monitoring. Never throws. Answers `sent` when the
 * server took it, `queued` when it is held for the next report, `failed`
 * when the event itself could not be built.
 */
export async function reportEvent(input: MonitorEventInput): Promise<ReportOutcome> {
  let args: ReportEventArgs;
  try {
    args = toReportArgs('mobile', input, appVersion(), context());
  } catch {
    return 'failed';
  }
  try {
    if ((await send(args)) || (await wait(RETRY_DELAY_MS).then(() => send(args)))) {
      if (pending.length > 0) void flushPending().catch(() => undefined);
      return 'sent';
    }
    pending = [...pending, args].slice(-PENDING_MAX);
    return 'queued';
  } catch {
    return 'failed';
  }
}

/** Report a thrown value as an error of `kind`. Never throws. */
export function reportError(
  kind: string,
  error: unknown,
  opts: { detail?: Record<string, unknown>; userReported?: boolean; level?: MonitorEventInput['level'] } = {},
): Promise<ReportOutcome> {
  return reportEvent({
    level: opts.level ?? 'error',
    kind,
    message: errorMessage(error),
    detail: { ...errorDetail(error), ...(opts.detail ?? {}) },
    userReported: opts.userReported,
  });
}

/** The monitoring kind for a telemetry context: a render crash, an uncaught error, or a caught one. */
export function kindForContext(context: Record<string, unknown> | undefined): string {
  if (context?.fatal === true || context?.scope === 'render') return 'crash';
  if (context?.scope === 'global') return 'unhandled';
  return 'error';
}

function contextDetail(context: Record<string, unknown> | undefined): Record<string, unknown> {
  const { breadcrumbs: _crumbs, ...rest } = context ?? {};
  void _crumbs;
  return { ...rest, trail: breadcrumbs().slice(-10).map((c) => c.message) };
}

const SEVERITY_LEVEL: Record<Severity, MonitorEventInput['level'] | null> = {
  fatal: 'error',
  error: 'error',
  warning: 'warn',
  info: null,
};

/**
 * F-15: route telemetry.ts into monitoring, so every `captureException` (the
 * root ErrorBoundary, the Apple-revoke failure on account deletion, every
 * `swallow`) and every warning or error `captureMessage` is reported without
 * a button. Called once at boot (app/_layout.tsx).
 */
export function installMonitoringReporter(): void {
  setReporter({
    captureException(error, context) {
      void reportError(kindForContext(context), error, { detail: contextDetail(context) });
    },
    captureMessage(message, severity, context) {
      const level = SEVERITY_LEVEL[severity];
      if (!level) return;
      void reportEvent({ level, kind: 'message', message, detail: contextDetail(context) });
    },
    addBreadcrumb() {
      /* the trail is attached to each report instead */
    },
  });
}

interface ErrorUtilsLike {
  getGlobalHandler(): ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

let globalInstalled = false;

/**
 * Uncaught JS errors (React Native's ErrorUtils): reported, then handed to the
 * handler that was there before, so the red box in development and the native
 * crash in production behave as they always did. Never throws.
 */
export function installGlobalErrorReporting(
  utils: ErrorUtilsLike | undefined = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils,
): void {
  try {
    if (globalInstalled || !utils) return;
    globalInstalled = true;
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((error, isFatal) => {
      try {
        void reportError(isFatal ? 'crash' : 'unhandled', error, { detail: { fatal: isFatal === true, scope: 'global' } });
      } catch {
        /* never in the way of the crash itself */
      }
      previous?.(error, isFatal);
    });
  } catch {
    /* never throws */
  }
}

/** How many events wait for the next report (tests). */
export function pendingReports(): number {
  return pending.length;
}

/** Tests only. */
export function __resetMonitoringForTests(): void {
  pending = [];
  globalInstalled = false;
}
