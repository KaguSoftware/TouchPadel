import { describe, expect, it } from 'vitest';
import { ERROR_CODE_KEYS, makeT } from '@touch/i18n';
import { TOURNAMENT_GUEST_KEYS, tournamentErrorText, tournamentRefusalOf } from '../errors';
import { mapErrorToKey } from '../../booking/errors';

/**
 * Tournament refusals on the phone (plan §5.2; build contracts §1.9). A refusal arrives as
 * PostgREST hands it over: the code as the message, the detail in `details`.
 */
const t = makeT('en');
const refusal = (code: string, details?: string) => ({ message: code, details });

describe('tournamentErrorText', () => {
  it('reads TOURNAMENT_NOT_OPEN’s detail as its own sentence', () => {
    expect(tournamentErrorText(refusal('TOURNAMENT_NOT_OPEN', 'cutoff'), t)).toBe(
      t('tournaments.guest.errors.notOpenCutoff'),
    );
    expect(tournamentErrorText(refusal('TOURNAMENT_NOT_OPEN', 'status'), t)).toBe(
      t('tournaments.guest.errors.notOpenStatus'),
    );
    expect(tournamentErrorText(refusal('TOURNAMENT_NOT_OPEN', 'surprise'), t)).toBe(
      t('tournaments.guest.errors.notOpenStatus'),
    );
  });

  it('reads a withdraw past the cut-off as its own sentence: the desk can still take the guest off', () => {
    const cutoff = refusal('TOURNAMENT_NOT_OPEN', 'cutoff');
    expect(tournamentErrorText(cutoff, t, { action: 'withdraw' })).toBe(
      t('tournaments.guest.errors.withdrawCutoff'),
    );
    expect(t('tournaments.guest.errors.withdrawCutoff')).not.toBe(
      t('tournaments.guest.errors.notOpenCutoff'),
    );
    expect(tournamentErrorText(cutoff, t, { action: 'register' })).toBe(
      t('tournaments.guest.errors.notOpenCutoff'),
    );
    // Any other detail of a withdraw keeps the shared sentence.
    expect(
      tournamentErrorText(refusal('TOURNAMENT_NOT_OPEN', 'status'), t, { action: 'withdraw' }),
    ).toBe(t('tournaments.guest.errors.notOpenStatus'));
    const ar = makeT('ar');
    expect(tournamentErrorText(cutoff, ar, { action: 'withdraw' })).toBe(
      ar('tournaments.guest.errors.withdrawCutoff'),
    );
  });

  it('gives each guest-facing code a guest’s sentence', () => {
    for (const [code, key] of Object.entries(TOURNAMENT_GUEST_KEYS)) {
      expect(tournamentErrorText(refusal(code), t), code).toBe(t(key));
    }
  });

  it('every code it words is in the one catalogue (§1.9)', () => {
    for (const code of Object.keys(TOURNAMENT_GUEST_KEYS)) {
      expect(ERROR_CODE_KEYS, code).toHaveProperty(code);
    }
  });

  it('falls back to the catalogue for the eligibility codes, and reads "update the app" for current terms', () => {
    expect(tournamentErrorText(refusal('MATCH_BANNED'), t)).toBe(
      t(mapErrorToKey(refusal('MATCH_BANNED'))),
    );
    expect(mapErrorToKey(refusal('MATCH_BANNED'))).not.toBe('errors.generic');
    expect(tournamentErrorText(refusal('TERMS_REQUIRED'), t)).toBe(
      t('matches.errors.termsRequired'),
    );
    expect(tournamentErrorText(refusal('TERMS_REQUIRED'), t, { termsCurrent: true })).toBe(
      t('matches.errors.updateApp'),
    );
  });

  it('reads Arabic in Arabic', () => {
    const ar = makeT('ar');
    expect(tournamentErrorText(refusal('TOURNAMENT_FULL'), ar)).toBe(
      ar('tournaments.guest.errors.full'),
    );
  });
});

describe('tournamentRefusalOf', () => {
  it('sends the eligibility refusals the open-match way', () => {
    expect(tournamentRefusalOf('TERMS_REQUIRED')).toBe('terms');
    expect(tournamentRefusalOf('PHONE_REQUIRED')).toBe('phone');
    expect(tournamentRefusalOf('GENDER_REQUIRED')).toBe('gender');
    expect(tournamentRefusalOf('MATCH_BANNED')).toBe('banned');
  });

  it('reads the detail again when the tournament moved on', () => {
    for (const code of [
      'TOURNAMENTS_OFF',
      'TOURNAMENT_NOT_FOUND',
      'TOURNAMENT_NOT_OPEN',
      'TOURNAMENT_FULL',
      'TOURNAMENT_ENTRY_NOT_FOUND',
    ]) {
      expect(tournamentRefusalOf(code), code).toBe('refetch');
    }
  });

  it('shows anything else inline', () => {
    expect(tournamentRefusalOf('TOURNAMENT_CATEGORY_MISMATCH')).toBe('inline');
    expect(tournamentRefusalOf(null)).toBe('inline');
  });
});
