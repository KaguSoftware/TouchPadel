/**
 * Which branch this operator is working at, as the server sees it (multi-venue
 * slice 4). Two request headers ride on every Supabase call:
 *
 *   x-station-id   this machine's station id (0215): the server files writes
 *                  and resolves "my venue" by the station's branch, when the
 *                  station is registered there and the signed-in person works
 *                  there.
 *   x-venue-scope  the branch the screens show (0226): the owner's switcher
 *                  choice, or 'all' while a report page asks for every branch.
 *                  Staff reads (RLS) and reports follow it; it can only narrow
 *                  what the person may see, never widen it.
 *
 * Module state, not React state: the Supabase client is created once, so a
 * custom fetch reads the current values on every request. `VenueProvider`
 * (lib/venue.tsx) keeps them up to date.
 */
let stationId: string | null = null;
let branchId: string | null = null;
let reportAll = false;

/** This machine's station id; set once at start (a station change relaunches the app). */
export function setStationHeader(id: string | null): void {
  stationId = id && id.trim() ? id.trim() : null;
}

/** The branch the screens show; null until known (the server then resolves it). */
export function setBranchScope(id: string | null): void {
  branchId = id;
}

/** A report page asks for every branch while it is open (owner only; the server checks). */
export function setReportAllBranches(on: boolean): void {
  reportAll = on;
}

/** The branch currently in scope, for RPC arguments that name one (p_venue_id). */
export function currentBranchId(): string | null {
  return branchId;
}

/** The headers a request carries now. Exported for tests. */
export function scopeHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (stationId) h['x-station-id'] = stationId;
  if (reportAll) h['x-venue-scope'] = 'all';
  else if (branchId) h['x-venue-scope'] = branchId;
  return h;
}

/** fetch for createClient's `global.fetch`: adds the scope headers to every call. */
export const venueFetch: typeof fetch = (input, init) => {
  const extra = scopeHeaders();
  if (Object.keys(extra).length === 0) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return fetch(input, { ...init, headers });
};
