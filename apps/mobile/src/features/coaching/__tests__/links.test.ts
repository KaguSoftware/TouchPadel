import { describe, expect, it } from 'vitest';
import { COACH_ID_RE, coachShareUrl, isCoachId, normaliseCoachLink } from '../links';
import { normaliseIncomingPath, shareHost } from '../../matches/links';
import { redirectSystemPath } from '../../../../app/+native-intent';

const ID = '5c0ac000-0000-4000-8000-000000000001';

describe('normaliseCoachLink (§4.12)', () => {
  it.each([
    [`/c/${ID}`, `/coach/${ID}`],
    [`/en/c/${ID}`, `/coach/${ID}`],
    [`/ar/c/${ID}`, `/coach/${ID}`],
    [`c/${ID}`, `/coach/${ID}`],
    [`https://www.touch-padel.com/c/${ID}`, `/coach/${ID}`],
    [`https://www.touch-padel.com/ar/c/${ID}?utm=x#top`, `/coach/${ID}?utm=x#top`],
    [`touchpadel://c/${ID}`, `/coach/${ID}`],
    [`touchpadel:///en/c/${ID}`, `/coach/${ID}`],
  ])('%s → %s', (input, expected) => {
    expect(normaliseCoachLink(input)).toBe(expected);
  });

  it('leaves everything else to the next fold', () => {
    for (const path of [
      'https://www.touch-padel.com/club',
      '/club',
      '/m/abcdefghijklmnopqrstuv',
      '/auth/callback?code=1',
      '/pay/return?ref=1',
      '/coaching',
      '',
    ]) {
      expect(normaliseCoachLink(path), path).toBeNull();
    }
  });

  it('the native intent folds a coach link first, then the match fold, else the path as it came', () => {
    expect(redirectSystemPath({ path: `/en/c/${ID}`, initial: true })).toBe(`/coach/${ID}`);
    expect(redirectSystemPath({ path: '/m/abcdefghijklmnopqrstuv', initial: true })).toBe(
      normaliseIncomingPath('/m/abcdefghijklmnopqrstuv'),
    );
    expect(redirectSystemPath({ path: '/pay/return?ref=1', initial: false })).toBe(
      '/pay/return?ref=1',
    );
  });
});

describe('the coach id', () => {
  it('is a uuid', () => {
    expect(isCoachId(ID)).toBe(true);
    expect(isCoachId('abc')).toBe(false);
    expect(isCoachId(undefined)).toBe(false);
    expect(COACH_ID_RE.test(ID.toUpperCase())).toBe(true);
  });
});

describe('coachShareUrl', () => {
  it('is the website’s /<locale>/c/<id> on the host every build claims', () => {
    const url = coachShareUrl(ID, 'en');
    expect(new URL(url).pathname).toBe(`/en/c/${ID}`);
    expect(new URL(url).host).toBe(shareHost());
    expect(new URL(coachShareUrl(ID, 'ar')).pathname).toBe(`/ar/c/${ID}`);
  });

  it('opens back in the app on the coach route', () => {
    expect(normaliseCoachLink(coachShareUrl(ID, 'ar'))).toBe(`/coach/${ID}`);
  });
});
