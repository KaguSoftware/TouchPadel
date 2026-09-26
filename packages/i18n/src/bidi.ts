/**
 * Bidi helpers. Mixed-direction text (a Latin name or phone number inside an
 * Arabic sentence, and vice versa) must be wrapped in FSI…PDI isolates so the
 * Unicode bidi algorithm cannot reorder it against its surroundings.
 */
import type { Locale } from './t';

/** U+2068 FIRST STRONG ISOLATE */
export const FSI = '⁨';
/** U+2069 POP DIRECTIONAL ISOLATE */
export const PDI = '⁩';
/** U+2066 LEFT-TO-RIGHT ISOLATE */
export const LRI = '⁦';

/**
 * Wrap a string in FSI/PDI so it renders with its own first-strong direction,
 * isolated from surrounding text. Use on every interpolated value that may
 * differ in script from the sentence around it (names, phone numbers, codes).
 */
export function isolate(str: string): string {
  return `${FSI}${str}${PDI}`;
}

/**
 * Wrap a string in LRI/PDI so it always renders left-to-right, whatever its
 * own first strong character is and whatever surrounds it. Use for values that
 * are structurally LTR rather than natural-language text — phone numbers,
 * emails, URLs, codes — where `isolate` would flip an Arabic-leading value.
 */
export function isolateLtr(str: string): string {
  return `${LRI}${str}${PDI}`;
}

/** Value for the HTML `dir` attribute for a locale. */
export function dirAttr(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
