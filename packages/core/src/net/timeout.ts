/**
 * Request deadlines for every client.
 *
 * Nothing used to time out: a request the network swallowed (a captive
 * portal, a half-open socket after the phone slept, a till on a dying Wi-Fi)
 * left a spinner up and a mutation pending forever, and on the till it held
 * the one in-flight slot every later request queued behind. Every call now
 * carries a deadline (15 s by default; longer, or none, for the calls known to
 * be slow: reports, analytics, model calls, uploads, streams) and a call that
 * misses it fails with RequestTimeoutError — a retryable transport failure
 * (./retry.ts), never a crash and never a hang.
 *
 * Only standard AbortController / setTimeout are used (no AbortSignal.timeout
 * or AbortSignal.any), because React Native's AbortController has neither,
 * and the abort is never given a reason: React Native's fetch rejects with a
 * plain AbortError whatever the reason was, so a timeout is recognised by the
 * deadline having fired, not by the error the platform threw.
 */

/** The default deadline for one request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Reports, analytics and other deliberately heavy reads. */
export const LONG_REQUEST_TIMEOUT_MS = 60_000;

/**
 * A request that missed its deadline. A TypeError, like the platforms' own
 * "Failed to fetch", so every reader that treats a TypeError as a connection
 * problem (the operator's errorToMessageKey) already shows it as one; its
 * name is the platform's 'TimeoutError' and its message starts "Request timed
 * out", which mobile's transport classifier and isRetryableError both read.
 */
export class RequestTimeoutError extends TypeError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, what?: string) {
    super(`Request timed out after ${timeoutMs} ms${what ? ` (${what})` : ''}`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** A usable deadline, or null for "no deadline" (null, 0, negative, NaN, Infinity). */
export function normalizeTimeout(ms: number | null | undefined, fallback: number | null): number | null {
  const v = ms === undefined ? fallback : ms;
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

type Timer = ReturnType<typeof setTimeout>;

/** Node keeps a pending timer alive; a deadline must never hold a process open. */
function unref(timer: Timer): Timer {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

export interface Deadline {
  /** Pass this to the request. Aborts when the deadline fires or the parent aborts. */
  readonly signal: AbortSignal;
  /** True once THIS deadline fired (a parent's abort is not a timeout). */
  timedOut(): boolean;
  /** The call settled: stop the timer and let go of the parent. */
  clear(): void;
}

/**
 * Start a deadline. For calls that resolve with an error instead of throwing
 * (a supabase-js builder answers `{ error }`), check `timedOut()` after the
 * await and report a RequestTimeoutError yourself.
 */
export function startDeadline(timeoutMs: number, parent?: AbortSignal | null): Deadline {
  const controller = new AbortController();
  let fired = false;
  const onParentAbort = () => {
    clearTimeout(timer);
    controller.abort();
  };
  const timer = unref(
    setTimeout(() => {
      fired = true;
      parent?.removeEventListener('abort', onParentAbort);
      controller.abort();
    }, timeoutMs),
  );
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener('abort', onParentAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => fired,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

export interface RequestTimeoutOptions {
  /** A caller's own signal (a Stop button, TanStack's query signal): still honoured. */
  parent?: AbortSignal | null;
  /** Named in the error message: the RPC or function that timed out. */
  what?: string;
}

/**
 * Run `call` under a deadline. It rejects with RequestTimeoutError once the
 * deadline fires, even when `call` ignores its signal (a fetch that cannot be
 * aborted still releases the caller), and whatever error the platform threw
 * for the abort. `timeoutMs` null runs the call with no deadline.
 */
export function withRequestTimeout<T>(
  timeoutMs: number | null,
  call: (signal: AbortSignal | undefined) => Promise<T>,
  opts: RequestTimeoutOptions = {},
): Promise<T> {
  const ms = normalizeTimeout(timeoutMs, null);
  if (ms === null) return call(opts.parent ?? undefined);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      opts.parent?.removeEventListener('abort', onParentAbort);
    };
    const timer = unref(
      setTimeout(() => {
        if (settled) return;
        finish();
        controller.abort();
        reject(new RequestTimeoutError(ms, opts.what));
      }, ms),
    );
    if (opts.parent) {
      if (opts.parent.aborted) controller.abort();
      else opts.parent.addEventListener('abort', onParentAbort);
    }
    let pending: Promise<T>;
    try {
      pending = call(controller.signal);
    } catch (error) {
      finish();
      reject(error);
      return;
    }
    pending.then(
      (value) => {
        if (settled) return;
        finish();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        finish();
        reject(error);
      },
    );
  });
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as { url?: unknown; href?: unknown };
    if (typeof o.url === 'string') return o.url;
    if (typeof o.href === 'string') return o.href;
  }
  return String(input);
}

/** The path of a request, for the timeout message (no host, no query string). */
function pathOf(url: string): string {
  const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)?/i.exec(url);
  return m ? (m[1] ?? '/') : url.split('?')[0] ?? url;
}

/**
 * A `fetch` for createClient's `global.fetch` that gives every request a
 * deadline chosen by `timeoutFor(url, init)` (null = none: uploads, streams).
 *
 * A request that already carries a signal is left alone: its caller owns the
 * deadline (an appRpc call with its own, a Stop button). Otherwise the
 * deadline also covers reading the body: the timer is not cleared when the
 * headers arrive, so a body that stalls is cut at the same deadline (aborting
 * a fetch whose body was already read does nothing).
 */
export function timeoutFetch(
  base: typeof fetch,
  timeoutFor: (url: string, init?: RequestInit) => number | null,
): typeof fetch {
  const wrapped = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    if (init?.signal) return base(input, init);
    const url = urlOf(input);
    const ms = normalizeTimeout(timeoutFor(url, init), null);
    if (ms === null) return base(input, init);
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const controller = new AbortController();
      const timer = unref(
        setTimeout(() => {
          controller.abort();
          if (settled) return;
          settled = true;
          reject(new RequestTimeoutError(ms, pathOf(url)));
        }, ms),
      );
      base(input, { ...init, signal: controller.signal }).then(
        (res) => {
          if (settled) return;
          settled = true;
          resolve(res);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
  return wrapped as typeof fetch;
}
