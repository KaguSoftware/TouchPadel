import { describe, expect, it } from 'vitest';
import type { MatchSettings } from '../../matches/matchPayloads';
import { CHAIN_FIELDS, draftFromMatchSettings, matchSettingsErrors, matchSettingsPatch, serverFieldOf } from './matchSettingsLogic';

const SAVED: MatchSettings = {
  venue_id: 'v1',
  matches_enabled: false,
  match_fill_deadline_minutes: 120,
  earliest_start_minutes: 180,
  match_ticket_price_iqd: 10000,
  max_filling_matches_per_guest: 3,
};

describe('draftFromMatchSettings', () => {
  it('reads the stored rules into the form, a missing figure as an empty field', () => {
    expect(draftFromMatchSettings(SAVED)).toEqual({ enabled: false, deadlineMinutes: '120', priceIqd: '10000', maxFilling: '3' });
    expect(draftFromMatchSettings({ ...SAVED, match_ticket_price_iqd: null }).priceIqd).toBe('');
  });
});

describe('matchSettingsErrors', () => {
  const ok = draftFromMatchSettings(SAVED);

  it('accepts the stored rules', () => {
    expect(matchSettingsErrors(ok)).toEqual({});
  });

  it('checks each field against 0257’s bounds', () => {
    expect(matchSettingsErrors({ ...ok, deadlineMinutes: '59' })).toEqual({ deadlineMinutes: 'range' });
    expect(matchSettingsErrors({ ...ok, deadlineMinutes: '2881' })).toEqual({ deadlineMinutes: 'range' });
    expect(matchSettingsErrors({ ...ok, priceIqd: '750' })).toEqual({ priceIqd: 'range' });
    expect(matchSettingsErrors({ ...ok, priceIqd: '1000250' })).toEqual({ priceIqd: 'range' });
    expect(matchSettingsErrors({ ...ok, maxFilling: '0' })).toEqual({ maxFilling: 'range' });
    expect(matchSettingsErrors({ ...ok, maxFilling: '11' })).toEqual({ maxFilling: 'range' });
  });

  it('wants whole numbers, and a price in steps of 250', () => {
    expect(matchSettingsErrors({ ...ok, deadlineMinutes: '' })).toEqual({ deadlineMinutes: 'wholeNumber' });
    expect(matchSettingsErrors({ ...ok, priceIqd: '10100' })).toEqual({ priceIqd: 'step' });
    expect(matchSettingsErrors({ ...ok, priceIqd: '10250' })).toEqual({});
  });
});

describe('matchSettingsPatch', () => {
  it('sends only the keys that changed, in the server’s names', () => {
    expect(matchSettingsPatch(SAVED, draftFromMatchSettings(SAVED))).toEqual({});
    expect(matchSettingsPatch(SAVED, { enabled: true, deadlineMinutes: '180', priceIqd: '10000', maxFilling: '3' })).toEqual({
      matches_enabled: true,
      match_fill_deadline_minutes: 180,
    });
    expect(matchSettingsPatch(SAVED, { enabled: false, deadlineMinutes: '120', priceIqd: ' 12500 ', maxFilling: '5' })).toEqual({
      match_ticket_price_iqd: 12500,
      max_filling_matches_per_guest: 5,
    });
  });
});

describe('serverFieldOf', () => {
  it('places an INVALID_ARGUMENT detail on its field', () => {
    expect(serverFieldOf('match_ticket_price_iqd')).toBe('priceIqd');
    expect(serverFieldOf('matches_enabled')).toBe('enabled');
    expect(serverFieldOf('p_patch')).toBeNull();
    expect(serverFieldOf(undefined)).toBeNull();
  });

  it('knows which rules apply to every branch', () => {
    expect(CHAIN_FIELDS).toEqual(['priceIqd', 'maxFilling']);
  });
});
