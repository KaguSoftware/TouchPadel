import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMatchToken, matchShareUrl, normaliseIncomingPath, shareHost } from '../links';
import { redirectSystemPath } from '../../../../app/+native-intent';

/**
 * Links in and out of an open match (docs/design/open-matches/guest.md §4.18,
 * §4.19): every spelling of an invite folds onto `/m/<token>`, everything else
 * passes through, and the share links' host is the one every build claims.
 */
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';

describe('normaliseIncomingPath', () => {
  it.each([
    [`/m/${TOKEN}`, `/m/${TOKEN}`],
    [`/en/m/${TOKEN}`, `/m/${TOKEN}`],
    [`/ar/m/${TOKEN}`, `/m/${TOKEN}`],
    [`https://www.touch-padel.com/m/${TOKEN}`, `/m/${TOKEN}`],
    [`https://www.touch-padel.com/ar/m/${TOKEN}`, `/m/${TOKEN}`],
    [`https://www.touch-padel.com/en/m/${TOKEN}?utm=wa`, `/m/${TOKEN}?utm=wa`],
    [`touchpadel://m/${TOKEN}`, `/m/${TOKEN}`],
    [`touchpadel:///m/${TOKEN}`, `/m/${TOKEN}`],
    [`m/${TOKEN}`, `/m/${TOKEN}`],
  ])('folds %s onto the one route', (from, to) => {
    expect(normaliseIncomingPath(from)).toBe(to);
  });

  it.each([
    'touchpadel://pay/return?ref=abc',
    '/pay/return?ref=abc',
    'touchpadel://auth/callback?code=xyz',
    'https://www.touch-padel.com/auth/callback?code=xyz',
    '/en/auth/callback?code=xyz&next=/m/abc',
    '/matches',
    '/match/123',
    '/match-new?venueId=v',
    '/',
    '',
  ])('leaves %s untouched', (path) => {
    expect(normaliseIncomingPath(path)).toBe(path);
  });

  it('does not judge the token: m/[token] shows the closed layout for a bad one', () => {
    expect(normaliseIncomingPath('/ar/m/short')).toBe('/m/short');
  });

  it('is what +native-intent hands the router', () => {
    expect(redirectSystemPath({ path: `/en/m/${TOKEN}`, initial: true })).toBe(`/m/${TOKEN}`);
    expect(redirectSystemPath({ path: 'touchpadel://pay/return?ref=r', initial: false })).toBe(
      'touchpadel://pay/return?ref=r',
    );
  });
});

describe('isMatchToken', () => {
  it('takes 22 url-safe characters and nothing else', () => {
    expect(isMatchToken(TOKEN)).toBe(true);
    expect(isMatchToken(TOKEN.slice(1))).toBe(false);
    expect(isMatchToken(`${TOKEN}x`)).toBe(false);
    expect(isMatchToken('AbCdEfGhIjKlMnOpQrSt.x')).toBe(false);
    expect(isMatchToken('AbCdEfGhIjKlMnOpQrSt/x')).toBe(false);
    expect(isMatchToken(undefined)).toBe(false);
  });
});

describe('the share link (§4.14, §4.19)', () => {
  it('is the site’s /m/<token>', () => {
    expect(matchShareUrl(TOKEN)).toBe(`https://www.touch-padel.com/m/${TOKEN}`);
  });

  it('uses the host every eas.json profile claims as EXPO_PUBLIC_LINK_DOMAIN', () => {
    const eas = JSON.parse(readFileSync(join(__dirname, '../../../../eas.json'), 'utf8')) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    const profiles = ['development', 'staging', 'production'];
    for (const p of profiles) {
      expect(eas.build[p]?.env?.EXPO_PUBLIC_LINK_DOMAIN, p).toBe('www.touch-padel.com');
    }
    expect(shareHost()).toBe('www.touch-padel.com');
  });
});
