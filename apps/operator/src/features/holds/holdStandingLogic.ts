/**
 * The hold ladder (migration 0249), staff side. PURE: node-tested next door.
 *
 * A guest who holds courts in the app and lets the holds lapse waits 2 hours,
 * then a day, then is suspended for 7 days and listed in the day close of the
 * branch where it happened (app.hold_reviews). Staff lift it or ban for good
 * (app.hold_standing_decide); the customer record shows where a guest stands
 * (app.guest_hold_standing). Row shape: app.hold_standing_json.
 */

export type HoldStandingStatus = 'clear' | 'warned' | 'cooldown' | 'suspended' | 'banned';

export interface HoldStanding {
  id: string;
  /** 0 once the day of memory is over. */
  strikes: number;
  status: HoldStandingStatus;
  last_strike_at: string | null;
  blocked_until: string | null;
  suspended_at: string | null;
  needs_review: boolean;
  banned_at: string | null;
  guest_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
}

const STATUSES: readonly HoldStandingStatus[] = ['clear', 'warned', 'cooldown', 'suspended', 'banned'];

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** One app.hold_standing_json object, or null for anything else (a guest who never struck). */
export function parseHoldStanding(json: unknown): HoldStanding | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const status = STATUSES.includes(o.status as HoldStandingStatus) ? (o.status as HoldStandingStatus) : 'clear';
  return {
    id,
    strikes: typeof o.strikes === 'number' ? o.strikes : 0,
    status,
    last_strike_at: str(o.last_strike_at),
    blocked_until: str(o.blocked_until),
    suspended_at: str(o.suspended_at),
    needs_review: o.needs_review === true,
    banned_at: str(o.banned_at),
    guest_id: str(o.guest_id),
    guest_name: str(o.guest_name),
    guest_phone: str(o.guest_phone),
  };
}

/** app.hold_reviews: the rows that parse, in the server's order (oldest suspension first). */
export function holdReviewRows(json: unknown): HoldStanding[] {
  if (!Array.isArray(json)) return [];
  return json.map(parseHoldStanding).filter((r): r is HoldStanding => r !== null);
}

/**
 * What staff may do about a standing. Lift clears everything (a wait, a
 * suspension, a ban, even a warning); a ban is offered until there is one.
 */
export function holdStandingActions(s: HoldStanding): { lift: boolean; ban: boolean } {
  return { lift: s.status !== 'clear', ban: s.status !== 'banned' };
}

/** The customer record shows the panel only when there is something to say. */
export function showHoldStanding(s: HoldStanding | null | undefined): s is HoldStanding {
  return !!s && s.status !== 'clear';
}
