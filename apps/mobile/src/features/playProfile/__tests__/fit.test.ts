import { describe, expect, it } from 'vitest';
import { bracketOfYears, classOfLevel, showsTournament, tournamentAvailability, tournamentFit } from '../fit';

const t = (tourClass: 'A' | 'B' | 'C' | null, playYears: 'under_one' | 'one_to_three' | 'three_plus' | null) => ({
  tourClasses: tourClass === null ? [] : [tourClass],
  playYears,
});

describe('who a tournament is for (0339, the twin of tournament_register)', () => {
  it('maps a level to its class: advanced A, intermediate B, beginner and new C', () => {
    expect(classOfLevel('advanced')).toBe('A');
    expect(classOfLevel('intermediate')).toBe('B');
    expect(classOfLevel('beginner')).toBe('C');
    expect(classOfLevel('new')).toBe('C');
  });

  it('counts "Not yet" as under a year', () => {
    expect(bracketOfYears('never')).toBe('under_one');
    expect(bracketOfYears('three_plus')).toBe('three_plus');
  });

  it('fits only the exact class', () => {
    expect(tournamentFit(t('A', null), { level: 'advanced', years: null })).toEqual({ fit: 'fits', on: null });
    expect(tournamentFit(t('A', null), { level: 'intermediate', years: null })).toEqual({
      fit: 'mismatch',
      on: 'level',
    });
    expect(tournamentFit(t('C', null), { level: 'new', years: 'never' }).fit).toBe('fits');
  });

  it('fits any of several classes (0356)', () => {
    const ab = { tourClasses: ['A', 'B'] as const, playYears: null };
    expect(tournamentFit(ab, { level: 'advanced', years: null }).fit).toBe('fits');
    expect(tournamentFit(ab, { level: 'intermediate', years: null }).fit).toBe('fits');
    expect(tournamentFit(ab, { level: 'beginner', years: null })).toEqual({ fit: 'mismatch', on: 'level' });
    expect(tournamentFit(ab, null)).toEqual({ fit: 'unanswered', on: 'level' });
  });

  it('fits only the exact years bracket: more years is a mismatch too', () => {
    const one = t('B', 'one_to_three');
    expect(tournamentFit(one, { level: 'intermediate', years: 'one_to_three' }).fit).toBe('fits');
    expect(tournamentFit(one, { level: 'intermediate', years: 'three_plus' })).toEqual({
      fit: 'mismatch',
      on: 'years',
    });
    expect(tournamentFit(one, { level: 'intermediate', years: 'under_one' }).fit).toBe('mismatch');
    expect(tournamentFit(t('C', 'under_one'), { level: 'new', years: 'never' }).fit).toBe('fits');
  });

  it('a question the tournament asks and the guest skipped is unanswered, level first', () => {
    expect(tournamentFit(t('B', 'one_to_three'), null)).toEqual({ fit: 'unanswered', on: 'level' });
    expect(tournamentFit(t('B', 'one_to_three'), { level: 'intermediate', years: null })).toEqual({
      fit: 'unanswered',
      on: 'years',
    });
    // No bracket: years are never asked.
    expect(tournamentFit(t('B', null), { level: 'intermediate', years: null }).fit).toBe('fits');
  });

  it('a tournament from before 0339 asks nothing', () => {
    expect(tournamentFit(t(null, null), null).fit).toBe('fits');
  });

  it('the Join tab hides a mismatch, keeps the unanswered, and always keeps an entered one', () => {
    const a = { level: 'advanced' as const, years: 'three_plus' as const };
    expect(showsTournament({ ...t('B', null), mine: null }, a)).toBe(false);
    expect(showsTournament({ ...t('B', null), mine: { status: 'registered' } }, a)).toBe(true);
    expect(showsTournament({ ...t('B', null), mine: null }, null)).toBe(true);
    expect(showsTournament({ ...t('A', 'three_plus'), mine: null }, a)).toBe(true);
  });
});

describe('tournamentAvailability (the suggestions behind For you)', () => {
  const row = (format: string, tourClass: 'A' | 'B' | 'C', status = 'open') => ({
    format,
    status,
    tourClasses: [tourClass],
    playYears: null,
    mine: null,
  });

  it('offers a format only while an open tournament of it fits the guest', () => {
    const a = { level: 'advanced' as const, years: 'three_plus' as const };
    expect(tournamentAvailability([row('mexicano', 'A'), row('americano', 'C')], a)).toEqual({
      americano: false,
      mexicano: true,
    });
    expect(tournamentAvailability([row('mexicano', 'A', 'closed')], a)).toEqual({
      americano: false,
      mexicano: false,
    });
  });
});
