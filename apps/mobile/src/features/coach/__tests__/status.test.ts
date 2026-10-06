import { describe, expect, it } from 'vitest';
import { parseCoachMe } from '../logic';
import {
  NOT_A_COACH,
  NO_SESSION,
  PENDING,
  READ_ERROR,
  coachModeEntry,
  coachOf,
  nextCoachStatus,
  type CoachStatus,
} from '../status';
import { coachMeRaw, coachMeRetiredRaw } from '../../../test/coachFixtures';

/**
 * docs/design/coaching/guest.md §4.13.1: the coach status, from the session's
 * uid and the coach_me read only. No staff input and no coaching-switch input
 * (R45): a staff member who coaches and a coach at a branch switched off read
 * coach_me like anyone else.
 */
const UID = 'u-1';
const OTHER = 'u-2';
const coach = parseCoachMe(coachMeRaw());
const retired = parseCoachMe(coachMeRetiredRaw());
const guest = parseCoachMe({ coach: null, server_now: '2026-10-01T10:00:00Z' });

const success = (data: ReturnType<typeof parseCoachMe>) => ({ state: 'success' as const, data });
const next = (
  read: Parameters<typeof nextCoachStatus>[0]['read'],
  previous: CoachStatus = NO_SESSION,
  previousUid: string | null = null,
  uid: string | null = UID,
) => nextCoachStatus({ uid, restoring: false, read, previous, previousUid });

describe('nextCoachStatus', () => {
  it('is pending with no uid while the session is restored, and none once it is not (MB-03)', () => {
    const base = {
      uid: null,
      read: { state: 'idle' } as const,
      previous: NO_SESSION,
      previousUid: null,
    };
    expect(nextCoachStatus({ ...base, restoring: true })).toEqual(PENDING);
    expect(nextCoachStatus({ ...base, restoring: false })).toEqual(NO_SESSION);
    // Restoring never hides an answer once the uid is known.
    expect(nextCoachStatus({ ...base, uid: UID, restoring: true, read: success(coach) }).kind).toBe(
      'coach',
    );
  });

  it('is none with no session, whatever the read says', () => {
    expect(next(success(coach), NO_SESSION, null, null)).toEqual(NO_SESSION);
    expect(next({ state: 'error' }, NO_SESSION, null, null)).toEqual(NO_SESSION);
  });

  it('is pending while nobody has asked or the read is in flight, with no answer yet', () => {
    expect(next({ state: 'idle' })).toEqual(PENDING);
    expect(next({ state: 'pending' })).toEqual(PENDING);
  });

  it('answers guest for coach: null, coach for an active or paused coach, retired for a retired one', () => {
    expect(next(success(guest))).toEqual(NOT_A_COACH);
    const c = next(success(coach));
    expect(c.kind).toBe('coach');
    const paused = next(success(parseCoachMe(coachMeRaw({ status: 'paused' }))));
    expect(paused.kind).toBe('coach');
    expect(coachOf(paused)?.status).toBe('paused');
    expect(next(success(retired)).kind).toBe('retired');
  });

  it('is error when the read fails with no earlier answer', () => {
    expect(next({ state: 'error' })).toEqual(READ_ERROR);
  });

  it('keeps a coach or retired answer when a later read fails (a dropped connection keeps the coach in)', () => {
    const c = next(success(coach));
    expect(next({ state: 'error' }, c, UID)).toBe(c);
    const r = next(success(retired));
    expect(next({ state: 'error' }, r, UID)).toBe(r);
  });

  it('keeps the answer while a refetch is in flight or no reader is mounted', () => {
    const c = next(success(coach));
    expect(next({ state: 'pending' }, c, UID)).toBe(c);
    expect(next({ state: 'idle' }, c, UID)).toBe(c);
  });

  it('takes an earlier answer as evidence only for the same uid', () => {
    const c = next(success(coach));
    expect(next({ state: 'pending' }, c, OTHER)).toEqual(PENDING);
    expect(next({ state: 'error' }, c, OTHER)).toEqual(READ_ERROR);
  });

  it('never keeps pending or error as an answer', () => {
    expect(next({ state: 'error' }, PENDING, UID)).toEqual(READ_ERROR);
    expect(next({ state: 'pending' }, READ_ERROR, UID)).toEqual(PENDING);
  });
});

describe('coachModeEntry (C-25, C-27)', () => {
  it('opens coach mode for a coach, the statements for a retired coach, and nothing for anyone else', () => {
    expect(coachModeEntry(next(success(coach)))).toBe('/coach-mode');
    expect(coachModeEntry(next(success(retired)))).toBe('/coach-mode-statements');
    for (const s of [NO_SESSION, PENDING, NOT_A_COACH, READ_ERROR])
      expect(coachModeEntry(s)).toBeNull();
  });
});
