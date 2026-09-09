/**
 * SEC-35, client half — deciding what a failed role lookup MEANS.
 *
 * Migration 0081 did the server half: `set_staff_active(false)` deletes the
 * user's `auth.sessions`, so their refresh token stops working and every device
 * is ended atomically with the deactivation. It documents its own honest limit:
 * an ACCESS token already issued stays valid until `jwt_expiry`, which is 3600s
 * today, and nothing server-side can retract a signed JWT.
 *
 * That hour is what this file is about. During it a deactivated staff member's
 * till keeps a SUBSCRIBED Realtime channel. Realtime authorises a private topic
 * when the channel subscribes; it does not re-authorise a channel that is
 * already open. So the leaver's screen goes on receiving live kds / floor /
 * courts broadcasts — order traffic, table state, court movements — from a
 * venue they no longer work at, until the token expires.
 *
 * The fix has two halves and this module is the first: TELL THE DIFFERENCE
 * BETWEEN "revoked" AND "we could not ask".
 *
 * `AuthProvider.fetchStaff` used to return `null` for both. That single null is
 * wrong in both directions at once:
 *
 *   - a transient failure (the venue's wifi dropping for two seconds, a
 *     PostgREST 503) read as REVOKED, and threw a working till out to the
 *     "you are not staff" screen mid-service; and
 *   - because that was so disruptive, nothing dared re-run the lookup on a
 *     timer, which is exactly what leaves the leaver's channel alive for an
 *     hour.
 *
 * Separating them makes the re-check safe: 'unknown' keeps the previous answer
 * and changes nothing, so a blip costs nothing, and only a DEFINITE 'revoked'
 * — the row is gone, or `is_active` is false — drops the channel.
 *
 * Pure: no supabase, no react. The policy is what has to be right, so the
 * policy is what is tested (`roleResolution.test.ts`).
 */
export type StaffRole = 'cashier' | 'prep' | 'court_desk' | 'manager' | 'owner';

export interface StaffInfo {
  id: string;
  displayName: string;
  role: StaffRole;
}

export type RoleResolution =
  /** A staff row exists and is active. */
  | { kind: 'active'; info: StaffInfo }
  /** Definite: no staff row, or the row says is_active = false. */
  | { kind: 'revoked' }
  /** We could not ask. Says nothing about the account either way. */
  | { kind: 'unknown' };

/** The shape `select id, display_name, role, is_active from staff` returns. */
export interface StaffRow {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

const ROLES: readonly string[] = ['cashier', 'prep', 'court_desk', 'manager', 'owner'];

/**
 * Classify one staff lookup.
 *
 * ERROR WINS OVER DATA, deliberately: PostgREST can return both, and a response
 * carrying an error is not one to draw conclusions from. Reading a partial row
 * beside an error is how a 503 would come to mean "you were sacked".
 *
 * An unrecognised `role` string is 'revoked', not 'active'. A role this build
 * does not know cannot be checked against ROUTE_ROLES, and a value that fails
 * every comparison would render an operator with no navigation and no
 * explanation. Refusing it is both safer and more legible.
 */
export function resolveStaffRow(
  row: Partial<StaffRow> | null | undefined,
  error: unknown,
): RoleResolution {
  if (error) return { kind: 'unknown' };
  if (!row || row.is_active !== true) return { kind: 'revoked' };
  if (typeof row.id !== 'string' || !row.id) return { kind: 'revoked' };
  if (typeof row.role !== 'string' || !ROLES.includes(row.role)) return { kind: 'revoked' };
  return {
    kind: 'active',
    info: {
      id: row.id,
      displayName: typeof row.display_name === 'string' ? row.display_name : '',
      role: row.role as StaffRole,
    },
  };
}

/**
 * Drop the live Realtime channel?
 *
 * ONLY on a definite revocation. Dropping on 'unknown' would tear a till's live
 * feed down every time the venue's wifi hiccups, and a control that costs
 * service every hour is one that gets switched off within a week.
 */
export function shouldDropRealtime(resolution: RoleResolution): boolean {
  return resolution.kind === 'revoked';
}

/**
 * What the provider should hold after this resolution.
 *
 * 'unknown' returns `previous` unchanged — that is the whole point of the
 * three-way split. Note it does NOT re-assert 'active' into a null: a session
 * that never resolved stays unresolved.
 */
export function nextStaff(previous: StaffInfo | null, resolution: RoleResolution): StaffInfo | null {
  switch (resolution.kind) {
    case 'active':
      return resolution.info;
    case 'revoked':
      return null;
    case 'unknown':
      return previous;
  }
}

/**
 * How often the signed-in role is re-checked.
 *
 * This is the number that decides how long a leaver keeps a live feed, so it is
 * the number the SEC-35 leaver drill will measure ("disable an account, confirm
 * sessions end everywhere, record the elapsed time"). Without a re-check the
 * answer is "up to jwt_expiry", 60 minutes today.
 *
 * 60s is a single indexed one-row select per till per minute — nothing next to
 * the polling refetchIntervals the same screens already run — and it turns that
 * hour into a minute. It is not shorter because the remaining exposure is
 * bounded by service reality: nobody is deactivated and then watched for the
 * next thirty seconds.
 */
export const ROLE_RECHECK_MS = 60_000;
