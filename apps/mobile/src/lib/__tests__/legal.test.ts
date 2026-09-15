import { describe, expect, it } from 'vitest';
import { legalUrl } from '../legal';

describe('legalUrl', () => {
  it('points at the locale-prefixed page on the public site', () => {
    expect(legalUrl('privacy', 'en')).toMatch(/^https:\/\/[^/]+\/en\/privacy$/);
    expect(legalUrl('support', 'ar')).toMatch(/^https:\/\/[^/]+\/ar\/support$/);
  });
});
