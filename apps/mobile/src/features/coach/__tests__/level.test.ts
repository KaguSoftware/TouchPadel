import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import {
  LEVEL_NOTE_MAX,
  cleanLevelNote,
  levelArgs,
  levelIssue,
  levelRole,
  parseLevelSetResult,
  parseStudentLevel,
  startingLevel,
} from '../level';
import { parseCoachLesson } from '../logic';
import { coachSetStudentLevel } from '../api';
import { coachLessonRaw, ENROLMENT_ID, ENROLMENT_2_ID } from '../../../test/coachFixtures';

/**
 * A linked student's level in coach mode (Majed, 2026-11-01, F-70; 0401): read from the roster
 * place, never a profile id, and set with coach_set_student_level keyed on the place.
 */
const LEVEL = { claimed: 'beginner', confirmed: 'intermediate', confirmed_role: 'coach', confirmed_at: '2026-10-31T10:00:00Z', note: 'Good at the net' };

describe('parseStudentLevel', () => {
  it('reads a linked place\'s level', () => {
    expect(parseStudentLevel(LEVEL)).toEqual({
      claimed: 'beginner',
      confirmed: 'intermediate',
      confirmedRole: 'coach',
      confirmedAt: '2026-10-31T10:00:00Z',
      note: 'Good at the net',
    });
  });

  it('is null for a place with no confirmed link, and keeps only known levels', () => {
    expect(parseStudentLevel(null)).toBeNull();
    expect(parseStudentLevel(undefined)).toBeNull();
    expect(parseStudentLevel([])).toBeNull();
    expect(parseStudentLevel({ claimed: 'pro', confirmed: null })).toMatchObject({ claimed: null, confirmed: null });
  });

  it('rides on the roster: only the linked place carries one', () => {
    const raw = coachLessonRaw();
    raw.roster[0] = { ...raw.roster[0]!, level: null } as never;
    raw.roster[1] = { ...raw.roster[1]!, level: LEVEL } as never;
    const lesson = parseCoachLesson(raw)!;
    expect(lesson.roster.find((r) => r.enrolmentId === ENROLMENT_ID)?.level).toBeNull();
    expect(lesson.roster.find((r) => r.enrolmentId === ENROLMENT_2_ID)?.level?.confirmed).toBe('intermediate');
  });
});

describe('the level form', () => {
  it('starts on the confirmed level, else what the player said', () => {
    expect(startingLevel(parseStudentLevel(LEVEL)!)).toBe('intermediate');
    expect(startingLevel(parseStudentLevel({ claimed: 'new' })!)).toBe('new');
    expect(startingLevel(parseStudentLevel({})!)).toBeNull();
  });

  it('needs a level, and a note of at most 120 characters', () => {
    expect(levelIssue(null, '')).toBe('NO_LEVEL');
    expect(levelIssue('advanced', '')).toBeNull();
    expect(levelIssue('advanced', 'x'.repeat(LEVEL_NOTE_MAX))).toBeNull();
    expect(levelIssue('advanced', 'x'.repeat(LEVEL_NOTE_MAX + 1))).toBe('NOTE_TOO_LONG');
  });

  it('sends one trimmed line, and no note when clearing', () => {
    expect(cleanLevelNote('  plays  well \n at the net ')).toBe('plays well at the net');
    expect(cleanLevelNote('   ')).toBeNull();
    expect(levelArgs('e-1', 'advanced', ' fast ')).toEqual({ p_enrolment_id: 'e-1', p_level: 'advanced', p_note: 'fast' });
    expect(levelArgs('e-1', null, 'ignored')).toEqual({ p_enrolment_id: 'e-1', p_level: null, p_note: null });
  });

  it('names only the roles the copy has words for', () => {
    expect(levelRole('coach')).toBe('coach');
    expect(levelRole('court_desk')).toBe('court_desk');
    expect(levelRole('someone')).toBeNull();
    expect(levelRole(null)).toBeNull();
  });
});

describe('coach_set_student_level', () => {
  it('calls the RPC on the place and reads its answer', async () => {
    const calls: { schema: string; fn: string; args: unknown }[] = [];
    const client = {
      schema: (schema: string) => ({
        rpc: (fn: string, args: unknown) => {
          calls.push({ schema, fn, args });
          return Promise.resolve({
            data: { enrolment_id: 'e-1', level_confirmed: 'advanced', level_confirmed_at: 'x', level_confirmed_role: 'coach', level_note: 'fast', duplicate: false },
            error: null,
          });
        },
      }),
    } as unknown as SupabaseClient<Database>;
    const out = await coachSetStudentLevel(client, { enrolmentId: 'e-1', level: 'advanced', note: 'fast' });
    expect(calls).toEqual([
      { schema: 'app', fn: 'coach_set_student_level', args: { p_enrolment_id: 'e-1', p_level: 'advanced', p_note: 'fast' } },
    ]);
    expect(out).toEqual({ enrolmentId: 'e-1', confirmed: 'advanced', confirmedAt: 'x', confirmedRole: 'coach', note: 'fast', duplicate: false });
  });

  it('throws a refusal as it came (LEVEL_NOT_LINKED)', async () => {
    const client = {
      schema: () => ({ rpc: () => Promise.resolve({ data: null, error: { message: 'LEVEL_NOT_LINKED', code: 'P0001' } }) }),
    } as unknown as SupabaseClient<Database>;
    await expect(coachSetStudentLevel(client, { enrolmentId: 'e-1', level: 'new', note: '' })).rejects.toMatchObject({ message: 'LEVEL_NOT_LINKED' });
  });

  it('reads a duplicate answer', () => {
    expect(parseLevelSetResult({ enrolment_id: 'e', duplicate: true }).duplicate).toBe(true);
    expect(parseLevelSetResult(null).enrolmentId).toBe('');
  });
});
