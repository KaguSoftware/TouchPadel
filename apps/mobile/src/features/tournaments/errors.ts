/**
 * Tournament refusals on the phone (plan §5.2; build contracts §1.9). PURE.
 *
 * The codes themselves are in the one error catalogue (packages/i18n/src/errors.ts, the scaffold's
 * twelve), read through `mapErrorToKey`. Those lines are written for staff and guests alike; this
 * file gives the few a guest meets on register and withdraw a guest's sentence, the detail
 * `TOURNAMENT_NOT_OPEN` carries (`status` | `cutoff`) its own, and says which way a refusal sends
 * the guest. It is the open-match handling (`features/matches/errors.ts`), because
 * `tournament_register` runs `app.match_guest(true)`:
 *
 *  terms     /accept-terms, or "update the app" on a build whose terms are current
 *  phone     the fix card: /complete-profile?returnTo=back
 *  gender    the inline gender ask (`set_my_gender`), then Register again
 *  banned    the red notice, with "Call {branch}"
 *  refetch   the detail read again: its state replaces the action (full, closed, gone, off)
 *  inline    the refusal's copy under the action
 *
 * The booking gate does not apply: registering books no court (plan §5.2).
 */
import type { MessageKey, TParams } from '@touch/i18n';
import { mapErrorToKey, rpcErrorDetail } from '../booking/errors';
import { errorCodeOf } from '../matches/errors';

type T = (key: MessageKey, params?: TParams) => string;

/** The guest's sentence for each tournament code a register or a withdraw can raise. */
export const TOURNAMENT_GUEST_KEYS = {
  TOURNAMENTS_OFF: 'tournaments.guest.errors.off',
  TOURNAMENT_NOT_FOUND: 'tournaments.guest.errors.notFound',
  TOURNAMENT_NOT_OPEN: 'tournaments.guest.errors.notOpenStatus',
  TOURNAMENT_FULL: 'tournaments.guest.errors.full',
  TOURNAMENT_CATEGORY_MISMATCH: 'tournaments.guest.errors.categoryMismatch',
  TOURNAMENT_ENTRY_NOT_FOUND: 'tournaments.guest.errors.entryNotFound',
} as const satisfies Record<string, MessageKey>;

/** `<code> · <detail>` → its own sentence; an unknown detail falls back to the code's line. */
const DETAIL_KEYS: Readonly<Record<string, Readonly<Record<string, MessageKey>>>> = {
  TOURNAMENT_NOT_OPEN: {
    cutoff: 'tournaments.guest.errors.notOpenCutoff',
    status: 'tournaments.guest.errors.notOpenStatus',
  },
};

/** A withdraw's own sentence for a detail, read before DETAIL_KEYS: past the cut-off the desk can
 * still take the guest off (tournament_withdraw's hint). */
const WITHDRAW_DETAIL_KEYS: Readonly<Record<string, Readonly<Record<string, MessageKey>>>> = {
  TOURNAMENT_NOT_OPEN: {
    cutoff: 'tournaments.guest.errors.withdrawCutoff',
  },
};

/** The guest's write the refusal answered. */
export type TournamentAction = 'register' | 'withdraw';

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export interface TournamentErrorContext {
  /**
   * The account has already accepted this build's terms: TERMS_REQUIRED then means the server's
   * match terms are newer than the app's, and reads "update the app" (the open-match rule).
   */
  termsCurrent?: boolean;
  /** The write refused (register when absent): a withdraw past the cut-off reads its own line. */
  action?: TournamentAction;
}

/** The line a tournament refusal reads: the detail's sentence, the guest's line, else the catalogue's. */
export function tournamentErrorText(err: unknown, t: T, ctx: TournamentErrorContext = {}): string {
  const code = errorCodeOf(err);
  const detail = rpcErrorDetail(err);
  if (code && detail) {
    const key =
      (ctx.action === 'withdraw' ? WITHDRAW_DETAIL_KEYS[code]?.[detail] : undefined) ??
      DETAIL_KEYS[code]?.[detail];
    if (key) return t(key);
  }
  if (code === 'TERMS_REQUIRED' && ctx.termsCurrent) return t('matches.errors.updateApp');
  if (code && has(TOURNAMENT_GUEST_KEYS, code)) {
    return t(TOURNAMENT_GUEST_KEYS[code as keyof typeof TOURNAMENT_GUEST_KEYS]);
  }
  return t(mapErrorToKey(err));
}

export type TournamentRefusal = 'terms' | 'phone' | 'gender' | 'banned' | 'refetch' | 'inline';

const REFETCH = new Set([
  'TOURNAMENTS_OFF',
  'TOURNAMENT_NOT_FOUND',
  'TOURNAMENT_NOT_OPEN',
  'TOURNAMENT_FULL',
  'TOURNAMENT_ENTRY_NOT_FOUND',
]);

/** What the detail does with a `tournament_register` / `tournament_withdraw` refusal (above). */
export function tournamentRefusalOf(code: string | null): TournamentRefusal {
  switch (code) {
    case 'TERMS_REQUIRED':
      return 'terms';
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'GENDER_REQUIRED':
      return 'gender';
    case 'MATCH_BANNED':
      return 'banned';
    default:
      return code !== null && REFETCH.has(code) ? 'refetch' : 'inline';
  }
}
