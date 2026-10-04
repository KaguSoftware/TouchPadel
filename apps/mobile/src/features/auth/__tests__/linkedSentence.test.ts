import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { splitSentence } from '../linkedSentence';

describe('splitSentence', () => {
  it('splits text around its slots, in order', () => {
    expect(splitSentence('I agree to the {terms} and have read the {privacy}.')).toEqual([
      { kind: 'text', text: 'I agree to the ' },
      { kind: 'slot', name: 'terms' },
      { kind: 'text', text: ' and have read the ' },
      { kind: 'slot', name: 'privacy' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps a sentence with no slots whole', () => {
    expect(splitSentence('Plain.')).toEqual([{ kind: 'text', text: 'Plain.' }]);
  });

  it('finds both links in both catalogs', () => {
    for (const locale of ['en', 'ar'] as const) {
      const slots = splitSentence(makeT(locale)('auth.termsAgreeLinked'))
        .filter((p) => p.kind === 'slot')
        .map((p) => (p.kind === 'slot' ? p.name : ''));
      expect(slots.sort()).toEqual(['privacy', 'terms']);
    }
  });
});
