/**
 * Route-gate decisions for the staff area, as pure functions (vitest), in the
 * shape of src/features/auth/gate.ts. RequireStaff and GuestTabsGate render
 * what these answer (build-contracts-2026-09-23 §6.5).
 */
import type { StaffRole } from '@touch/core';
import type { StaffStatus } from './status';

export type StaffGateDecision =
  | 'loading'
  | 'allow'
  /** Not staff (or signed out): the guest app. */
  | 'redirect-guest'
  /** Staff, but not a role this page is for: back to Today. */
  | 'redirect-staff-home'
  | 'revoked'
  | 'unsupported';

/**
 * A staff page. `roles` narrows it (production is for the chefs and
 * management); left out, every staff role may open it. The server is the wall
 * either way: this only keeps a page from rendering a refusal.
 */
export function staffGate(status: StaffStatus, roles?: readonly StaffRole[]): StaffGateDecision {
  switch (status.kind) {
    case 'none':
    case 'guest':
      return 'redirect-guest';
    case 'pending':
      return 'loading';
    case 'revoked':
      return 'revoked';
    case 'unsupported':
      return 'unsupported';
    case 'staff':
      return roles && !roles.includes(status.staff.role) ? 'redirect-staff-home' : 'allow';
  }
}

export type GuestTabsDecision = 'tabs' | 'loading' | 'redirect-staff';

/**
 * The guest tabs. A staff session never mounts them (or the 3D court under
 * the Book tab): it is sent to Today, which also shows the revoked and
 * update-the-app screens. Every hard-coded `/(tabs)` target lands here, so this
 * one gate catches them all.
 */
export function guestTabsGate(status: StaffStatus): GuestTabsDecision {
  switch (status.kind) {
    case 'none':
    case 'guest':
      return 'tabs';
    case 'pending':
      return 'loading';
    case 'staff':
    case 'revoked':
    case 'unsupported':
      return 'redirect-staff';
  }
}
