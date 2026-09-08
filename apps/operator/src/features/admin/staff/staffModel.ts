/** Shared shapes for the staff admin screens. The five roles and no others (spec 06.45). */
import type { StaffRole } from '../../../lib/auth';

export const ROLES: readonly StaffRole[] = ['cashier', 'prep', 'court_desk', 'manager', 'owner'];

/** Matches the edge function's floor; stated here so the form can say so first. */
export const MIN_PASSWORD = 10;

export const STAFF_QUERY_KEY = ['staffList'] as const;

export interface StaffRow {
  id: string;
  display_name: string;
  role: StaffRole;
  is_active: boolean;
  /** Present for managers/owners with an authorisation PIN set (0026). */
  has_pin: boolean;
}
