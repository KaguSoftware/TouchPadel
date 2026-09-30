import { describe, expect, it } from 'vitest';
import { ar } from '../catalogs/ar';

/**
 * The house spells the brand «تتش» in Arabic («تتش بادل» everywhere the app,
 * the site and the legal pages name it). A second spelling reaches players side
 * by side: the open-match share text leaves the app on WhatsApp.
 */
const leaves = (obj: object, prefix = ''): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v as object, `${prefix}${k}.`),
  );

describe('the Arabic brand name', () => {
  it('is spelled تتش in every Arabic string', () => {
    const misspelt = leaves(ar)
      .filter(([, v]) => v.includes('تاتش'))
      .map(([k]) => k);
    expect(misspelt).toEqual([]);
  });

  it('is in the match share text and the request line', () => {
    expect(ar.matches.link.shareMessage).toContain('تتش بادل');
    expect(ar.matches.detail.requestLine).toContain('تتش');
  });
});
