/**
 * Dev monitoring from the web site (F-15, F-43; migration 0393).
 *
 * `reportEvent` sends one event to `app.report_event`; the dev role's
 * Monitoring page on the operator lists it. It NEVER throws: a page that
 * failed must not fail again while saying so.
 *
 * A plain `fetch` to PostgREST with the public anon key, so it works the same
 * from a client component (error.tsx, global-error.tsx, the café menu's
 * Retry) and from the server (instrumentation's onRequestError), and it never
 * touches the café's `sb-*` cookie session or the account's. Best effort:
 * one try and one more after a short wait.
 */
import {
  errorDetail,
  errorMessage,
  toReportArgs,
  type MonitorEventInput,
  type ReportEventArgs,
  type ReportOutcome,
} from '@touch/core/monitoring';
import { supabaseEnv } from './supabase/env';

export type { MonitorEventInput, ReportOutcome } from '@touch/core/monitoring';

export const RETRY_DELAY_MS = 1_500;
export const REPORT_TIMEOUT_MS = 8_000;

function appVersion(): string | null {
  try {
    const v = process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    return v ? v.slice(0, 40) : null;
  } catch {
    return null;
  }
}

function context(): Record<string, unknown> {
  try {
    if (typeof window === 'undefined') return { side: 'server' };
    return {
      side: 'browser',
      route: window.location?.pathname ?? null,
      online: typeof navigator === 'undefined' ? null : navigator.onLine,
      agent: typeof navigator === 'undefined' ? null : navigator.userAgent?.slice(0, 160),
    };
  } catch {
    return {};
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function send(args: ReportEventArgs): Promise<boolean> {
  try {
    const { url, anonKey } = supabaseEnv();
    const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), REPORT_TIMEOUT_MS) : null;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/report_event`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
          'content-profile': 'app',
        },
        body: JSON.stringify(args),
        keepalive: true,
        signal: ctl?.signal,
        cache: 'no-store',
      });
      return res.ok;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * Report one event to dev monitoring. Never throws. Answers `sent` when the
 * server took it and `failed` when two tries did not land.
 */
export async function reportEvent(input: MonitorEventInput): Promise<ReportOutcome> {
  try {
    const args = toReportArgs('web', input, appVersion(), context());
    if (await send(args)) return 'sent';
    await wait(RETRY_DELAY_MS);
    return (await send(args)) ? 'sent' : 'failed';
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
