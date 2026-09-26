/**
 * Which branch this operator is working at, as the server sees it (multi-venue
 * slice 4). Two request headers ride on every Supabase call:
 *
 *   x-station-id   this machine's station id (0215): the server files writes
 *                  and resolves "my venue" by the station's branch, when the
 *                  station is registered there and the signed-in person works
 *                  there.
 *   x-venue-scope  the branch the screens show (0226): the owner's switcher
 *                  choice, or 'all:<branch>' on the report and analytics calls
 *                  of a page that asks for every branch (the branch names the
 *                  clock the page promises, 0228). Staff reads (RLS) and
 *                  reports follow it; it can only narrow what the person may
 *                  see, never widen it. On a registered station the station
 *                  wins on the server (0228), for reads and writes alike.
 *
 * Module state, not React state: the Supabase client is created once, so a
 * custom fetch reads the current values on every request. `VenueProvider`
 * (lib/venue.tsx) keeps them up to date.
 */
let stationId: string | null = null;
let branchId: string | null = null;
/** A report page's wider scope: every branch, or one closed branch (owner). */
let reportScope: 'all' | string | null = null;

/** This machine's station id; set once at start (a station change relaunches the app). */
export function setStationHeader(id: string | null): void {
  stationId = id && id.trim() ? id.trim() : null;
}

/** The branch the screens show; null until known (the server then resolves it). */
export function setBranchScope(id: string | null): void {
  branchId = id;
}

/**
 * A report page's scope while it is open (owner only; the server checks): null
 * for the rail's branch, 'all' for every branch, or a closed branch's id, whose
 * history the owner can still read (0228, A2). Report calls only.
 */
export function setReportScope(scope: 'all' | string | null): void {
  reportScope = scope;
}

/** Kept for callers of the slice-4 name: every branch while on. */
export function setReportAllBranches(on: boolean): void {
  reportScope = on ? 'all' : null;
}

/** The branch currently in scope, for RPC arguments that name one (p_venue_id). */
export function currentBranchId(): string | null {
  return branchId;
}

/**
 * The calls "All branches" widens: the report, analytics and panel RPCs only.
 * Everything else a report page (or a badge, a heartbeat, a court list cached
 * for the desk) asks while the toggle is on stays on the rail's branch, so the
 * wider scope can never leak into another screen's cache or into a write.
 */
const REPORT_RPC = /\/rpc\/(report_|reports_|analytics_|panel_|audit_log_page)/;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** The headers a request to `url` carries now. Exported for tests. */
export function scopeHeaders(url = ''): Record<string, string> {
  const h: Record<string, string> = {};
  if (stationId) h['x-station-id'] = stationId;
  if (reportScope && REPORT_RPC.test(url)) {
    h['x-venue-scope'] = reportScope !== 'all' ? reportScope : branchId ? `all:${branchId}` : 'all';
  } else if (branchId) h['x-venue-scope'] = branchId;
  return h;
}

/** fetch for createClient's `global.fetch`: adds the scope headers to every call. */
export const venueFetch: typeof fetch = (input, init) => {
  const extra = scopeHeaders(urlOf(input));
  if (Object.keys(extra).length === 0) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return fetch(input, { ...init, headers });
};
