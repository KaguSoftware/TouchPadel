import { describe, expect, it } from 'vitest';
import { EMPTY_ANSWERS, type PlayAnswers } from '../logic';
import { SUGGESTION_KINDS, suggest, topSuggestions } from '../suggest';
import { suggestionTarget } from '../links';
import { onlinePaymentsOn } from '../../../test/onlinePayments';

onlinePaymentsOn();

const a = (over: Partial<PlayAnswers>): PlayAnswers => ({ ...EMPTY_ANSWERS, ...over });
const kinds = (answers: PlayAnswers | null) => suggest(answers).map((s) => s.kind);

describe('suggest (contracts §8)', () => {
  it('never hides anything: every kind, every time', () => {
    for (const answers of [null, EMPTY_ANSWERS, a({ level: 'advanced', years: 'three_plus', wants: ['matches'] })]) {
      expect([...kinds(answers)].sort()).toEqual([...SUGGESTION_KINDS].sort());
    }
  });

  it('with no answers keeps the default order, a general reason and no score', () => {
    const out = suggest(null);
    expect(out.map((s) => s.kind)).toEqual([...SUGGESTION_KINDS]);
    expect(out.every((s) => s.reason === 'general' && s.score === 0)).toBe(true);
    expect(topSuggestions(EMPTY_ANSWERS, 3)).toEqual([]);
  });

  it('puts coaches and group sessions first for someone new', () => {
    expect(kinds(a({ level: 'new' })).slice(0, 2)).toEqual(['coaches', 'classes']);
    expect(kinds(a({ level: 'beginner' })).slice(0, 2)).toEqual(['coaches', 'classes']);
    expect(kinds(a({ years: 'never' })).slice(0, 2)).toEqual(['coaches', 'classes']);
    expect(suggest(a({ level: 'new' }))[0]?.reason).toBe('starting');
  });

  it('puts open matches and Americano first for an intermediate', () => {
    expect(kinds(a({ level: 'intermediate' })).slice(0, 2)).toEqual(['matches', 'americano']);
    expect(suggest(a({ level: 'intermediate' }))[0]?.reason).toBe('intermediate');
  });

  it('puts Mexicano and open matches first for an advanced or long-time player', () => {
    // A tie at 3 keeps the default order: open matches, then Mexicano.
    expect(kinds(a({ level: 'advanced' })).slice(0, 2)).toEqual(['matches', 'mexicano']);
    expect(kinds(a({ level: 'advanced', years: 'three_plus' }))[0]).toBe('mexicano');
    expect(kinds(a({ years: 'three_plus' }))[0]).toBe('mexicano');
    expect(suggest(a({ years: 'three_plus' }))[0]?.reason).toBe('seasoned');
  });

  it('lets wants reorder within the level, and says so', () => {
    const plain = kinds(a({ level: 'intermediate' }));
    const lessons = suggest(a({ level: 'intermediate', wants: ['lessons'] }));
    expect(lessons.findIndex((s) => s.kind === 'classes')).toBeLessThan(plain.indexOf('classes'));
    // ...but the level still leads.
    expect(lessons.slice(0, 3).map((s) => s.kind)).toEqual(['matches', 'americano', 'coaches']);
    // The want outweighs the level's mild point for coaches, so it is the reason given.
    expect(lessons.find((s) => s.kind === 'coaches')?.reason).toBe('wantsLessons');
    expect(lessons.find((s) => s.kind === 'matches')?.reason).toBe('intermediate');

    const tournaments = suggest(a({ level: 'beginner', wants: ['tournaments'] }));
    expect(tournaments.slice(0, 2).map((s) => s.kind)).toEqual(['coaches', 'classes']);
    expect(tournaments.find((s) => s.kind === 'mexicano')?.reason).toBe('wantsTournaments');
    // A want alone still orders.
    expect(kinds(a({ wants: ['tournaments'] })).slice(0, 2)).toEqual(['americano', 'mexicano']);
  });

  it('sinks what is not on offer below everything that is, without dropping it', () => {
    const out = suggest(a({ level: 'advanced' }), { mexicano: false });
    expect(out[out.length - 1]).toMatchObject({ kind: 'mexicano', available: false });
    expect(out).toHaveLength(SUGGESTION_KINDS.length);
    expect(topSuggestions(a({ level: 'advanced' }), 3, { mexicano: false }).map((s) => s.kind)).not.toContain(
      'mexicano',
    );
  });

  it('topSuggestions shows tournaments only to a guest after Tournaments', () => {
    // Advanced ranks Mexicano first, but they asked for matches and lessons.
    const top = topSuggestions(a({ level: 'advanced', years: 'three_plus', wants: ['matches', 'lessons'] }), 5);
    expect(top.map((s) => s.kind)).not.toContain('mexicano');
    expect(top.map((s) => s.kind)).not.toContain('americano');
    expect(top[0]?.kind).toBe('matches');
    expect(
      topSuggestions(a({ level: 'advanced', wants: ['tournaments'] }), 5).map((s) => s.kind),
    ).toContain('mexicano');
  });

  it('topSuggestions shows coaches only after Lessons, and group sessions either way', () => {
    const top = topSuggestions(a({ level: 'new', wants: ['matches'] }), 5).map((s) => s.kind);
    expect(top).not.toContain('coaches');
    expect(top).toContain('classes');
    expect(topSuggestions(a({ level: 'new', wants: ['lessons'] }), 2).map((s) => s.kind)).toEqual([
      'coaches',
      'classes',
    ]);
  });

  it('topSuggestions offers group sessions alone while no want is answered', () => {
    expect(topSuggestions(a({ level: 'advanced' }), 3).map((s) => s.kind)).toEqual(['classes']);
    // Even where the level gives them no points.
    expect(topSuggestions(a({ level: 'intermediate', years: 'three_plus' }), 3).map((s) => s.kind)).toEqual([
      'classes',
    ]);
    // Not on offer: nothing, never something else instead.
    expect(topSuggestions(a({ level: 'new' }), 3, { classes: false })).toEqual([]);
  });

  it('topSuggestions cuts to the ones the answers point at', () => {
    expect(topSuggestions(a({ level: 'new', wants: ['lessons'] }), 2).map((s) => s.kind)).toEqual([
      'coaches',
      'classes',
    ]);
    expect(topSuggestions(a({ wants: ['matches'] }), 3).map((s) => s.kind)).toEqual(['matches']);
    expect(topSuggestions(a({ level: 'intermediate' }), 0)).toEqual([]);
  });
});

describe('suggestionTarget', () => {
  it('opens the tabs the contract names', () => {
    expect(suggestionTarget('coaches')).toEqual({ kind: 'tab', href: { pathname: '/coaches' } });
    expect(suggestionTarget('matches')).toEqual({
      kind: 'tab',
      href: { pathname: '/play', params: { show: 'matches' } },
    });
    expect(suggestionTarget('americano').href).toEqual({ pathname: '/play', params: { show: 'tournaments' } });
    expect(suggestionTarget('mexicano').href).toEqual({ pathname: '/play', params: { show: 'tournaments' } });
    expect(suggestionTarget('classes')).toEqual({ kind: 'push', href: { pathname: '/classes' } });
  });
});
