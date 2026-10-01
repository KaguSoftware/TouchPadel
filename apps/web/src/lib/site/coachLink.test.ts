import { describe, expect, it } from 'vitest';
import {
  APP_COACH_URL,
  APP_HOME_URL,
  appCoachHref,
  coachLinkPath,
  parseCoachId,
} from './coachLink';

/** The coach link's pure half (docs/design/coaching/guest.md §4.12, §4.14.3). */
const ID = '3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b';

describe('parseCoachId', () => {
  it('takes a uuid, lower-cased', () => {
    expect(parseCoachId(ID)).toBe(ID);
    expect(parseCoachId(ID.toUpperCase())).toBe(ID);
    expect(parseCoachId([ID, 'other'])).toBe(ID);
  });

  it.each([
    ['nothing', undefined],
    ['empty', ''],
    ['too short', ID.slice(1)],
    ['too long', `${ID}0`],
    ['no dashes', ID.replace(/-/g, '')],
    ['36 dashes and hex in the wrong places', '------------------------------------'],
    ['a match token', 'Ab3_-x9ZqT0kLm2NpQr7sU'],
    ['dotted', `${ID.slice(0, 35)}.`],
    ['markup', '"><script>alert(1)</script>'],
  ])('refuses %s', (_, raw) => {
    expect(parseCoachId(raw)).toBeNull();
  });
});

describe('links', () => {
  it('opens the app on the coach, or on its home without one', () => {
    expect(APP_COACH_URL).toBe('touchpadel://c');
    expect(appCoachHref(ID)).toBe(`touchpadel://c/${ID}`);
    expect(appCoachHref(null)).toBe(APP_HOME_URL);
    expect(APP_HOME_URL).toBe('touchpadel://');
  });

  it('keeps the coach across a language switch; an id that is none goes to the coaches', () => {
    expect(coachLinkPath('ar', ID)).toBe(`/ar/c/${ID}`);
    expect(coachLinkPath('en', ID)).toBe(`/en/c/${ID}`);
    expect(coachLinkPath('en', null)).toBe('/en/coaching');
  });
});
