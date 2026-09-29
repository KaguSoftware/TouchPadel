import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GUEST_PUSH_KINDS,
  GUEST_PUSH_ROUTES,
  guestPushHref,
  isGuestPushKind,
  isGuestPushRoute,
} from '../pushRoutes';
import { isGuestTap, isStaffTap, tapDestination } from '../../profile/pushSync';

/**
 * Open-match push taps (docs/design/open-matches/guest.md §4.21). The routes
 * and kinds the phone knows are the one catalogue in
 * packages/db/supabase/functions/_shared/guest-push.json, which send-push and
 * app.match_notify read too; this compares the phone's copies with it, and
 * holds the tap routing: a guest route opens whatever the staff status, and
 * the staff routes are unchanged.
 */
const JSON_PATH = join(__dirname, '../../../../../../packages/db/supabase/functions/_shared/guest-push.json');
const catalogue = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { routes: string[]; kinds: string[] };

describe('the guest push catalogue', () => {
  it('routes equal _shared/guest-push.json `routes`, in its order', () => {
    expect([...GUEST_PUSH_ROUTES]).toEqual(catalogue.routes);
  });

  it('kinds equal _shared/guest-push.json `kinds`, in its order', () => {
    expect([...GUEST_PUSH_KINDS]).toEqual(catalogue.kinds);
  });

  it('knows its routes and kinds by exact spelling only', () => {
    expect(isGuestPushRoute('match')).toBe(true);
    expect(isGuestPushRoute('/match')).toBe(false);
    expect(isGuestPushRoute('staff')).toBe(false);
    expect(isGuestPushKind('match_update')).toBe(true);
    expect(isGuestPushKind('booking_confirmed')).toBe(false);
    expect(isGuestPushKind(undefined)).toBe(false);
  });
});

describe('guestPushHref', () => {
  it('opens the match with an id, the tabs without one, and the wallet for tickets', () => {
    expect(guestPushHref('match', 'm-1')).toEqual({ pathname: '/match/[id]', params: { id: 'm-1' } });
    expect(guestPushHref('match', null)).toEqual({ pathname: '/(tabs)' });
    expect(guestPushHref('tickets', null)).toEqual({ pathname: '/tickets' });
  });
});

describe('tapDestination with guest routes', () => {
  const statuses = ['none', 'pending', 'guest', 'staff', 'revoked', 'unsupported'] as const;

  it('opens a match push whatever the staff status', () => {
    for (const status of statuses) {
      expect(tapDestination({ kind: 'match_update', route: 'match', id: 'm-1' }, status), status).toEqual({
        kind: 'match',
        id: 'm-1',
      });
    }
  });

  it('opens the wallet for a refund push', () => {
    expect(tapDestination({ kind: 'match_update', route: 'tickets', id: null }, 'guest')).toEqual({ kind: 'tickets' });
  });

  it('opens nothing for a match push that names no match', () => {
    expect(tapDestination({ kind: 'match_update', route: 'match' }, 'guest')).toBeNull();
  });

  it('is never a staff tap, so it never waits on the staff status', () => {
    expect(isGuestTap({ route: 'match' })).toBe(true);
    expect(isStaffTap({ route: 'match' })).toBe(false);
    expect(isStaffTap({ route: 'tickets' })).toBe(false);
  });

  it('leaves the staff and booking taps as they were', () => {
    expect(isStaffTap({ route: 'staff-step', id: 'x' })).toBe(true);
    expect(isGuestTap({ route: 'staff-step' })).toBe(false);
    expect(tapDestination({ route: 'staff-step', id: 'rs-1' }, 'staff')).toEqual({
      kind: 'staff',
      href: { pathname: '/staff-step', params: { id: 'rs-1' } },
    });
    expect(tapDestination({ route: 'staff-step', id: 'rs-1' }, 'guest')).toBeNull();
    expect(tapDestination({ kind: 'booking_confirmed', reservation_id: 'r-1' }, 'guest')).toEqual({
      kind: 'reservation',
      id: 'r-1',
    });
    expect(tapDestination({ kind: 'booking_confirmed', reservation_id: 'r-1' })).toBe('r-1');
  });
});
