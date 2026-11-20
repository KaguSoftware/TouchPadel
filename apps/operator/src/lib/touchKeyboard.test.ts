import { describe, expect, it } from 'vitest';
import {
  afterChar,
  deleteBackward,
  initialLang,
  insertText,
  isNumberPad,
  isTypingField,
  keyboardKind,
  nextShift,
  numberPad,
  textRows,
  type FieldLike,
} from './touchKeyboard';

function field(tagName: string, attrs: Record<string, string> = {}, extra: Partial<FieldLike> = {}): FieldLike {
  return { tagName, getAttribute: (n) => attrs[n] ?? null, ...extra };
}

describe('isTypingField', () => {
  it('takes text-like inputs and textareas', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number']) expect(isTypingField(field('INPUT', { type }))).toBe(true);
    expect(isTypingField(field('INPUT'))).toBe(true);
    expect(isTypingField(field('TEXTAREA'))).toBe(true);
  });
  it('leaves pickers, disabled, read-only and opted-out fields alone', () => {
    for (const type of ['checkbox', 'radio', 'date', 'time', 'range', 'file', 'color', 'button', 'submit']) expect(isTypingField(field('INPUT', { type }))).toBe(false);
    expect(isTypingField(field('INPUT', {}, { disabled: true }))).toBe(false);
    expect(isTypingField(field('INPUT', {}, { readOnly: true }))).toBe(false);
    expect(isTypingField(field('INPUT', { 'data-osk': 'off' }))).toBe(false);
    expect(isTypingField(field('SELECT'))).toBe(false);
    expect(isTypingField(null)).toBe(false);
  });
});

describe('keyboardKind', () => {
  it('reads inputmode first, then the type', () => {
    expect(keyboardKind(field('INPUT', { type: 'password', inputmode: 'numeric' }))).toBe('numeric');
    expect(keyboardKind(field('INPUT', { inputmode: 'decimal' }))).toBe('decimal');
    expect(keyboardKind(field('INPUT', { type: 'tel' }))).toBe('tel');
    expect(keyboardKind(field('INPUT', { type: 'email' }))).toBe('email');
    expect(keyboardKind(field('INPUT', { type: 'number' }))).toBe('numeric');
    expect(keyboardKind(field('INPUT', { type: 'number', step: '0.01' }))).toBe('decimal');
    expect(keyboardKind(field('INPUT', { type: 'search' }))).toBe('text');
  });
  it('uses the inputmode the field had before the keyboard set it to none', () => {
    expect(keyboardKind(field('INPUT', { inputmode: 'none' }), 'numeric')).toBe('numeric');
  });
  it('knows which kinds are number pads', () => {
    expect(isNumberPad('numeric') && isNumberPad('decimal') && isNumberPad('tel')).toBe(true);
    expect(isNumberPad('text') || isNumberPad('email')).toBe(false);
  });
});

describe('initialLang', () => {
  it('obeys a field that names its language, else the remembered pick, else the app', () => {
    expect(initialLang({ dir: 'ltr', lang: null, kind: 'text' }, 'ar', 'ar')).toBe('en');
    expect(initialLang({ dir: null, lang: 'ar', kind: 'text' }, 'en', 'en')).toBe('ar');
    expect(initialLang({ dir: 'rtl', lang: null, kind: 'text' }, null, 'en')).toBe('ar');
    expect(initialLang({ dir: null, lang: null, kind: 'text' }, 'en', 'ar')).toBe('en');
    expect(initialLang({ dir: null, lang: null, kind: 'text' }, null, 'ar')).toBe('ar');
  });
  it('keeps email and web addresses in English', () => {
    expect(initialLang({ dir: 'rtl', lang: 'ar', kind: 'email' }, 'ar', 'ar')).toBe('en');
  });
});

describe('layouts', () => {
  it('ends every text keyboard with the space bar, Enter and Hide', () => {
    for (const lang of ['en', 'ar'] as const) {
      const rows = textRows(lang, 'letters', 'text');
      const last = rows[rows.length - 1]!.map((k) => ('special' in k ? k.special : k.char));
      expect(last).toEqual(['symbols', 'lang', 'space', 'enter', 'hide']);
    }
  });
  it('has every Arabic letter', () => {
    const typed = textRows('ar', 'letters', 'text')
      .flat()
      .flatMap((k) => ('char' in k ? [k.char] : []))
      .join('');
    for (const ch of 'ابتثجحخدذرزسشصضطظعغفقكلمنهويءئؤةى') expect(typed).toContain(ch);
  });
  it('gives an email field @ and . and no language key', () => {
    const last = textRows('en', 'letters', 'email').at(-1)!.map((k) => ('special' in k ? k.special : k.char));
    expect(last).toEqual(['symbols', '@', '.', 'space', 'enter', 'hide']);
  });
  it('lays the number pad out as a full 4-column grid', () => {
    for (const kind of ['numeric', 'decimal', 'tel'] as const) {
      const cells = numberPad(kind).reduce((n, p) => n + (p.cols ?? 1) * (p.rows ?? 1), 0);
      expect(cells).toBe(16);
      const chars = numberPad(kind).flatMap((p) => ('char' in p.key ? [p.key.char] : []));
      expect(chars.filter((c) => /\d/.test(c)).sort().join('')).toBe('0123456789');
    }
    expect(numberPad('decimal').some((p) => 'char' in p.key && p.key.char === '.')).toBe(true);
    expect(numberPad('tel').some((p) => 'char' in p.key && p.key.char === '+')).toBe(true);
  });
});

describe('shift', () => {
  it('shifts once, locks on a quick second tap, and a letter spends a one-shot shift', () => {
    expect(nextShift('off', 1000)).toBe('once');
    expect(nextShift('once', 200)).toBe('lock');
    expect(nextShift('once', 1000)).toBe('off');
    expect(nextShift('lock', 100)).toBe('off');
    expect(afterChar('once')).toBe('off');
    expect(afterChar('lock')).toBe('lock');
  });
});

describe('editing', () => {
  it('types over the selection and moves the caret', () => {
    expect(insertText({ value: 'abcd', start: 1, end: 3 }, 'X')).toEqual({ value: 'aXd', start: 2, end: 2 });
    expect(insertText({ value: '', start: 0, end: 0 }, 'لا')).toEqual({ value: 'لا', start: 2, end: 2 });
  });
  it('keeps within maxLength', () => {
    const full = { value: '1234', start: 4, end: 4 };
    expect(insertText(full, '5', 4)).toBe(full);
    expect(insertText({ value: '12', start: 2, end: 2 }, 'لا', 3)).toEqual({ value: '12ل', start: 3, end: 3 });
    expect(insertText(full, '5', -1).value).toBe('12345');
  });
  it('deletes the selection, else one character, a surrogate pair whole', () => {
    expect(deleteBackward({ value: 'abcd', start: 1, end: 3 })).toEqual({ value: 'ad', start: 1, end: 1 });
    expect(deleteBackward({ value: 'abc', start: 3, end: 3 })).toEqual({ value: 'ab', start: 2, end: 2 });
    expect(deleteBackward({ value: 'a😀', start: 3, end: 3 })).toEqual({ value: 'a', start: 1, end: 1 });
    const empty = { value: 'x', start: 0, end: 0 };
    expect(deleteBackward(empty)).toBe(empty);
  });
});
