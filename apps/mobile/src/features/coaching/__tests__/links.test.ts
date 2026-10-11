import { describe, expect, it } from 'vitest';
import { COACH_ID_RE, coachShareUrl, isCoachId, isCoachSlug, normaliseCoachLink } from '../links';
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
    ['https://www.touch-padel.com/en/c/omar-karim', '/coach/omar-karim'],
    ['touchpadel://c/omar-karim', '/coach/omar-karim'],
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

describe('the coach slug (0336)', () => {
  it('is a share link name, never an id', () => {
    expect(isCoachSlug('omar-karim')).toBe(true);
    expect(isCoachSlug('Omar-Karim-2')).toBe(true);
    expect(isCoachSlug('-omar')).toBe(false);
    expect(isCoachSlug('o')).toBe(false);
    expect(isCoachSlug('omar karim')).toBe(false);
    expect(isCoachSlug(ID)).toBe(false);
    expect(isCoachSlug(undefined)).toBe(false);
  });
});

describe('coachShareUrl', () => {
  const COACH = { id: ID, slug: 'omar-karim' };

  it('is the website’s /<locale>/c/<slug> on the host every build claims', () => {
    const url = coachShareUrl(COACH, 'en');
    expect(new URL(url).pathname).toBe('/en/c/omar-karim');
    expect(new URL(url).host).toBe(shareHost());
    expect(new URL(coachShareUrl(COACH, 'ar')).pathname).toBe('/ar/c/omar-karim');
  });

  it('falls back to the id when the server sent no slug', () => {
    expect(new URL(coachShareUrl({ id: ID, slug: null }, 'en')).pathname).toBe(`/en/c/${ID}`);
  });

  it('opens back in the app on the coach route', () => {
    expect(normaliseCoachLink(coachShareUrl(COACH, 'ar'))).toBe('/coach/omar-karim');
  });
});
