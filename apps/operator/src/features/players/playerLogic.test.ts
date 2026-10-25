/**
 * Who a player is, the pure half (0368; customers contracts §1, §5): the
 * record's block read defensively, the queue's rows, and the dialog's draft.
 */
import { describe, expect, it } from 'vitest';
import {
  agreesWithGames,
  draftDirty,
  draftErrors,
  draftOf,
  NOTE_MAX,
  parseLevelReviews,
  parsePlayerFacts,
  reviewChoices,
  saveSteps,
} from './playerLogic';

const player = {
  age_band: '25_34',
  claimed_level: 'advanced',
  play_years: 'three_plus',
  play_wants: ['matches', 'lessons'],
  level_confirmed: 'intermediate',
  level_confirmed_at: '2026-10-20T10:00:00.000Z',
  level_confirmed_role: 'court_desk',
  level_confirmed_by_name: 'Dana',
  level_note: 'Strong serve',
  effective_level: 'intermediate',
  suggested: { level: 'beginner', games: 7, wins: 1, losses: 6, score: 1.2 },
  // Out of order, with one tag this build has never heard of.
  interests: ['cafe', 'courts', 'nonsense', 'ranked'],
};

describe('parsePlayerFacts', () => {
  it('reads the claim, the judgment, the suggestion and the tags', () => {
    const f = parsePlayerFacts({ player })!;
    expect(f.ageBand).toBe('25_34');
    expect(f.claimedLevel).toBe('advanced');
    expect(f.confirmedLevel).toBe('intermediate');
    expect(f.confirmedRole).toBe('court_desk');
    expect(f.confirmedByName).toBe('Dana');
    expect(f.note).toBe('Strong serve');
    expect(f.effectiveLevel).toBe('intermediate');
    expect(f.suggested).toEqual({ level: 'beginner', games: 7, wins: 1, losses: 6, score: 1.2 });
    // The server's order, nothing unknown.
    expect(f.interests).toEqual(['courts', 'cafe', 'ranked']);
  });

  it('answers null for a server without 0368, so no card is drawn', () => {
    expect(parsePlayerFacts({ customer: { id: 'x' } })).toBeNull();
    expect(parsePlayerFacts(null)).toBeNull();
  });

  it('reads a player who answered nothing', () => {
    const f = parsePlayerFacts({ player: {} })!;
    expect(f.ageBand).toBeNull();
    expect(f.claimedLevel).toBeNull();
    expect(f.confirmedLevel).toBeNull();
    expect(f.effectiveLevel).toBeNull();
    expect(f.suggested).toBeNull();
    expect(f.interests).toEqual([]);
  });

  it('drops a level, band or role it does not know', () => {
    const f = parsePlayerFacts({
      player: { age_band: '30s', claimed_level: 'pro', level_confirmed_role: 'barista', suggested: { level: 'pro', games: 9 } },
    })!;
    expect(f.ageBand).toBeNull();
    expect(f.claimedLevel).toBeNull();
    expect(f.confirmedRole).toBeNull();
    expect(f.suggested).toBeNull();
  });

  it('says whether the record already agrees with the games', () => {
    expect(agreesWithGames(parsePlayerFacts({ player })!)).toBe(false);
    expect(
      agreesWithGames(parsePlayerFacts({ player: { ...player, effective_level: 'beginner' } })!),
    ).toBe(true);
    expect(agreesWithGames(parsePlayerFacts({ player: { ...player, suggested: null } })!)).toBe(false);
  });
});

describe('parseLevelReviews', () => {
  const rows = [
    {
      profile_id: 'f1f70000-0000-4000-8000-0000000000aa',
      full_name: 'Hal',
      claimed: 'advanced',
      confirmed: null,
      suggested: 'beginner',
      games: 5,
      wins: 0,
      losses: 5,
      score: 0.5,
      last_played_at: '2026-10-21T18:00:00.000Z',
    },
    // No suggestion: not a review at all.
    { profile_id: 'x', full_name: 'Nobody', suggested: null, games: 9 },
    // No id: unusable.
    { full_name: 'Ghost', suggested: 'beginner' },
  ];

  it('keeps only the rows that can be acted on', () => {
    const parsed = parseLevelReviews(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ fullName: 'Hal', claimed: 'advanced', suggested: 'beginner', games: 5 });
  });

  it('survives a server without the queue', () => {
    expect(parseLevelReviews(null)).toEqual([]);
    expect(parseLevelReviews({})).toEqual([]);
  });

  it('offers the suggestion and the claim, and only the suggestion with no claim', () => {
    const [row] = parseLevelReviews(rows);
    expect(reviewChoices(row!)).toEqual({ confirm: 'beginner', keep: 'advanced' });
    const noClaim = parseLevelReviews([{ ...rows[0], claimed: null }])[0]!;
    expect(reviewChoices(noClaim)).toEqual({ confirm: 'beginner', keep: null });
  });
});

describe('the dialog’s draft', () => {
  const facts = parsePlayerFacts({ player })!;

  it('starts from what is on record', () => {
    expect(draftOf(facts)).toEqual({ band: '25_34', level: 'intermediate', note: 'Strong serve' });
    expect(draftOf(null)).toEqual({ band: null, level: null, note: '' });
  });

  it('is dirty only on a real change, whitespace aside', () => {
    expect(draftDirty(draftOf(facts), facts)).toBe(false);
    expect(draftDirty({ ...draftOf(facts), note: '  Strong   serve ' }, facts)).toBe(false);
    expect(draftDirty({ ...draftOf(facts), level: 'advanced' }, facts)).toBe(true);
    expect(draftDirty({ ...draftOf(facts), band: '35_44' }, facts)).toBe(true);
  });

  it('refuses a note with no level, and one over the line', () => {
    expect(draftErrors({ band: null, level: null, note: 'plays well' })).toEqual({ note: 'noLevel' });
    expect(draftErrors({ band: null, level: 'beginner', note: 'x'.repeat(NOTE_MAX + 1) })).toEqual({ note: 'long' });
    expect(draftErrors({ band: null, level: 'beginner', note: 'fine' })).toEqual({});
    // Clearing the judgment with no note is the way to undo one.
    expect(draftErrors({ band: '25_34', level: null, note: '' })).toEqual({});
  });

  it('sends only what changed', () => {
    expect(saveSteps(draftOf(facts), facts)).toEqual({ band: 'keep', level: 'keep' });
    expect(saveSteps({ ...draftOf(facts), band: '45_54' }, facts)).toEqual({ band: '45_54', level: 'keep' });
    expect(saveSteps({ band: '25_34', level: 'advanced', note: 'Moves well' }, facts)).toEqual({
      band: 'keep',
      level: { level: 'advanced', note: 'Moves well' },
    });
    // Clearing: the note goes with the level.
    expect(saveSteps({ band: '25_34', level: null, note: '' }, facts)).toEqual({
      band: 'keep',
      level: { level: null, note: null },
    });
    // A player with nothing on record: the band alone.
    expect(saveSteps({ band: 'u18', level: null, note: '' }, null)).toEqual({ band: 'u18', level: 'keep' });
  });
});
