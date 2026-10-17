import { describe, expect, it } from 'vitest';
import { makeT, type MessageKey } from '@touch/i18n';
import {
  STATUS_TONE,
  statusLabelKey,
  statusTone,
  statusWord,
  type StatusWord,
} from '../statusTone';

describe('statusTone', () => {
  it('folds every list onto one set of words', () => {
    expect(statusWord('pending')).toBe('waiting');
    expect(statusWord('submitted')).toBe('waiting');
    expect(statusWord('rejected')).toBe('declined');
    expect(statusWord('passed')).toBe('done');
    expect(statusWord('changes')).toBeNull();
  });

  it('gives the same colour to the same word everywhere', () => {
    expect(statusTone('pending')).toBe('warn');
    expect(statusTone('approved')).toBe('good');
    expect(statusTone('declined')).toBe('bad');
    expect(statusTone('withdrawn')).toBe('plain');
    expect(statusTone('live', 'good')).toBe('good');
    expect(statusTone('changes', 'info')).toBe('info');
  });

  it('keeps a page-only status on its own key', () => {
    const own = 'staff.content.status.changes' as MessageKey;
    expect(statusLabelKey('changes', own)).toBe(own);
    expect(statusLabelKey('rejected', own)).toBe('staff.shell.status.declined');
  });

  it('has an EN and AR word for every shared status', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      for (const word of Object.keys(STATUS_TONE) as StatusWord[]) {
        const key = `staff.shell.status.${word}` as MessageKey;
        expect(t(key)).not.toBe(key);
      }
    }
  });
});
