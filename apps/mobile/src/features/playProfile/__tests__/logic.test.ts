import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANSWERS,
  coachLevelOf,
  hasAnswers,
  nextStep,
  parseWants,
  playProfileOf,
  previousStep,
  rowPatchOf,
  surveyArgs,
  toggleWant,
} from '../logic';

const AT = '2026-10-11T18:00:00.000Z';

describe('playProfileOf (contracts §4.1)', () => {
  it('reads the four columns', () => {
    expect(
      playProfileOf({
        play_level: 'intermediate',
        play_years: 'one_to_three',
        play_wants: ['lessons', 'matches'],
        play_survey_at: AT,
      }),
    ).toEqual({ level: 'intermediate', years: 'one_to_three', wants: ['matches', 'lessons'], answeredAt: AT });
  });

  it('is not known for a row without the stamp key (cached before 0334) or no row', () => {
    expect(playProfileOf({ id: 'x', full_name: 'A' })).toBeNull();
    expect(playProfileOf(null)).toBeNull();
    expect(playProfileOf(undefined)).toBeNull();
    expect(playProfileOf('nope')).toBeNull();
  });

  it('reads a never-asked account as known with no stamp', () => {
    expect(
      playProfileOf({ play_level: null, play_years: null, play_wants: null, play_survey_at: null }),
    ).toEqual({ level: null, years: null, wants: [], answeredAt: null });
  });

  it('drops values outside the vocabulary rather than guessing', () => {
    expect(
      playProfileOf({
        play_level: 'pro',
        play_years: 5,
        play_wants: ['matches', 'beach', 'matches', 3],
        play_survey_at: 'not a date',
      }),
    ).toEqual({ level: null, years: null, wants: ['matches'], answeredAt: null });
  });

  it('reads the save RPC jsonb the same way', () => {
    expect(
      playProfileOf({ play_level: 'new', play_years: 'never', play_wants: null, play_survey_at: AT })?.level,
    ).toBe('new');
  });
});

describe('answers', () => {
  it('parseWants keeps vocabulary order, once each', () => {
    expect(parseWants(['lessons', 'tournaments', 'lessons'])).toEqual(['tournaments', 'lessons']);
    expect(parseWants('matches')).toEqual([]);
  });

  it('toggleWant adds and removes in vocabulary order', () => {
    expect(toggleWant([], 'lessons')).toEqual(['lessons']);
    expect(toggleWant(['lessons'], 'matches')).toEqual(['matches', 'lessons']);
    expect(toggleWant(['matches', 'lessons'], 'matches')).toEqual(['lessons']);
  });

  it('hasAnswers is true for any one answer', () => {
    expect(hasAnswers(EMPTY_ANSWERS)).toBe(false);
    expect(hasAnswers(null)).toBe(false);
    expect(hasAnswers({ ...EMPTY_ANSWERS, years: 'never' })).toBe(true);
    expect(hasAnswers({ ...EMPTY_ANSWERS, wants: ['matches'] })).toBe(true);
  });

  it('surveyArgs sends a skipped question as null, an empty want list included', () => {
    expect(surveyArgs(EMPTY_ANSWERS)).toEqual({ p_level: null, p_years: null, p_wants: null });
    expect(surveyArgs({ level: 'advanced', years: null, wants: ['tournaments'] })).toEqual({
      p_level: 'advanced',
      p_years: null,
      p_wants: ['tournaments'],
    });
  });

  it('rowPatchOf writes the columns back for the cache', () => {
    expect(rowPatchOf({ level: 'beginner', years: null, wants: [], answeredAt: AT })).toEqual({
      play_level: 'beginner',
      play_years: null,
      play_wants: null,
      play_survey_at: AT,
    });
  });
});

describe('coachLevelOf (§4.2)', () => {
  it('reads new as beginner, unknown as all', () => {
    expect(coachLevelOf('new')).toBe('beginner');
    expect(coachLevelOf('beginner')).toBe('beginner');
    expect(coachLevelOf('intermediate')).toBe('intermediate');
    expect(coachLevelOf('advanced')).toBe('advanced');
    expect(coachLevelOf(null)).toBeNull();
  });
});

describe('steps', () => {
  it('walks level → years → wants and back', () => {
    expect(nextStep('level')).toBe('years');
    expect(nextStep('years')).toBe('wants');
    expect(nextStep('wants')).toBeNull();
    expect(previousStep('wants')).toBe('years');
    expect(previousStep('level')).toBeNull();
  });
});
