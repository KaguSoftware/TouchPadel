/**
 * `/till` search params — hand parser (no zod in the operator app).
 *   ?tab=<uuid>          open the till with that tab selected (from 06.12)
 *   ?reservation=<uuid>  open the new-tab dialog pre-bound to that booking (from the desk)
 * Anything that is not a uuid is dropped, so a mangled link lands on a plain till.
 */
export interface TillSearch {
  tab?: string;
  reservation?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: unknown): string | undefined {
  return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : undefined;
}

export function validateTillSearch(raw: Record<string, unknown>): TillSearch {
  const out: TillSearch = {};
  const tab = uuid(raw.tab);
  const reservation = uuid(raw.reservation);
  if (tab) out.tab = tab;
  if (reservation) out.reservation = reservation;
  return out;
}
