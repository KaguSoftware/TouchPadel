import { describe, expect, it } from 'vitest';
import { fieldKeyboardDefaults } from '../fieldKeyboard';

describe('fieldKeyboardDefaults', () => {
  it('lets prose start a sentence and leaves correction to the system', () => {
    expect(fieldKeyboardDefaults({})).toEqual({ autoCapitalize: 'sentences' });
    expect(fieldKeyboardDefaults({ keyboardType: 'default' })).toEqual({ autoCapitalize: 'sentences' });
  });

  it('never capitalises or corrects a password', () => {
    expect(fieldKeyboardDefaults({ secureTextEntry: true })).toEqual({
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
    });
  });

  it('tells autofill an email field holds an email', () => {
    expect(fieldKeyboardDefaults({ keyboardType: 'email-address' })).toEqual({
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
      textContentType: 'emailAddress',
      autoComplete: 'email',
    });
  });

  it('tells autofill a link field holds a URL', () => {
    expect(fieldKeyboardDefaults({ keyboardType: 'url' })).toMatchObject({
      autoCapitalize: 'none',
      textContentType: 'URL',
      autoComplete: 'url',
    });
  });

  it.each(['number-pad', 'decimal-pad', 'numeric', 'phone-pad', 'numbers-and-punctuation'])(
    'keeps %s exact',
    (keyboardType) => {
      expect(fieldKeyboardDefaults({ keyboardType })).toEqual({
        autoCapitalize: 'none',
        autoCorrect: false,
        spellCheck: false,
      });
    },
  );
});
