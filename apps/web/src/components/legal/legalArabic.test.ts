import { describe, expect, it } from 'vitest';
import { ar } from '@touch/i18n';

/**
 * The open-match legal Arabic (docs/design/open-matches/guest.md §4.24 rule 2, §4.25): women-only
 * players read these pages too, so a sentence addressed to the reader uses verbal nouns, the
 * passive, the unvocalised past or a possessive suffix, never a second-person present verb,
 * which is masculine («تبدؤها») or feminine («تبدئينها»).
 *
 * The second person masculine present is spelled like the third person feminine («تطلب بعض
 * الحجوزات», «تعود تذاكرها»), so no pattern finds it in general. This list pins the forms the
 * 2026-09-29 review found, one per action the reader takes.
 */
const READER_VERBS = [
  'تبدؤها', // start
  'تنضم', // join
  'تطلب الانضمام', // ask to join
  'تشتريها', // buy
  'تستخدمها', // use
  'تفقدها', // lose
  'ترسلها', // send
  'تقدّمها', // report
  'تحظرهم', // block
  'تأخذها', // take a seat
  'أن تلعب', // play
  'لم تحضر', // come
  'تحضرهم', // bring
  'تغادر', // leave
  'تكون في', // be in a match
];

const { privacy, terms, deleteAccount } = ar.legal;

/** Every legal string the open-matches change wrote or rewrote. */
const OPEN_MATCH_COPY: Record<string, string> = {
  'privacy.collect.matches': privacy.collect.matches,
  'privacy.share.players': privacy.share.players,
  'privacy.retention.deleted': privacy.retention.deleted,
  'privacy.retention.matches': privacy.retention.matches,
  ...Object.fromEntries(Object.entries(terms.openMatches).map(([k, v]) => [`terms.openMatches.${k}`, v])),
  'deleteAccount.what.deleted': deleteAccount.what.deleted,
  'deleteAccount.what.kept': deleteAccount.what.kept,
  'deleteAccount.what.tickets': deleteAccount.what.tickets,
};

describe('open-match legal Arabic', () => {
  it.each(Object.entries(OPEN_MATCH_COPY))('%s addresses the reader without a gendered verb', (_key, text) => {
    for (const verb of READER_VERBS) expect(text).not.toContain(verb);
  });
});

/**
 * The coaching deletion sentences (docs/design/coaching/guest.md §4.16, R50, R63): the same rule,
 * and the lesson is «حصة» (C-30), never «درس».
 */
const COACHING_COPY: Record<string, string> = {
  'privacy.retention.deleted': privacy.retention.deleted,
  'deleteAccount.what.lessons': deleteAccount.what.lessons,
  'deleteAccount.what.coaching': deleteAccount.what.coaching,
};

describe('coaching legal Arabic', () => {
  it.each(Object.entries(COACHING_COPY))('%s: «حصة», never «درس»; no gendered verb', (_, text) => {
    expect(text).toContain('حصص');
    expect(text).not.toMatch(/درس|دروس/);
    for (const verb of READER_VERBS) expect(text).not.toContain(verb);
  });
});
