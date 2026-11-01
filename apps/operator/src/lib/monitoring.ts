/**
 * Dev monitoring from the operator (F-15, F-26; migration 0393).
 *
 * `reportEvent` sends one event to `app.report_event`, the dev role's
 * Monitoring page (/monitoring) lists it. It NEVER throws and never blocks a
 * screen: a failure to report must not be the reason a till goes dark.
 *
 * Offline: an event that cannot be delivered goes into a small outbox kept in
 * localStorage (memory when storage is unavailable) and is sent again when the
 * station is back online, on the next report, and once a minute. Monitoring
 * is not a business write, so it does not ride the mutation queue (whose six
 * registered copies are for money and orders); the outbox is capped so a
 * station offline for a week cannot fill its disk.
 *
 * Other lanes import ONLY `reportEvent` (the contract in DECISIONS.md).
 */
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

export const OUTBOX_KEY = 'tp.monitoring.outbox.v1';
export const OUTBOX_MAX = 50;
/** A report gets this long; a slower network keeps it for later. */
export const REPORT_TIMEOUT_MS = 8_000;
export const FLUSH_INTERVAL_MS = 60_000;

interface QueuedEvent {
  args: ReportEventArgs;
  at: string;
}

let memoryOutbox: QueuedEvent[] = [];
let flushing: Promise<void> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readOutbox(): QueuedEvent[] {
  const s = storage();
  if (!s) return memoryOutbox;
  try {
    const raw = s.getItem(OUTBOX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]).filter((e) => e && typeof e === 'object' && e.args) : [];
  } catch {
    return memoryOutbox;
  }
}

function writeOutbox(events: QueuedEvent[]): void {
  const capped = events.slice(-OUTBOX_MAX);
  memoryOutbox = capped;
  const s = storage();
  if (!s) return;
  try {
    if (capped.length === 0) s.removeItem(OUTBOX_KEY);
    else s.setItem(OUTBOX_KEY, JSON.stringify(capped));
  } catch {
    /* quota or a locked profile: the memory copy still holds it */
  }
}

/** How many events wait to be sent (the panel and tests read it). */
export function pendingReports(): number {
  return readOutbox().length;
}

function appVersion(): string | null {
  try {
    const v = import.meta.env?.VITE_APP_VERSION;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

function context(): Record<string, unknown> {
  try {
    const out: Record<string, unknown> = {};
    if (typeof location !== 'undefined') out.route = location.pathname;
    if (typeof navigator !== 'undefined') {
      out.online = navigator.onLine;
      out.agent = navigator.userAgent?.slice(0, 160);
    }
    return out;
  } catch {
    return {};
  }
}

async function send(args: ReportEventArgs): Promise<boolean> {
  try {
    const call = supabase.schema('app').rpc('report_event' as never, args as never) as unknown as {
      abortSignal?: (s: AbortSignal) => PromiseLike<{ error: unknown }>;
    } & PromiseLike<{ error: unknown }>;
    let answer: { error: unknown };
    if (typeof AbortController !== 'undefined' && typeof call.abortSignal === 'function') {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), REPORT_TIMEOUT_MS);
      try {
        answer = await call.abortSignal(ctl.signal);
      } finally {
        clearTimeout(timer);
      }
    } else {
      answer = await call;
    }
    return !answer?.error;
  } catch {
    return false;
  }
}

/** Send what the outbox holds, oldest first; stops at the first failure. Never throws. */
export function flushReports(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      let events = readOutbox();
      while (events.length > 0) {
        const [head] = events;
        if (!head || !(await send(head.args))) break;
        events = readOutbox().slice(1);
        writeOutbox(events);
      }
    } catch {
      /* never throws */
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Report one event to dev monitoring. Never throws. Answers `sent` when the
 * server took it, `queued` when it waits in the outbox for the network, and
 * `failed` only when even the outbox could not take it.
 */
export async function reportEvent(input: MonitorEventInput): Promise<ReportOutcome> {
  let args: ReportEventArgs;
  try {
    args = toReportArgs('operator', input, appVersion(), context());
  } catch {
    return 'failed';
  }
  try {
    if (await send(args)) {
      if (readOutbox().length > 0) void flushReports();
      return 'sent';
    }
  } catch {
    /* fall through to the outbox */
  }
  try {
    writeOutbox([...readOutbox(), { args, at: new Date().toISOString() }]);
    return 'queued';
  } catch {
    return 'failed';
  }
}

/** Report a thrown value as an error of `kind` (a crash screen, a catch block). Never throws. */
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

let started = false;

/**
 * Flush the outbox when the station comes back online and once a minute.
 * Called once at boot (main.tsx). Returns a teardown for tests.
 */
export function startMonitoringOutbox(target: Window | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  if (started || !target) return () => {};
  started = true;
  const onOnline = () => void flushReports();
  target.addEventListener('online', onOnline);
  const timer = setInterval(() => void flushReports(), FLUSH_INTERVAL_MS);
  void flushReports();
  return () => {
    target.removeEventListener('online', onOnline);
    clearInterval(timer);
    started = false;
  };
}

/** The monitoring kind for a telemetry context: a boundary is a crash, a global handler an unhandled error. */
export function kindForContext(context: Record<string, unknown> | undefined): string {
  if (context?.boundary) return 'crash';
  if (context?.kind === 'window.onerror' || context?.kind === 'unhandledrejection') return 'unhandled';
  return 'error';
}

function contextDetail(context: Record<string, unknown> | undefined): Record<string, unknown> {
  const { breadcrumbs: _crumbs, componentStack, ...rest } = context ?? {};
  void _crumbs;
  return {
    ...rest,
    ...(typeof componentStack === 'string' ? { componentStack: componentStack.split('\n').slice(0, 12).join('\n') } : {}),
    trail: breadcrumbs().slice(-10).map((c) => c.message),
  };
}

const SEVERITY_LEVEL: Record<Severity, MonitorEventInput['level'] | null> = {
  fatal: 'error',
  error: 'error',
  warning: 'warn',
  info: null,
};

/**
 * Route telemetry.ts into monitoring (F-15): every `captureException` (crash
 * boundaries, the window's error and unhandledrejection handlers, `swallow`)
 * and every warning or error `captureMessage` is reported without a button.
 * Called once at boot (main.tsx).
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

/** Tests only: forget the in-memory outbox. */
export function __resetMonitoringForTests(): void {
  memoryOutbox = [];
  flushing = null;
  started = false;
}
