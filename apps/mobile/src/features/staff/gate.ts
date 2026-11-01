/**
 * Route-gate decisions for the staff area, as pure functions (vitest), in the
 * shape of src/features/auth/gate.ts. RequireStaff and GuestTabsGate render
 * what these answer (build-contracts-2026-09-23 §6.5).
 */
import { rolesOf, type StaffRole } from '@touch/core';
import type { StaffStatus } from './status';
import { pageBlocked, type StaffPage } from './access';

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
 * management); left out, every staff role may open it. `page` names the
 * screen, and a page the owner blocked for this person (0345, F-16; see
 * access.ts) sends them back to Today like a role it is not for, whichever
 * way they came: a row, a push or a deep link. The server is the wall
 * either way: this only keeps a page from rendering a refusal.
 */
export function staffGate(
  status: StaffStatus,
  roles?: readonly StaffRole[],
  page?: StaffPage,
): StaffGateDecision {
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
      // 0345: a second job opens its pages too, as the server's is_staff does.
      if (roles && !rolesOf(status.staff).some((r) => roles.includes(r))) return 'redirect-staff-home';
      // 0345 blocked pages: always blocked, no exceptions (F-16).
      if (page && pageBlocked(page, status.staff)) return 'redirect-staff-home';
      return 'allow';
  }
}

export type GuestTabsDecision = 'tabs' | 'loading' | 'redirect-staff';

/**
 * The guest tabs. A staff session never mounts them (or the 3D court under
 * the Book tab) unless it asked to see the guest view: it is sent to Today, which also shows the revoked and
 * update-the-app screens. Every hard-coded `/(tabs)` target lands here, so this
 * one gate catches them all.
 */
export function guestTabsGate(status: StaffStatus, guestPreview = false): GuestTabsDecision {
  switch (status.kind) {
    case 'none':
    case 'guest':
      return 'tabs';
    case 'pending':
      return 'loading';
    case 'staff':
      // "Show guest view" (guestPreview.ts): an active staff account may look.
      return guestPreview ? 'tabs' : 'redirect-staff';
    case 'revoked':
    case 'unsupported':
      return 'redirect-staff';
  }
}
