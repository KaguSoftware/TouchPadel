import { isolateLtr, makeT, type Locale } from '@touch/i18n';

/**
 * A counted phrase by the locale's own plural rules (`Intl.PluralRules`), so a number
 * the operator can edit never meets a noun in the wrong form. English has two forms;
 * Arabic has six: 1 → «ساعة واحدة», 2 → «ساعتين», 3–10 → «4 ساعات», 11 and up → «12 ساعة».
 * The catalog's `site.hoursCount.*` carries every form in both languages (key parity).
 *
 * The number is LTR-isolated, like every figure dropped into a sentence on the site.
 */
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
type PluralForm = (typeof FORMS)[number];

export function pluralForm(count: number, locale: Locale): PluralForm {
  const form = new Intl.PluralRules(locale).select(count);
  return (FORMS as readonly string[]).includes(form) ? (form as PluralForm) : 'other';
}

/** "4 hours" / "1 hour"; «4 ساعات» / «12 ساعة» / «ساعتين» / «ساعة واحدة». */
export function hoursPhrase(count: number, locale: Locale): string {
  return makeT(locale)(`site.hoursCount.${pluralForm(count, locale)}`, {
    count: isolateLtr(String(count)),
  });
}
