/**
 * Can this station reach the server right now? One answer for the whole
 * renderer (F-05, F-23, F-31), read by code that is not a React component:
 * appRpc (queue an admin save instead of losing it), mutate (check a PIN
 * against the station's own cache instead of queueing a wrong one) and the
 * error mapper ("No connection", never "Something went wrong").
 *
 * Three witnesses, the most recent wins:
 *  - the heartbeat (lib/heartbeat.ts) every 10 s: a beat that lands is online,
 *    one that fails is offline;
 *  - any RPC: a transport failure (no answer at all) is offline at once, an
 *    answer of any kind is online;
 *  - the browser's own `navigator.onLine === false` (cable out, Wi-Fi off),
 *    which is offline whatever the last beat said.
 *
 * Browser mode (vite dev, Playwright) has no queue and no PIN cache; nothing
 * there branches on this except the error wording.
 */

type Listener = (online: boolean) => void;

let reachable = true;
const listeners = new Set<Listener>();

function navigatorOffline(): boolean {
  // globalThis, not the DOM global: packages/db compiles this file without the DOM lib.
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return !!nav && nav.onLine === false;
}

/** True when the last witness said the server cannot be reached. */
export function isStationOffline(): boolean {
  return !reachable || navigatorOffline();
}

/** Record what a heartbeat or an RPC just learnt. */
export function setStationReachable(online: boolean): void {
  if (reachable === online) return;
  reachable = online;
  for (const l of listeners) {
    try {
      l(online);
    } catch {
      // A listener's bug must not stop the others hearing it.
    }
  }
}

/** Subscribe to changes (not to every beat). */
export function onReachabilityChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tests only: back to the boot state. */
export function resetConnectivityForTests(): void {
  reachable = true;
  listeners.clear();
}

/**
 * A failure that never reached the server: fetch's TypeError (our own
 * RequestTimeoutError is one), or postgrest-js / functions-js wrapping that
 * TypeError into an error object whose message still says so. postgrest-js
 * catches the fetch rejection and answers `{ message: 'TypeError: Failed to
 * fetch' }` with no SQLSTATE and status 0, which the old mapper read as
 * UNKNOWN, "Something went wrong" (F-31).
 */
const TRANSPORT_TEXT = /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_internet_disconnected|err_network|err_connection|econnrefused|enotfound|etimedout|socket hang up|aborted|request timed out/i;

export function isTransportFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown; status?: unknown; sqlState?: unknown; code?: unknown };
  if (e.name === 'FunctionsFetchError' || e.name === 'AbortError') return true;
  // A real server answer has an HTTP status or a SQLSTATE; a transport failure has neither.
  const answered = (typeof e.status === 'number' && e.status > 0) || (typeof e.sqlState === 'string' && e.sqlState !== '');
  if (answered) return false;
  if (e.code !== undefined && e.code !== 'UNKNOWN' && e.code !== '' && e.code !== null) return false;
  return typeof e.message === 'string' && TRANSPORT_TEXT.test(e.message);
}
