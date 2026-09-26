/**
 * The staff roles every app knows, and what one staff-row lookup means.
 *
 * Moved here from apps/operator/src/lib/roleResolution.ts
 * (docs/design/protocols/build-contracts-2026-09-23.md §7.1) so the operator
 * and the staff phone classify a row with the same code and the same role
 * list. The operator keeps its SEC-35 file, which re-exports these names and
 * reads `unknown_role` as revoked; the phone reads it as "update the app"
 * (apps/mobile/src/features/staff/status.ts).
 *
 * Deno cannot import this package. packages/db/tests/staff-roles-parity.test.ts
 * holds the hand-written copies (the edge functions' `StaffRole`, staff-admin's
 * role lists, the two `Role` unions of the shell and its bridge) and, with the
 * stack up, the `staff_role` enum itself equal to STAFF_ROLES.
 *
 * Pure: no supabase, no react.
 */

/**
 * Every value of the `staff_role` enum this build knows, in the enum's own
 * order. The type is derived from the list, so a role cannot be added to one
 * and forgotten in the other.
 *
 * The last six arrived together (0155): the bar and kitchen split into
 * head barista, barista, head chef and chef, each with exactly the kitchen
 * display prep had, and driver and marketing, who hold the any-staff baseline
 * and land on My tasks. `prep` is soft-retired: existing prep accounts keep
 * working, and the Staff page no longer offers it for a new account.
 *
 * Wave 5 appended two (docs/design/protocols/wave5-addendum-2026-09-25.md
 * §2.1): the assistant barista, who works the bar's tickets on the kitchen
 * display and reads the bar's teachings and recipe names, and the waiter, who
 * holds the any-staff baseline and lands on My tasks.
 */
export const STAFF_ROLES = [
  'cashier',
  'prep',
  'court_desk',
  'manager',
  'owner',
  'head_barista',
  'barista',
  'head_chef',
  'chef',
  'driver',
  'marketing',
  'assistant_barista',
  'waiter',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Still a `staff_role`, and every guard still admits it, but never a new account's. */
export const RETIRED_ROLES: readonly StaffRole[] = ['prep'];

/**
 * The roles a new account may start on, and the only ones an owner may give an
 * owner-added protocol step (§2.1 HIREABLE; `INVALID_ROLE` outside it). Owner
 * is left out on purpose: nobody is hired as an owner. The checklist and step
 * pickers list them in this order, each new role beside its nearest
 * (wave 5 §2.1.6).
 */
export const HIREABLE_ROLES: readonly StaffRole[] = [
  'cashier',
  'waiter',
  'court_desk',
  'manager',
  'head_barista',
  'barista',
  'assistant_barista',
  'head_chef',
  'chef',
  'driver',
  'marketing',
];

/**
 * How often a signed-in role is re-checked.
 *
 * This is the number that decides how long a leaver keeps a live feed, so it is
 * the number the SEC-35 leaver drill will measure ("disable an account, confirm
 * sessions end everywhere, record the elapsed time"). Without a re-check the
 * answer is "up to jwt_expiry", 60 minutes today.
 *
 * 60s is a single indexed one-row select per device per minute, and it turns
 * that hour into a minute. It is not shorter because the remaining exposure is
 * bounded by service reality: nobody is deactivated and then watched for the
 * next thirty seconds.
 */
export const ROLE_RECHECK_MS = 60_000;

export interface StaffInfo {
  id: string;
  displayName: string;
  role: StaffRole;
}

/** The shape `select id, display_name, role, is_active from staff` returns. */
export interface StaffRow {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

export type RoleResolution =
  /** A staff row exists, is active, and holds a role this build knows. */
  | { kind: 'active'; info: StaffInfo }
  /** Definite: no staff row, or the row says is_active = false. */
  | { kind: 'revoked' }
  /**
   * An active row whose role this build does not know: a newer database than
   * the app. The operator reads it as revoked (a role it cannot check against
   * ROUTE_ROLES would render a shell with no navigation); the phone asks for an
   * update instead of pretending the account is gone.
   */
  | { kind: 'unknown_role'; role: string }
  /** We could not ask. Says nothing about the account either way. */
  | { kind: 'unknown' };

const ROLES: readonly string[] = STAFF_ROLES;

/** True for a value of the `staff_role` enum this build knows. */
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && ROLES.includes(value);
}

/**
 * Classify one staff lookup.
 *
 * ERROR WINS OVER DATA, deliberately: PostgREST can return both, and a response
 * carrying an error is not one to draw conclusions from. Reading a partial row
 * beside an error is how a 503 would come to mean "you were sacked".
 *
 * `is_active` must be exactly `true`: a select that forgot the column reads as
 * revoked, never as active. A missing or empty role string is not a role at all,
 * so it is revoked too; only a real, unrecognised role string is `unknown_role`.
 */
export function resolveStaffRow(
  row: Partial<StaffRow> | null | undefined,
  error: unknown,
): RoleResolution {
  if (error) return { kind: 'unknown' };
  if (!row || row.is_active !== true) return { kind: 'revoked' };
  if (typeof row.id !== 'string' || !row.id) return { kind: 'revoked' };
  if (typeof row.role !== 'string' || !row.role) return { kind: 'revoked' };
  if (!isStaffRole(row.role)) return { kind: 'unknown_role', role: row.role };
  return {
    kind: 'active',
    info: {
      id: row.id,
      displayName: typeof row.display_name === 'string' ? row.display_name : '',
      role: row.role,
    },
  };
}

/**
 * What a holder of the signed-in staff member should keep after a resolution.
 *
 * 'unknown' returns `previous` unchanged: that is the whole point of telling
 * "revoked" from "could not ask". It does NOT re-assert 'active' into a null: a
 * session that never resolved stays unresolved. 'unknown_role' and 'revoked'
 * both give null, because neither leaves a role this build can act on.
 */
export function nextStaff(previous: StaffInfo | null, resolution: RoleResolution): StaffInfo | null {
  switch (resolution.kind) {
    case 'active':
      return resolution.info;
    case 'revoked':
    case 'unknown_role':
      return null;
    case 'unknown':
      return previous;
  }
}

/**
 * The two teams of the role spec (plan #64, #65): bar (head barista, barista,
 * and since wave 5 the assistant barista) and kitchen (head chef, chef).
 * Teachings and ideas are addressed by team. These are the twins of
 * `app.staff_team` and `app.staff_team_head` (0170, `staff_team` re-issued by
 * assistant_barista_waiter_access); roles.test.ts pins the mapping. The
 * waiter joins neither: the manager leads him (addendum §8 Q2).
 */
export const STAFF_TEAMS = ['bar', 'kitchen'] as const;

export type StaffTeam = (typeof STAFF_TEAMS)[number];

/** The team a role belongs to, or null for a role outside both (`app.staff_team`). */
export function teamOf(role: StaffRole): StaffTeam | null {
  switch (role) {
    case 'head_barista':
    case 'barista':
    case 'assistant_barista':
      return 'bar';
    case 'head_chef':
    case 'chef':
      return 'kitchen';
    default:
      return null;
  }
}

/** Each team's head role (`app.staff_team_head`). */
export const TEAM_HEAD: Record<StaffTeam, StaffRole> = {
  bar: 'head_barista',
  kitchen: 'head_chef',
};
