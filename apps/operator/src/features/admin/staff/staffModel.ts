/** Shared shapes for the staff admin screens (spec 06.45). */
import { AppRpcError } from '../../../lib/appRpc';
import { EdgeError } from '../../../lib/edge';
import type { StaffRole } from '../../../lib/auth';

/**
 * Every role an account can be given, in the order the picker lists them: the
 * front of house (the waiter beside the cashier), then the bar and the kitchen
 * (the head before the team, the assistant barista last in the bar), then the
 * two roles off the floor (0155), then management. The two wave-5 roles
 * (wave5-addendum-2026-09-25 §2.1.6) are given only once every station runs
 * the operator that knows them (§7.3).
 */
export const ASSIGNABLE_ROLES: readonly StaffRole[] = [
  'cashier',
  'waiter',
  'court_desk',
  'head_barista',
  'barista',
  'assistant_barista',
  'head_chef',
  'chef',
  'driver',
  'marketing',
  'manager',
  'owner',
];

/**
 * Roles that still work but are no longer handed out. Prep split into the bar
 * and kitchen roles (0155): an account already on it keeps the kitchen screen
 * until the owner moves it to barista or chef, and a later migration drops it
 * from the guards once nobody holds it. The staff-admin edge function refuses
 * to create one; a role change to it is simply never offered.
 */
export const RETIRED_ROLES: readonly StaffRole[] = ['prep'];

export function isRetiredRole(role: StaffRole): boolean {
  return RETIRED_ROLES.includes(role);
}

export interface RoleChoice {
  role: StaffRole;
  /** Shown so the picker can name the current role, never choosable. */
  retired: boolean;
}

/**
 * What the role picker offers for an account on `current`: every assignable
 * role, and the current one FIRST when it is retired. Without that row the
 * picker of a prep account would read blank, as if it had no role. First, not
 * last: the list opens on the current row, and a disabled row cannot take
 * focus, so at the foot of the list it sat out of sight and ArrowDown found
 * nothing below it to move to.
 */
export function roleChoices(current: StaffRole): RoleChoice[] {
  const live = ASSIGNABLE_ROLES.map((role) => ({ role, retired: false }));
  return isRetiredRole(current) ? [{ role: current, retired: true }, ...live] : live;
}

/** People who can still sign in on a retired role: the Setup home's "Worth checking" row. */
export function onRetiredRole(rows: readonly StaffRow[]): number {
  return rows.filter((s) => s.is_active && isRetiredRole(s.role)).length;
}

/** Matches the edge function's floor; stated here so the form can say so first. */
export const MIN_PASSWORD = 10;

/** app.set_staff_pin since 0078 (SEC-13): 6 to 12 digits. */
export const PIN_MIN = 6;
export const PIN_MAX = 12;

export const STAFF_QUERY_KEY = ['staffList'] as const;

export interface StaffRow {
  id: string;
  display_name: string;
  role: StaffRole;
  is_active: boolean;
  /** A PIN is set (0026; every role since 0105). */
  has_pin: boolean;
}

/**
 * Every active staff member may hold a PIN since 0105: it starts and ends
 * their breaks and unlocks the idle lock. Kept as a function so the one place
 * that decides can still say no for a role later.
 */
export function holdsPin(_role: StaffRole): boolean {
  return true;
}

/**
 * Whose PIN APPROVES a discount, void or price change at the till. Managers
 * and owners only — app.verify_manager_pin filters on the role, so a cashier's
 * PIN never satisfies it however it was set.
 */
export function approvesWithPin(role: StaffRole): boolean {
  return role === 'manager' || role === 'owner';
}

/**
 * Loose email shape check for the add form: enough to catch a name typed into
 * the email box. The auth server is the real judge.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** A PIN the client can already tell the server would refuse on format. */
export function pinFormatOk(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/**
 * The refusals this screen can explain in its own words. lib/errors.ts maps
 * neither (PIN_WEAK and PIN_FORMAT arrived with 0078; EMAIL_IN_USE and
 * ROLE_RETIRED are the staff-admin edge function's body codes), so without
 * this they read as "Something went wrong" and the owner retries the same PIN.
 * This build never offers prep, so ROLE_RETIRED only arrives if something
 * else sends it.
 */
export type StaffRefusal = 'pinWeak' | 'pinFormat' | 'emailInUse' | 'roleRetired' | 'lastOwner' | null;

export function staffRefusal(error: unknown): StaffRefusal {
  if (error instanceof AppRpcError) {
    if (error.code === 'PIN_WEAK') return 'pinWeak';
    if (error.code === 'PIN_FORMAT') return 'pinFormat';
    if (error.code === 'LAST_OWNER') return 'lastOwner';
    // 0157: set_staff_role refuses a move onto prep, the same word the edge
    // function uses on create.
    if (error.code === 'ROLE_RETIRED') return 'roleRetired';
  }
  if (error instanceof EdgeError && error.detail === 'EMAIL_IN_USE') return 'emailInUse';
  if (error instanceof EdgeError && error.detail === 'ROLE_RETIRED') return 'roleRetired';
  return null;
}
