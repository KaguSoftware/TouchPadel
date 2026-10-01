import { describe, expect, it } from 'vitest';
import { greetingNameOf, nameFieldsOf, namePatch } from '../names';

/**
 * The name in two parts (0256; docs/design/open-matches/guest.md §4.9): the
 * fields start from the stored parts, a row cached before them falls back to
 * `full_name`, and a save sends the parts with an empty surname as NULL.
 */

describe('nameFieldsOf', () => {
  it('reads the stored parts', () => {
    expect(nameFieldsOf({ full_name: 'Ahmed Kareem', given_name: 'Ahmed', family_name: 'Kareem' })).toEqual({
      first: 'Ahmed',
      last: 'Kareem',
    });
    expect(nameFieldsOf({ full_name: 'Zainab', given_name: 'Zainab', family_name: null })).toEqual({
      first: 'Zainab',
      last: '',
    });
  });

  it('splits full_name for a row cached before the parts existed', () => {
    expect(nameFieldsOf({ full_name: 'Ahmed Kareem Hassan' })).toEqual({ first: 'Ahmed', last: 'Kareem Hassan' });
    expect(nameFieldsOf({ full_name: '  Sara  ' })).toEqual({ first: 'Sara', last: '' });
    expect(nameFieldsOf({ full_name: '' })).toEqual({ first: '', last: '' });
    expect(nameFieldsOf(null)).toEqual({ first: '', last: '' });
  });

  it("hides the trigger's email fallback, whichever column carries it", () => {
    const email = 'k3x9q2@privaterelay.appleid.com';
    expect(nameFieldsOf({ full_name: 'k3x9q2', given_name: 'k3x9q2', family_name: null }, email)).toEqual({
      first: '',
      last: '',
    });
    expect(nameFieldsOf({ full_name: 'k3x9q2' }, email)).toEqual({ first: '', last: '' });
    expect(nameFieldsOf({ full_name: 'Ahmed K', given_name: 'Ahmed', family_name: 'K' }, email)).toEqual({
      first: 'Ahmed',
      last: 'K',
    });
  });
});

describe('greetingNameOf', () => {
  it('greets by the first name, else the first word of full_name', () => {
    expect(greetingNameOf({ full_name: 'Abd al Rahman Ali', given_name: 'Abd al Rahman' })).toBe('Abd al Rahman');
    expect(greetingNameOf({ full_name: 'Ahmed Kareem' })).toBe('Ahmed');
    expect(greetingNameOf({ full_name: 'Ahmed', given_name: '  ' })).toBe('Ahmed');
    expect(greetingNameOf(undefined)).toBe('');
  });
});

describe('namePatch', () => {
  it('sends both parts trimmed, and a blank surname as NULL', () => {
    expect(namePatch(' Ahmed ', ' Kareem ')).toEqual({ given_name: 'Ahmed', family_name: 'Kareem' });
    expect(namePatch('Zainab', '   ')).toEqual({ given_name: 'Zainab', family_name: null });
  });
});
