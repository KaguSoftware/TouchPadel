import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_PUSH_ROUTES, STAFF_TITLE_KEY_PAGES, isStaffPushRoute, staffPushHref, titleKeyHref } from '../pushRoutes';
import { isStaffPage } from '../access';
import { tapDestination } from '../../profile/pushSync';

/**
 * Staff push taps (build-contracts-2026-09-23 §2.21, §6.8 item 8). The routes
 * the phone opens are the one list in
 * packages/db/supabase/functions/_shared/staff-push.json, which send-push and
 * app.notify_staff read too; this compares the phone's copy with it.
 */
const JSON_PATH = join(__dirname, '../../../../../../packages/db/supabase/functions/_shared/staff-push.json');
const catalogue = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { routes: string[] };

describe('STAFF_PUSH_ROUTES', () => {
  it('equals _shared/staff-push.json `routes`, in its order', () => {
    expect([...STAFF_PUSH_ROUTES]).toEqual(catalogue.routes);
  });

  it('opens each route on its own root-stack screen', () => {
    for (const route of STAFF_PUSH_ROUTES) {
      expect(staffPushHref(route, 'x').pathname, route).toBe(`/${route}`);
    }
  });
});

describe('staffPushHref (§6.8 mapping)', () => {
  it('puts the id under the param each screen reads', () => {
    expect(staffPushHref('staff', 'ignored')).toEqual({ pathname: '/staff' });
    expect(staffPushHref('staff-step', 'rs-1')).toEqual({ pathname: '/staff-step', params: { id: 'rs-1' } });
    expect(staffPushHref('staff-run', 'r-1')).toEqual({ pathname: '/staff-run', params: { id: 'r-1' } });
    expect(staffPushHref('staff-request', 'q-1')).toEqual({ pathname: '/staff-request', params: { id: 'q-1' } });
    expect(staffPushHref('staff-shopping', null)).toEqual({ pathname: '/staff-shopping' });
    expect(staffPushHref('staff-checklist', 'c-1')).toEqual({ pathname: '/staff-checklist', params: { id: 'c-1' } });
    expect(staffPushHref('staff-notes', 'i-1')).toEqual({ pathname: '/staff-notes', params: { itemId: 'i-1' } });
    expect(staffPushHref('staff-rewards', null)).toEqual({ pathname: '/staff-rewards' });
    expect(staffPushHref('staff-rewards', 'ignored')).toEqual({ pathname: '/staff-rewards' });
  });

  it('opens Today instead of an empty page when a route that needs an id came without one', () => {
    for (const route of ['staff-step', 'staff-run', 'staff-checklist', 'staff-notes'] as const) {
      expect(staffPushHref(route, null), route).toEqual({ pathname: '/staff' });
    }
    expect(staffPushHref('staff-request', undefined)).toEqual({ pathname: '/staff-request' });
  });

  it('knows its routes by exact spelling only', () => {
    expect(isStaffPushRoute('staff-step')).toBe(true);
    expect(isStaffPushRoute('staff-till')).toBe(false);
    expect(isStaffPushRoute('/staff-step')).toBe(false);
    expect(isStaffPushRoute(undefined)).toBe(false);
  });
});

describe('tapDestination with the staff status', () => {
  const stepTap = { kind: 'staff_task', route: 'staff-step', id: 'rs-1' };

  it('opens a staff route only while the phone is signed in as staff', () => {
    expect(tapDestination(stepTap, 'staff')).toEqual({
      kind: 'staff',
      href: { pathname: '/staff-step', params: { id: 'rs-1' } },
    });
    for (const status of ['guest', 'none', 'pending', 'revoked', 'unsupported'] as const) {
      expect(tapDestination(stepTap, status), status).toBeNull();
    }
  });

  it('opens nothing for a route this build does not list', () => {
    expect(tapDestination({ kind: 'staff_task', route: 'staff-till', id: 'x' }, 'staff')).toBeNull();
    expect(tapDestination({ kind: 'staff_task', route: 42 }, 'staff')).toBeNull();
  });

  it('opens a booking exactly as before, whatever the status', () => {
    const booking = { kind: 'booking_reminder', reservation_id: 'res-1' };
    expect(tapDestination(booking, 'guest')).toEqual({ kind: 'reservation', id: 'res-1' });
    expect(tapDestination(booking, 'staff')).toEqual({ kind: 'reservation', id: 'res-1' });
    expect(tapDestination({ kind: 'test' }, 'guest')).toBeNull();
  });

  it('still answers the booking half alone when called with the data only', () => {
    expect(tapDestination({ reservation_id: 'res-1' })).toBe('res-1');
    expect(tapDestination(stepTap)).toBeNull();
  });
});

describe('a push about one thing opens its page (F-59)', () => {
  const titleKeys = (JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { title_keys: string[] }).title_keys;

  it('maps only title keys the catalogue knows', () => {
    for (const key of Object.keys(STAFF_TITLE_KEY_PAGES)) expect(titleKeys, key).toContain(key);
  });

  it('opens the page of a route-`staff` push by its title key', () => {
    expect(staffPushHref('staff', null, 'deduction_recorded')).toEqual({ pathname: '/staff-deductions' });
    expect(staffPushHref('staff', null, 'marketing_request_new')).toEqual({ pathname: '/staff-marketing-requests' });
    expect(staffPushHref('staff', 'x', 'recipe_change_approved')).toEqual({ pathname: '/staff-recipe-change' });
    expect(staffPushHref('staff', null, 'incident_reported')).toEqual({ pathname: '/staff-incidents' });
    expect(staffPushHref('staff', null, 'content_changes')).toEqual({ pathname: '/staff-content' });
    expect(staffPushHref('staff', null, 'waiter_call_new')).toEqual({ pathname: '/staff-calls' });
    expect(staffPushHref('staff', null, 'idea_started')).toEqual({ pathname: '/staff-ideas' });
    expect(staffPushHref('staff', null, 'teaching_new')).toEqual({ pathname: '/staff-teachings' });
    expect(staffPushHref('staff', null, 'screenshot_taken')).toEqual({ pathname: '/staff-screenshots' });
  });

  it('keeps Today for an operator matter, an unknown key, or no key at all', () => {
    expect(staffPushHref('staff', null, 'shop_price_changed')).toEqual({ pathname: '/staff' });
    expect(staffPushHref('staff', null, 'nope')).toEqual({ pathname: '/staff' });
    expect(staffPushHref('staff', null)).toEqual({ pathname: '/staff' });
    expect(titleKeyHref(42)).toBeNull();
  });

  it('opens a checklist push without an id on the work alerts list, not Today', () => {
    expect(staffPushHref('staff-checklist', null, 'checklist_due')).toEqual({ pathname: '/staff-work' });
    expect(staffPushHref('staff-checklist', 'c-1', 'checklist_due')).toEqual({ pathname: '/staff-checklist', params: { id: 'c-1' } });
  });

  it('opens every mapped page as a real staff screen', () => {
    for (const page of new Set(Object.values(STAFF_TITLE_KEY_PAGES))) {
      expect(isStaffPage(page), page).toBe(true);
    }
  });

  it('reads the title key from a tapped push', () => {
    expect(tapDestination({ kind: 'staff_decided', route: 'staff', title_key: 'deduction_approved' }, 'staff')).toEqual({
      kind: 'staff',
      href: { pathname: '/staff-deductions' },
    });
  });
});
