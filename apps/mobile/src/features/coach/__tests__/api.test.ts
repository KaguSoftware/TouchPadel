import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import {
  COACH_RPCS,
  addMyTimeOff,
  coachAddStudent,
  coachBookPrivate,
  coachCreateCourse,
  coachMarkAttendance,
  fetchCoachMe,
  fetchMyCoachStatements,
  setMyCoachHours,
} from '../api';
import { coachMeRaw } from '../../../test/coachFixtures';

/**
 * The call shapes of coach mode (build contracts §1.6): each function names
 * its RPC on the `app` schema with the arguments the server takes, and throws
 * a refusal as it came. A stub client records the calls.
 */
function stub(answer: { data?: unknown; error?: unknown } = {}) {
  const calls: { schema: string; fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    schema(name: string) {
      return {
        rpc(fn: string, args: Record<string, unknown>) {
          calls.push({ schema: name, fn, args });
          return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('coach mode’s calls', () => {
  it('names only RPCs coach mode may call', () => {
    expect(new Set(COACH_RPCS).size).toBe(COACH_RPCS.length);
    expect(COACH_RPCS).toContain('coach_accept_public');
  });

  it('reads coach_me and parses it', async () => {
    const { client, calls } = stub({ data: coachMeRaw() });
    const me = await fetchCoachMe(client);
    expect(calls).toEqual([{ schema: 'app', fn: 'coach_me', args: {} }]);
    expect(me.coach?.status).toBe('active');
  });

  it('asks for the summaries without a month, and one month with p_month', async () => {
    const { client, calls } = stub({ data: { months: [], statements: [], current_month: [] } });
    await fetchMyCoachStatements(client, null);
    await fetchMyCoachStatements(client, '2026-09-01');
    expect(calls.map((c) => c.args)).toEqual([{}, { p_month: '2026-09-01' }]);
  });

  it('sends a branch’s whole set of windows', async () => {
    const { client, calls } = stub();
    await setMyCoachHours(client, 'v', [{ weekday: 1, start: '09:00', end: '24:00' }]);
    expect(calls[0]).toEqual({
      schema: 'app',
      fn: 'set_my_coach_hours',
      args: {
        p_venue_id: 'v',
        p_windows: [
          { weekday: 1, start: '09:00', end: '24:00', start_time: '09:00', end_time: '24:00' },
        ],
      },
    });
  });

  it('sends an empty time-off reason as an empty string, never NULL', async () => {
    const { client, calls } = stub();
    await addMyTimeOff(client, { startsAt: 'a', endsAt: 'b', reason: '   ' });
    expect(calls[0]!.args).toEqual({ p_starts_at: 'a', p_ends_at: 'b', p_reason: '' });
  });

  it('books a private lesson for a student, keyed, with a NULL phone when there is none', async () => {
    const { client, calls } = stub({
      data: { lesson_id: 'l', enrolment_id: 'e', duplicate: false },
    });
    const r = await coachBookPrivate(client, {
      typeId: 't',
      venueId: 'v',
      startAt: 's',
      name: 'Ali',
      phone: null,
      partySize: 2,
      idempotencyKey: 'k',
    });
    expect(calls[0]!.args).toEqual({
      p_lesson_type_id: 't',
      p_venue_id: 'v',
      p_start_at: 's',
      p_student_name: 'Ali',
      p_student_phone: null,
      p_party_size: 2,
      p_idempotency_key: 'k',
    });
    expect(r).toEqual({ lessonId: 'l', enrolmentId: 'e', duplicate: false });
  });

  it('adds a student to a course with p_lesson_id NULL (exactly one target)', async () => {
    const { client, calls } = stub({
      data: { enrolment_id: 'e', places_left: 3, duplicate: false },
    });
    await coachAddStudent(client, {
      lessonId: null,
      courseId: 'c',
      name: 'Ali',
      phone: '+9647700000000',
      idempotencyKey: 'k',
    });
    expect(calls[0]!.args).toEqual({
      p_lesson_id: null,
      p_course_id: 'c',
      p_name: 'Ali',
      p_phone: '+9647700000000',
      p_idempotency_key: 'k',
    });
  });

  it('creates a course with its starts and trimmed titles', async () => {
    const { client, calls } = stub({ data: { course_id: 'c', lesson_ids: ['l1'] } });
    const r = await coachCreateCourse(client, {
      typeId: 't',
      venueId: 'v',
      starts: ['a', 'b'],
      titleEn: ' Spring ',
      titleAr: '',
      idempotencyKey: 'k',
    });
    expect(calls[0]!.args).toMatchObject({
      p_starts: ['a', 'b'],
      p_title_en: 'Spring',
      p_title_ar: '',
    });
    expect(r.lessonIds).toEqual(['l1']);
  });

  it('marks attendance, clear included', async () => {
    const { client, calls } = stub();
    await coachMarkAttendance(client, { lessonId: 'l', enrolmentId: 'e', status: 'clear' });
    expect(calls[0]!.args).toEqual({ p_lesson_id: 'l', p_enrolment_id: 'e', p_status: 'clear' });
  });

  it('throws a refusal as it came', async () => {
    const refusal = { code: 'P0001', message: 'COACH_BUSY', details: '' };
    const { client } = stub({ error: refusal });
    await expect(fetchCoachMe(client)).rejects.toBe(refusal);
  });
});
