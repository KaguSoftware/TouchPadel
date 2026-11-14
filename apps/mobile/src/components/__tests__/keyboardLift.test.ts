import { describe, expect, it } from 'vitest';
import { KEYBOARD_GAP, keyboardLift, keyboardTop } from '../keyboardLift';

// An iPhone 15: 852 pt window, 336 pt keyboard with the predictive row, 34 pt home indicator.
const WINDOW = 852;
const KEYBOARD = 336;
const TOP = WINDOW - KEYBOARD;

describe('keyboardLift', () => {
  it('lifts a full-height page by exactly what the keyboard covers, no header guess', () => {
    expect(keyboardLift({ viewBottom: WINDOW, keyboardTop: TOP, footerPad: 0 })).toBe(KEYBOARD);
  });

  it('tucks a pinned bar’s home-indicator padding under the keys, keeping the gap', () => {
    const lift = keyboardLift({ viewBottom: WINDOW, keyboardTop: TOP, footerPad: 34 });
    expect(lift).toBe(KEYBOARD - (34 - KEYBOARD_GAP));
  });

  it('keeps a padding smaller than the gap whole', () => {
    expect(keyboardLift({ viewBottom: WINDOW, keyboardTop: TOP, footerPad: 8 })).toBe(KEYBOARD);
  });

  it('lifts only by the covered part of a page that ends above the screen’s foot', () => {
    expect(keyboardLift({ viewBottom: WINDOW - 100, keyboardTop: TOP, footerPad: 0 })).toBe(KEYBOARD - 100);
  });

  it('does not lift a page the keyboard does not reach', () => {
    expect(keyboardLift({ viewBottom: 400, keyboardTop: TOP, footerPad: 34 })).toBe(0);
    expect(keyboardLift({ viewBottom: WINDOW, keyboardTop: WINDOW, footerPad: 34 })).toBe(0);
  });

  it('never goes negative when the keyboard covers less than the padding', () => {
    expect(keyboardLift({ viewBottom: WINDOW, keyboardTop: WINDOW - 10, footerPad: 34 })).toBe(0);
  });
});

describe('keyboardTop', () => {
  it('uses screenY when iOS reports it', () => {
    expect(keyboardTop({ screenY: TOP, height: KEYBOARD, windowHeight: WINDOW })).toBe(TOP);
  });

  it('falls back to the height under Prefer Cross-Fade Transitions (screenY 0)', () => {
    expect(keyboardTop({ screenY: 0, height: KEYBOARD, windowHeight: WINDOW })).toBe(TOP);
  });
});
