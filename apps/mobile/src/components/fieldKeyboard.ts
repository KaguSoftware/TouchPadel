/**
 * What the phone's keyboard should do for a field, worked out from what the
 * field already says about itself.
 *
 * A field that declares `secureTextEntry`, an email or URL keyboard, or a
 * number pad is a Latin, exact-entry field: capitalising its first letter,
 * "correcting" it or underlining it as a misspelling only breaks what was
 * typed (a password with a capital the guest never pressed, an email the
 * keyboard changed to a dictionary word). Email and URL fields also tell the
 * system what they hold, so iOS QuickType and Android autofill offer the
 * right saved value. Everything else is prose and starts a sentence with a
 * capital.
 *
 * These are DEFAULTS: `Field` spreads them first and the caller's own props
 * after, so a screen that says otherwise (a name with `words`, a password for
 * someone else with autofill `off`) always wins.
 *
 * Pure (no `react-native` import) so vitest can pin it; the prop values are
 * the plain strings `TextInputProps` takes.
 */

type KeyboardKind =
  | 'default'
  | 'email-address'
  | 'numeric'
  | 'phone-pad'
  | 'number-pad'
  | 'decimal-pad'
  | 'url'
  | 'numbers-and-punctuation'
  | 'ascii-capable'
  | 'web-search'
  | 'visible-password'
  | 'name-phone-pad'
  | 'twitter';

export interface FieldKeyboardInput {
  keyboardType?: KeyboardKind | string;
  secureTextEntry?: boolean;
}

export interface FieldKeyboardDefaults {
  autoCapitalize: 'none' | 'sentences';
  autoCorrect?: false;
  spellCheck?: false;
  textContentType?: 'emailAddress' | 'URL';
  autoComplete?: 'email' | 'url';
}

const EXACT_KEYBOARDS = new Set<string>([
  'email-address',
  'url',
  'numeric',
  'phone-pad',
  'number-pad',
  'decimal-pad',
  'numbers-and-punctuation',
  'visible-password',
]);

export function fieldKeyboardDefaults({
  keyboardType,
  secureTextEntry,
}: FieldKeyboardInput): FieldKeyboardDefaults {
  const exact = secureTextEntry === true || (keyboardType != null && EXACT_KEYBOARDS.has(keyboardType));
  if (!exact) return { autoCapitalize: 'sentences' };
  const base = { autoCapitalize: 'none', autoCorrect: false, spellCheck: false } as const;
  if (keyboardType === 'email-address') {
    return { ...base, textContentType: 'emailAddress', autoComplete: 'email' };
  }
  if (keyboardType === 'url') return { ...base, textContentType: 'URL', autoComplete: 'url' };
  return base;
}

/**
 * A search box: the keyboard's return key reads "Search", and nothing is
 * capitalised, corrected or autofilled — a query is a fragment of a name
 * ("lat" for latte), and a correction turns it into a word the list never
 * holds. Spread first on a `Field`: `<Field {...searchField} … />`.
 */
export const searchField = {
  returnKeyType: 'search',
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
} as const;

/**
 * SOMEONE ELSE'S name (a student, a candidate, a guest's tab, a new staff
 * member): capitalised per word and never corrected. On iOS `name` lets the
 * QuickType bar fill it from Contacts; on Android autofill is off, because
 * all it would offer is the phone owner's own name.
 */
export const otherPersonName = {
  autoCapitalize: 'words',
  autoCorrect: false,
  textContentType: 'name',
  autoComplete: 'off',
} as const;
