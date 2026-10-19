import { afterEach, describe, expect, it } from 'vitest';
import {
  BOOT_SETTLE_MS,
  CALM_MS,
  NEW_ACCOUNT_WINDOW_MS,
  __resetSurveyShown,
  calmDelayMs,
  isNewAccount,
  isTabPath,
  markSurveyShown,
  shouldOpenSurvey,
  surveyShownThisSession,
  type SurveyPromptInput,
} from '../prompt';

const NOW = Date.parse('2026-10-11T18:00:00.000Z');
const JUST_NOW = new Date(NOW - 5 * 60 * 1000).toISOString();

const base: SurveyPromptInput = {
  hasSession: true,
  isAnonymous: false,
  staffAnswered: true,
  staff: false,
  accountCreatedAt: JUST_NOW,
  now: NOW,
  answeredAt: null,
  pendingIntent: false,
  pathname: '/',
  shownThisSession: false,
};

afterEach(() => __resetSurveyShown());

describe('shouldOpenSurvey (contracts §8)', () => {
  it('opens for a new account that landed on a tab and was never asked', () => {
    expect(shouldOpenSurvey(base)).toBe(true);
    for (const pathname of ['/bookings', '/play', '/club', '/coaches']) {
      expect(shouldOpenSurvey({ ...base, pathname })).toBe(true);
    }
  });

  it('never opens while a slot, match or lesson intent is pending', () => {
    expect(shouldOpenSurvey({ ...base, pendingIntent: true })).toBe(false);
  });

  it('never opens for staff, or before the staff row has answered', () => {
    expect(shouldOpenSurvey({ ...base, staff: true })).toBe(false);
    expect(shouldOpenSurvey({ ...base, staffAnswered: false })).toBe(false);
  });

  it('never opens signed out or for an anonymous cafe session', () => {
    expect(shouldOpenSurvey({ ...base, hasSession: false })).toBe(false);
    expect(shouldOpenSurvey({ ...base, isAnonymous: true })).toBe(false);
  });

  it('never asks twice: answered, skipped, or already shown this session', () => {
    expect(shouldOpenSurvey({ ...base, answeredAt: '2026-10-11T17:00:00.000Z' })).toBe(false);
    expect(shouldOpenSurvey({ ...base, shownThisSession: true })).toBe(false);
  });

  it('waits while the profile is not known', () => {
    expect(shouldOpenSurvey({ ...base, answeredAt: undefined })).toBe(false);
  });

  it('waits off the tabs: auth screens, complete-profile, Review, a match', () => {
    for (const pathname of ['/profile', '/complete-profile', '/sign-up', '/verify-otp', '/review', '/match/1', '/accept-terms', null]) {
      expect(shouldOpenSurvey({ ...base, pathname })).toBe(false);
    }
  });

  it('leaves accounts from before the window alone', () => {
    const old = new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1000).toISOString();
    expect(shouldOpenSurvey({ ...base, accountCreatedAt: old })).toBe(false);
    expect(shouldOpenSurvey({ ...base, accountCreatedAt: undefined })).toBe(false);
  });
});

describe('helpers', () => {
  it('isNewAccount', () => {
    expect(isNewAccount(JUST_NOW, NOW)).toBe(true);
    expect(isNewAccount(new Date(NOW - 6 * 24 * 3600 * 1000).toISOString(), NOW)).toBe(true);
    expect(isNewAccount('garbage', NOW)).toBe(false);
    expect(isNewAccount(new Date(NOW + 3 * 3600 * 1000).toISOString(), NOW)).toBe(false);
  });

  it('isTabPath', () => {
    expect(isTabPath('/')).toBe(true);
    expect(isTabPath('/play-survey')).toBe(false);
  });

  it('calmDelayMs waits out the boot cover on a cold start, then just the calm', () => {
    expect(calmDelayMs(1000, 0)).toBe(BOOT_SETTLE_MS - 1000);
    expect(calmDelayMs(60_000, 0)).toBe(CALM_MS);
  });

  it('remembers per account, for this session', () => {
    expect(surveyShownThisSession('a')).toBe(false);
    markSurveyShown('a');
    expect(surveyShownThisSession('a')).toBe(true);
    expect(surveyShownThisSession('b')).toBe(false);
  });
});
