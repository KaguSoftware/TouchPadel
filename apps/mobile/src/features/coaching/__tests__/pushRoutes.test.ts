import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LESSON_PUSH_KINDS,
  LESSON_PUSH_ROUTES,
  isLessonPushKind,
  isLessonPushRoute,
  lessonPushHref,
} from '../pushRoutes';
import { isGuestTap, isStaffTap, tapDestination } from '../../profile/pushSync';

/**
 * Coaching push taps (docs/design/coaching/guest.md §4.11). The one catalogue
 * is packages/db/supabase/functions/_shared/guest-push.json; its coaching
 * entries arrived with the 0271 commit (G1). The lists are held to guest.md
 * §4.6.1 and to the JSON's coaching entries, in its order.
 */
const JSON_PATH = join(
  __dirname,
  '../../../../../../packages/db/supabase/functions/_shared/guest-push.json',
);
const catalogue = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as {
  routes: string[];
  kinds: string[];
};

describe('the coaching push lists', () => {
  it('are guest.md §4.6.1’s', () => {
    expect([...LESSON_PUSH_ROUTES]).toEqual(['lesson', 'coach_lesson', 'coach_statements']);
    expect([...LESSON_PUSH_KINDS]).toEqual(['lesson_update', 'lesson_reminder', 'coach_update']);
  });

  it('equal the JSON’s coaching entries, in its order', () => {
    expect(catalogue.routes.filter((r) => isLessonPushRoute(r))).toEqual([...LESSON_PUSH_ROUTES]);
    expect(catalogue.kinds.filter((k) => isLessonPushKind(k))).toEqual([...LESSON_PUSH_KINDS]);
  });

  it('know their routes and kinds by exact spelling only', () => {
    expect(isLessonPushRoute('lesson')).toBe(true);
    expect(isLessonPushRoute('match')).toBe(false);
    expect(isLessonPushRoute('/lesson')).toBe(false);
    expect(isLessonPushKind('coach_update')).toBe(true);
    expect(isLessonPushKind('match_update')).toBe(false);
    expect(isLessonPushKind(undefined)).toBe(false);
  });
});

describe('lessonPushHref', () => {
  it('opens the enrolment, the roster or the statements; the tabs when an id is missing', () => {
    expect(lessonPushHref('lesson', 'e-1')).toEqual({
      pathname: '/lesson/[id]',
      params: { id: 'e-1' },
    });
    expect(lessonPushHref('lesson', null)).toEqual({ pathname: '/(tabs)' });
    expect(lessonPushHref('coach_lesson', 'l-1')).toEqual({
      pathname: '/coach-mode-lesson',
      params: { id: 'l-1' },
    });
    expect(lessonPushHref('coach_lesson', '')).toEqual({ pathname: '/(tabs)' });
    expect(lessonPushHref('coach_statements', null)).toEqual({
      pathname: '/coach-mode-statements',
    });
  });
});

describe('tapDestination with coaching routes', () => {
  const statuses = ['none', 'pending', 'guest', 'staff', 'revoked', 'unsupported'] as const;

  it('opens a lesson, a roster or the statements whatever the staff status (C-27)', () => {
    for (const status of statuses) {
      expect(
        tapDestination({ kind: 'lesson_update', route: 'lesson', id: 'e-1' }, status),
        status,
      ).toEqual({
        kind: 'lesson',
        id: 'e-1',
      });
      expect(
        tapDestination({ kind: 'coach_update', route: 'coach_lesson', id: 'l-1' }, status),
        status,
      ).toEqual({
        kind: 'coachLesson',
        id: 'l-1',
      });
      expect(
        tapDestination({ kind: 'coach_update', route: 'coach_statements', id: 's-1' }, status),
        status,
      ).toEqual({
        kind: 'coachStatements',
      });
    }
  });

  it('opens nothing for a coaching push that needs an id and names none, and never a match', () => {
    expect(tapDestination({ kind: 'lesson_reminder', route: 'lesson' }, 'guest')).toBeNull();
    expect(tapDestination({ kind: 'coach_update', route: 'coach_lesson' }, 'staff')).toBeNull();
  });

  it('is a guest tap, never a staff one', () => {
    expect(isGuestTap({ route: 'lesson' })).toBe(true);
    expect(isGuestTap({ route: 'coach_statements' })).toBe(true);
    expect(isStaffTap({ route: 'coach_lesson' })).toBe(false);
  });

  it('leaves the match and booking taps as they were', () => {
    expect(tapDestination({ kind: 'match_update', route: 'match', id: 'm-1' }, 'guest')).toEqual({
      kind: 'match',
      id: 'm-1',
    });
    expect(tapDestination({ kind: 'match_update', route: 'tickets' }, 'staff')).toEqual({
      kind: 'tickets',
    });
    expect(tapDestination({ kind: 'booking_confirmed', reservation_id: 'r-1' }, 'guest')).toEqual({
      kind: 'reservation',
      id: 'r-1',
    });
  });
});
