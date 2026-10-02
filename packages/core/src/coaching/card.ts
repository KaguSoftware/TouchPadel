// The card-number guard (R49, R74 amended by §1.15 D6; DB-21, OP-04): the client twin of
// app.looks_like_card (0293). A free-text reference or reason that holds a run of 12 or more
// digits, once Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits are read as 0-9 and
// spaces, dots and dashes are taken out, is a card or account number and is refused before
// anything is sent. Every screen that takes such a text uses this one function.
import { latinDigits } from '../analytics/insightsText';

/** Spaces, dots, hyphen-minus, the Unicode dashes U+2010..U+2015 and the minus sign U+2212. */
const CARD_GAPS = /[\s.\-‐-―−]/g;
/** 12 or more Latin digits in a row, once the other scripts are read as Latin. */
const CARD_RUN = /[0-9]{12,}/;

/** True when the text holds a card-length run of digits in any of the three scripts (R74). */
export function looksLikeCardNumber(text: string): boolean {
  return CARD_RUN.test(latinDigits(text).replace(CARD_GAPS, ''));
}
