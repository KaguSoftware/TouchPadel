/** Shared shapes for the staff admin screens. The five roles and no others (spec 06.45). */
import { AppRpcError } from '../../../lib/appRpc';
import { EdgeError } from '../../../lib/edge';
import type { StaffRole } from '../../../lib/auth';

export const ROLES: readonly StaffRole[] = ['cashier', 'prep', 'court_desk', 'manager', 'owner'];

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
 * neither (PIN_WEAK and PIN_FORMAT arrived with 0078; EMAIL_IN_USE is the
 * staff-admin edge function's body code), so without this they read as
 * "Something went wrong" and the owner retries the same PIN.
 */
export type StaffRefusal = 'pinWeak' | 'pinFormat' | 'emailInUse' | 'lastOwner' | null;

export function staffRefusal(error: unknown): StaffRefusal {
  if (error instanceof AppRpcError) {
    if (error.code === 'PIN_WEAK') return 'pinWeak';
    if (error.code === 'PIN_FORMAT') return 'pinFormat';
    if (error.code === 'LAST_OWNER') return 'lastOwner';
  }
  if (error instanceof EdgeError && error.detail === 'EMAIL_IN_USE') return 'emailInUse';
  return null;
}
