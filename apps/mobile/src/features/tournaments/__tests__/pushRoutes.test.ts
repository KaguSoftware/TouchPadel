import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT_PUSH_KINDS,
  TOURNAMENT_PUSH_ROUTES,
  isTournamentPushKind,
  isTournamentPushRoute,
  tournamentPushHref,
} from '../pushRoutes';
import { GUEST_PUSH_KINDS, GUEST_PUSH_ROUTES } from '../../matches/pushRoutes';
import { isGuestTap, isStaffTap, tapDestination } from '../../profile/pushSync';

/**
 * Tournament push taps (build contracts §1.10, S12). The one catalogue is
 * packages/db/supabase/functions/_shared/guest-push.json; its tournament entries arrive with the
 * database lane's commit (S12), so the JSON comparison here goes green at the integration merge.
 */
const JSON_PATH = join(
  __dirname,
  '../../../../../../packages/db/supabase/functions/_shared/guest-push.json',
);
const catalogue = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as {
  routes: string[];
  kinds: string[];
};

describe('the tournament push lists', () => {
  it('are §1.10’s', () => {
    expect([...TOURNAMENT_PUSH_ROUTES]).toEqual(['tournament']);
    expect([...TOURNAMENT_PUSH_KINDS]).toEqual(['tournament_update']);
  });

  it('equal the JSON’s tournament entries, appended last', () => {
    expect(catalogue.routes.filter((r) => isTournamentPushRoute(r))).toEqual([
      ...TOURNAMENT_PUSH_ROUTES,
    ]);
    expect(catalogue.kinds.filter((k) => isTournamentPushKind(k))).toEqual([
      ...TOURNAMENT_PUSH_KINDS,
    ]);
    expect(catalogue.routes.at(-1)).toBe('tournament');
    expect(catalogue.kinds.at(-1)).toBe('tournament_update');
  });

  it('are spread last into the guest lists', () => {
    expect(GUEST_PUSH_ROUTES.at(-1)).toBe('tournament');
    expect(GUEST_PUSH_KINDS.at(-1)).toBe('tournament_update');
  });

  it('know their route and kind by exact spelling only', () => {
    expect(isTournamentPushRoute('tournament')).toBe(true);
    expect(isTournamentPushRoute('tournaments')).toBe(false);
    expect(isTournamentPushKind('tournament_update')).toBe(true);
    expect(isTournamentPushKind('lesson_update')).toBe(false);
    expect(isTournamentPushKind(undefined)).toBe(false);
  });
});

describe('tournamentPushHref', () => {
  it('opens the tournament with an id, the list without one', () => {
    expect(tournamentPushHref('t-1')).toEqual({
      pathname: '/tournament/[id]',
      params: { id: 't-1' },
    });
    expect(tournamentPushHref(null)).toEqual({ pathname: '/tournaments' });
  });
});

describe('tapDestination with the tournament route', () => {
  const statuses = ['none', 'pending', 'guest', 'staff', 'revoked', 'unsupported'] as const;

  it('opens the tournament whatever the staff status', () => {
    for (const status of statuses) {
      expect(
        tapDestination({ kind: 'tournament_update', route: 'tournament', id: 't-1' }, status),
        status,
      ).toEqual({ kind: 'tournament', id: 't-1' });
    }
  });

  it('opens nothing for a tournament push that names none', () => {
    expect(tapDestination({ kind: 'tournament_update', route: 'tournament' }, 'guest')).toBeNull();
  });

  it('is a guest tap, never a staff one', () => {
    expect(isGuestTap({ route: 'tournament' })).toBe(true);
    expect(isStaffTap({ route: 'tournament' })).toBe(false);
  });
});
