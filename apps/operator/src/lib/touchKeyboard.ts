/**
 * The on-screen keyboard's pure half (components/TouchKeyboard.tsx owns the
 * DOM). Owner call 2026-11-20: the café till and the cashier stations are
 * touch screens, so every field they type into (sign-in, the manager PIN for
 * Quit to desktop, the lock, a reason, a search) must be typeable without a
 * physical keyboard.
 *
 * Windows' own touch keyboard cannot be the answer: it stays away whenever
 * Windows thinks a keyboard is attached, and the barcode scanner on every till
 * IS a keyboard as far as Windows knows. So the app draws its own.
 */

/** Which pad a field gets. */
export type KeyboardKind = 'text' | 'email' | 'url' | 'numeric' | 'decimal' | 'tel';
export type KeyboardLang = 'en' | 'ar';

/** The part of an element this file reads, so the tests can pass a plain object. */
export interface FieldLike {
  tagName: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  getAttribute(name: string): string | null;
}

/** Input types that take typed text. Everything else (checkbox, date, range, file…) has its own picker. */
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** True when the keyboard should come up for this element. */
export function isTypingField(el: FieldLike | null | undefined): el is FieldLike {
  if (!el) return false;
  if (el.disabled || el.readOnly) return false;
  // A field may opt out (a hidden scanner sink, a field with its own pad).
  if (el.getAttribute('data-osk') === 'off') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return TEXT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase());
}

/**
 * The pad a field asks for. `inputmode` wins, as it does for a phone keyboard;
 * `original` is the inputmode the field had before the keyboard set it to
 * "none" (TouchKeyboard keeps Windows' own keyboard away that way).
 */
export function keyboardKind(el: FieldLike, original?: string | null): KeyboardKind {
  const mode = (original ?? el.getAttribute('inputmode') ?? '').toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (mode === 'numeric') return 'numeric';
  if (mode === 'decimal') return 'decimal';
  if (mode === 'tel' || type === 'tel') return 'tel';
  if (mode === 'email' || type === 'email') return 'email';
  if (mode === 'url' || type === 'url') return 'url';
  if (type === 'number') {
    const step = (el.getAttribute('step') ?? '').toLowerCase();
    return step === 'any' || step.includes('.') ? 'decimal' : 'numeric';
  }
  return 'text';
}

/** A pad of digits only: no letters to switch to. */
export function isNumberPad(kind: KeyboardKind): boolean {
  return kind === 'numeric' || kind === 'decimal' || kind === 'tel';
}

/**
 * The letters a text field opens on. A field that names its language
 * (`dir="ltr"` on an email or phone field, `lang="ar"` on an Arabic name) is
 * obeyed; otherwise the last language the operator picked on the keyboard,
 * otherwise the app's own language.
 */
export function initialLang(
  field: { dir: string | null; lang: string | null; kind: KeyboardKind },
  remembered: KeyboardLang | null,
  appLocale: KeyboardLang,
): KeyboardLang {
  if (field.kind === 'email' || field.kind === 'url') return 'en';
  const lang = (field.lang ?? '').toLowerCase();
  if (lang.startsWith('ar')) return 'ar';
  if (lang.startsWith('en')) return 'en';
  const dir = (field.dir ?? '').toLowerCase();
  if (dir === 'ltr') return 'en';
  if (dir === 'rtl') return 'ar';
  return remembered ?? appLocale;
}

// ---------------------------------------------------------------------------
// Layouts

export type SpecialKey = 'shift' | 'backspace' | 'enter' | 'space' | 'lang' | 'symbols' | 'letters' | 'hide';
export type Key = { char: string; shifted?: string } | { special: SpecialKey };
export type Layer = 'letters' | 'symbols';

const chars = (row: string, shiftedRow?: string): Key[] => {
  const a = Array.from(row);
  const b = shiftedRow === undefined ? undefined : Array.from(shiftedRow);
  return a.map((char, i) => ({ char, shifted: b ? b[i] : char.toUpperCase() }));
};
const k = (special: SpecialKey): Key => ({ special });

/**
 * Arabic as on the standard Windows Arabic (101) keyboard, shifted symbols
 * included, so somebody who types Arabic on a PC finds every letter where
 * their hands expect it. لا is one key, as there.
 */
const AR_ROWS: Key[][] = [
  [
    ...[
      ['ض', 'َ'],
      ['ص', 'ً'],
      ['ث', 'ُ'],
      ['ق', 'ٌ'],
      ['ف', 'لإ'],
      ['غ', 'إ'],
      ['ع', '÷'],
      ['ه', '×'],
      ['خ', '؛'],
      ['ح', '<'],
      ['ج', '>'],
      ['د', '٪'],
    ].map(([char, shifted]) => ({ char: char!, shifted })),
  ],
  [
    ...[
      ['ش', 'ِ'],
      ['س', 'ٍ'],
      ['ي', ']'],
      ['ب', '['],
      ['ل', 'لأ'],
      ['ا', 'أ'],
      ['ت', 'ـ'],
      ['ن', '،'],
      ['م', '/'],
      ['ك', ':'],
      ['ط', '"'],
      ['ذ', 'ّ'],
    ].map(([char, shifted]) => ({ char: char!, shifted })),
  ],
  [
    k('shift'),
    ...[
      ['ئ', '~'],
      ['ء', 'ْ'],
      ['ؤ', '}'],
      ['ر', '{'],
      ['لا', 'لآ'],
      ['ى', 'آ'],
      ['ة', "'"],
      ['و', ','],
      ['ز', '.'],
      ['ظ', '؟'],
    ].map(([char, shifted]) => ({ char: char!, shifted })),
    k('backspace'),
  ],
];

const EN_ROWS: Key[][] = [chars('qwertyuiop'), chars('asdfghjkl'), [k('shift'), ...chars('zxcvbnm'), k('backspace')]];

const SYMBOL_ROWS = (lang: KeyboardLang): Key[][] => [
  chars('1234567890', '1234567890'),
  chars('@#%&*-+=()', '@#%&*-+=()'),
  [...(lang === 'ar' ? chars('.،؟!\'":/_', '.،؟!\'":/_') : chars('.,?!\'":/_', '.,?!\'":/_')), k('backspace')],
];

/** The rows of a text keyboard, its bottom row (space bar) included. */
export function textRows(lang: KeyboardLang, layer: Layer, kind: KeyboardKind): Key[][] {
  const body = layer === 'symbols' ? SYMBOL_ROWS(lang) : lang === 'ar' ? AR_ROWS : EN_ROWS;
  const extras: Key[] = kind === 'email' ? [{ char: '@' }, { char: '.' }] : kind === 'url' ? [{ char: '/' }, { char: '.' }] : [];
  // Email and web addresses are English only: no language key to strand them in Arabic.
  const lead: Key[] = kind === 'email' || kind === 'url' ? [k(layer === 'symbols' ? 'letters' : 'symbols')] : [k(layer === 'symbols' ? 'letters' : 'symbols'), k('lang')];
  return [...body, [...lead, ...extras, k('space'), k('enter'), k('hide')]];
}

/** A key's place on the number pad's four-column grid. */
export interface PadKey {
  key: Key;
  cols?: number;
  rows?: number;
}

/**
 * The number pad: three digits across, Delete / Hide / Enter down the fourth
 * column (Enter two rows tall, where a thumb lands), 0 under 8. A decimal pad
 * puts "." beside 0 and a phone pad "+"; a plain one widens 0 instead.
 */
export function numberPad(kind: KeyboardKind): PadKey[] {
  const extra: Key | null = kind === 'decimal' ? { char: '.' } : kind === 'tel' ? { char: '+' } : null;
  const digit = (char: string): PadKey => ({ key: { char } });
  return [
    digit('1'),
    digit('2'),
    digit('3'),
    { key: k('backspace') },
    digit('4'),
    digit('5'),
    digit('6'),
    { key: k('hide') },
    digit('7'),
    digit('8'),
    digit('9'),
    { key: k('enter'), rows: 2 },
    ...(extra ? [{ key: extra }, { key: { char: '0' }, cols: 2 }] : [{ key: { char: '0' }, cols: 3 }]),
  ];
}

/** What a character key types under the current shift. */
export function keyChar(key: { char: string; shifted?: string }, shifted: boolean): string {
  return shifted ? (key.shifted ?? key.char) : key.char;
}

// ---------------------------------------------------------------------------
// Shift: one tap shifts the next letter, a second tap within the window locks.

export type ShiftState = 'off' | 'once' | 'lock';
export const SHIFT_LOCK_MS = 400;

export function nextShift(state: ShiftState, sinceLastTapMs: number): ShiftState {
  if (state === 'off') return 'once';
  if (state === 'once') return sinceLastTapMs <= SHIFT_LOCK_MS ? 'lock' : 'off';
  return 'off';
}

/** Shift after a character was typed: a one-shot shift is spent. */
export function afterChar(state: ShiftState): ShiftState {
  return state === 'once' ? 'off' : state;
}

// ---------------------------------------------------------------------------
// Editing: the field's value and selection in, the new ones out.

export interface EditState {
  value: string;
  start: number;
  end: number;
}

/** Type `text` over the selection, keeping within `maxLength` (a negative or missing one is no limit). */
export function insertText(s: EditState, text: string, maxLength?: number | null): EditState {
  const before = s.value.slice(0, s.start);
  const after = s.value.slice(s.end);
  let add = text;
  if (maxLength != null && maxLength >= 0) {
    const room = maxLength - before.length - after.length;
    if (room <= 0) return s;
    if (add.length > room) add = add.slice(0, room);
  }
  const caret = before.length + add.length;
  return { value: before + add + after, start: caret, end: caret };
}

/** Backspace: clears the selection, or the one character (a whole surrogate pair) before the caret. */
export function deleteBackward(s: EditState): EditState {
  if (s.start !== s.end) return { value: s.value.slice(0, s.start) + s.value.slice(s.end), start: s.start, end: s.start };
  if (s.start === 0) return s;
  let from = s.start - 1;
  const code = s.value.charCodeAt(from);
  if (from > 0 && code >= 0xdc00 && code <= 0xdfff) {
    const hi = s.value.charCodeAt(from - 1);
    if (hi >= 0xd800 && hi <= 0xdbff) from -= 1;
  }
  return { value: s.value.slice(0, from) + s.value.slice(s.start), start: from, end: from };
}
