import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANSWERS,
  coachLevelOf,
  consistentAnswers,
  genderToSave,
  hasAnswers,
  nextStep,
  parseAgeBand,
  parseWants,
  playProfileOf,
  previousStep,
  rowPatchOf,
  surveyArgs,
  stepIsRequired,
  surveyStepsFor,
  toggleWant,
  withLevel,
  yearsFitLevel,
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
  it('asks the three play questions, then the gender only while it is unset', () => {
    expect(surveyStepsFor({ askGender: false, genderOnly: false })).toEqual(['level', 'years', 'wants']);
    expect(surveyStepsFor({ askGender: true, genderOnly: false })).toEqual([
      'level',
      'years',
      'wants',
      'gender',
    ]);
  });

  it('asks the age band only while the profile has none (0368)', () => {
    expect(surveyStepsFor({ askGender: false, genderOnly: false, askAge: true })).toEqual([
      'level',
      'age',
      'years',
      'wants',
    ]);
    expect(surveyStepsFor({ askGender: true, genderOnly: false, askAge: true })).toEqual([
      'level',
      'age',
      'years',
      'wants',
      'gender',
    ]);
    // The gender-only way in stays one question, whatever the band says.
    expect(surveyStepsFor({ askGender: true, genderOnly: true, askAge: true })).toEqual(['gender']);
  });

  it('takes no Skip on the level, and a Skip on every other step (0368)', () => {
    expect(stepIsRequired('level')).toBe(true);
    for (const step of ['age', 'years', 'wants', 'gender'] as const) {
      expect(stepIsRequired(step), step).toBe(false);
    }
  });

  it('walks level → age → years with the band asked', () => {
    const steps = surveyStepsFor({ askGender: false, genderOnly: false, askAge: true });
    expect(nextStep(steps, 'level')).toBe('age');
    expect(nextStep(steps, 'age')).toBe('years');
    expect(previousStep(steps, 'years')).toBe('age');
  });

  it('asks the gender alone when a match or tournament sends the guest', () => {
    expect(surveyStepsFor({ askGender: false, genderOnly: true })).toEqual(['gender']);
    expect(surveyStepsFor({ askGender: true, genderOnly: true })).toEqual(['gender']);
  });

  it('walks level → years → wants and back', () => {
    const steps = surveyStepsFor({ askGender: false, genderOnly: false });
    expect(nextStep(steps, 'level')).toBe('years');
    expect(nextStep(steps, 'years')).toBe('wants');
    expect(nextStep(steps, 'wants')).toBeNull();
    expect(previousStep(steps, 'wants')).toBe('years');
    expect(previousStep(steps, 'level')).toBeNull();
  });

  it('walks on to the gender when it is asked', () => {
    const steps = surveyStepsFor({ askGender: true, genderOnly: false });
    expect(nextStep(steps, 'wants')).toBe('gender');
    expect(nextStep(steps, 'gender')).toBeNull();
    expect(previousStep(steps, 'gender')).toBe('wants');
  });

  it('has nothing before or after the gender asked alone', () => {
    const steps = surveyStepsFor({ askGender: false, genderOnly: true });
    expect(nextStep(steps, 'gender')).toBeNull();
    expect(previousStep(steps, 'gender')).toBeNull();
    expect(nextStep(steps, 'level')).toBeNull();
  });
});

describe('level and years agree', () => {
  it('"Not yet" fits only Just starting, or no level', () => {
    expect(yearsFitLevel('new', 'never')).toBe(true);
    expect(yearsFitLevel(null, 'never')).toBe(true);
    expect(yearsFitLevel('beginner', 'never')).toBe(false);
    expect(yearsFitLevel('intermediate', 'never')).toBe(false);
    expect(yearsFitLevel('advanced', 'never')).toBe(false);
  });

  it('every other pairing is allowed', () => {
    for (const level of ['new', 'beginner', 'intermediate', 'advanced'] as const) {
      for (const years of ['under_one', 'one_to_three', 'three_plus'] as const) {
        expect(yearsFitLevel(level, years)).toBe(true);
      }
    }
  });

  it('a new level drops a years answer it contradicts, and keeps one that fits', () => {
    const started = { level: 'new' as const, years: 'never' as const, wants: [] };
    expect(withLevel(started, 'advanced')).toEqual({ level: 'advanced', years: null, wants: [] });
    expect(withLevel(started, 'new')).toEqual(started);
    expect(withLevel({ ...started, years: 'three_plus' }, 'advanced')).toEqual({
      level: 'advanced',
      years: 'three_plus',
      wants: [],
    });
  });

  it('a pair saved before the rule loses its years answer', () => {
    expect(consistentAnswers({ level: 'advanced', years: 'never', wants: ['matches'] })).toEqual({
      level: 'advanced',
      years: null,
      wants: ['matches'],
    });
    const fine = { level: 'advanced' as const, years: 'three_plus' as const, wants: [] };
    expect(consistentAnswers(fine)).toBe(fine);
  });
});

describe('genderToSave', () => {
  it('writes a woman or a man, and nothing for no answer', () => {
    expect(genderToSave('female')).toBe('female');
    expect(genderToSave('male')).toBe('male');
    expect(genderToSave(null)).toBeNull();
  });
});

describe('parseAgeBand (0368)', () => {
  it('takes the six bands and nothing else', () => {
    expect(parseAgeBand('u18')).toBe('u18');
    expect(parseAgeBand('55_plus')).toBe('55_plus');
    expect(parseAgeBand('25-34')).toBeNull();
    expect(parseAgeBand('')).toBeNull();
    expect(parseAgeBand(34)).toBeNull();
    expect(parseAgeBand(null)).toBeNull();
    expect(parseAgeBand(undefined)).toBeNull();
  });
});
