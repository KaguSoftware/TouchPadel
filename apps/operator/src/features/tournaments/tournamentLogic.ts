/**
 * The tournament screens' words and small rules (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.3, §1.9). PURE.
 *
 * - A refusal's line: a `ws.tournaments.*` key when this lane knows the code
 *   and its detail, else the shared catalogue's (`errorToMessageKey`).
 * - Tones for the tournament and entry states.
 * - The calendar's overlay map (`tournamentsByReservation`, the
 *   `lessonsByReservation` twin) and the refunds a cancel leaves.
 */
import type { MessageKey, Locale, TParams } from '@touch/i18n';
import type { TourEntryStatus, TourStatus } from '@touch/core/tournaments';
import type { Tone } from '../../components/kit';
import { AppRpcError } from '../../lib/appRpc';
import { errorToMessageKey } from '../../lib/errors';
import type {
  DeskTournament,
  DeskTournaments,
  TourEntry,
  TournamentDetail,
} from './tournamentPayloads';

export type Tr = (key: MessageKey, params?: TParams) => string;

export const TOUR_STATUS_TONE: Record<TourStatus, Tone> = {
  open: 'accent',
  closed: 'info',
  running: 'warn',
  finished: 'success',
  cancelled: 'danger',
};

export const ENTRY_STATUS_TONE: Record<TourEntryStatus, Tone> = {
  registered: 'success',
  waitlisted: 'info',
  withdrawn: 'neutral',
  no_show: 'danger',
};

/** The name in the desk's language, the other one when it is blank. */
export function pickName(
  locale: Locale,
  en: string | null | undefined,
  ar: string | null | undefined,
): string {
  const a = (locale === 'ar' ? ar : en) ?? '';
  return a.trim() !== '' ? a : ((locale === 'ar' ? en : ar) ?? '');
}

/** The detail an AppRpcError carries (`details`, else `hint`), trimmed; null without one. */
export function detailOf(error: unknown): string | null {
  if (!(error instanceof AppRpcError)) return null;
  const d = (error.details ?? '').trim();
  if (d) return d;
  const h = (error.hint ?? '').trim();
  return h || null;
}

const ROUNDS_DETAILS = new Set([
  'status',
  'stale',
  'engine',
  'format',
  'numbering',
  'played',
  'mexicano_one',
  'round_open',
  'seat',
  'court',
  'courts_used',
  'sit_out',
]);
const PUBLISH_DETAILS = new Set([
  'not_done',
  'already_published',
  'capacity_unit',
  'capacity_count',
  'format',
  'fee_not_approved',
  'no_blocks',
]);
const NOT_PAYABLE_DETAILS = new Set([
  'waitlisted',
  'withdrawn',
  'no_show',
  'cancelled',
  'nothing_owed',
]);

/** A refusal's message key: this lane's sentence for a known code and detail, else the catalogue's. */
export function tournamentErrorKey(error: unknown): MessageKey {
  const base = errorToMessageKey(error);
  if (!(error instanceof AppRpcError)) return base;
  const d = detailOf(error) ?? '';
  switch (error.code) {
    case 'TOURNAMENT_NOT_OPEN':
      if (d === 'status' || d === 'cutoff') return `ws.tournaments.errors.notOpen.${d}`;
      break;
    case 'TOURNAMENT_ROUNDS_INVALID':
      if (ROUNDS_DETAILS.has(d)) return `ws.tournaments.errors.rounds.${d as 'status'}`;
      break;
    case 'TOURNAMENT_SCORE_REFUSED':
      if (d === 'status' || d === 'invalid' || d === 'changed' || d === 'locked' || d === 'closed')
        return `ws.tournaments.errors.score.${d}`;
      break;
    case 'TOURNAMENT_PUBLISH_REFUSED':
      if (PUBLISH_DETAILS.has(d)) return `ws.tournaments.publish.refused.${d as 'not_done'}`;
      if (d.startsWith('settings:')) return 'ws.tournaments.publish.refused.settings';
      break;
    case 'TOURNAMENT_NOT_PAYABLE':
      if (NOT_PAYABLE_DETAILS.has(d)) return `ws.tournaments.pay.notPayable.${d as 'waitlisted'}`;
      break;
    case 'INVALID_ARGUMENT':
      if (d === 'p_payload') return 'ws.tournaments.errors.rounds.payload';
      break;
  }
  return base;
}

/** The refusal as a sentence; `params` fills the score's `{target}`. */
export function tournamentErrorText(error: unknown, tr: Tr, params: TParams = {}): string {
  return tr(tournamentErrorKey(error), params);
}

/** The `settings:<key>` a publish refusal names, or null. */
export function refusedSetting(error: unknown): string | null {
  if (!(error instanceof AppRpcError) || error.code !== 'TOURNAMENT_PUBLISH_REFUSED') return null;
  const d = detailOf(error) ?? '';
  return d.startsWith('settings:') ? d.slice('settings:'.length) : null;
}

/** The code of a refusal, or null (network failures and the like). */
export function codeOf(error: unknown): string | null {
  return error instanceof AppRpcError ? error.code : null;
}

// ── the calendar overlay ─────────────────────────────────────────────────────

export interface BlockTournament {
  id: string;
  name_en: string;
  name_ar: string;
  status: DeskTournament['status'];
}

/**
 * Reservation id → the tournament that adopted it (desk_tournaments' blocks),
 * the twin of `lessonsByReservation`. Empty while the read is absent.
 */
export function tournamentsByReservation(
  desk: DeskTournaments | null | undefined,
): Map<string, BlockTournament> {
  const out = new Map<string, BlockTournament>();
  for (const t of desk?.tournaments ?? []) {
    for (const b of t.blocks)
      out.set(b.reservation_id, {
        id: t.id,
        name_en: t.name_en,
        name_ar: t.name_ar,
        status: t.status,
      });
  }
  return out;
}

/** Whether a reservation is an adopted block of a tournament that still holds it (the guard trigger's set). */
export function isLiveAdoptedBlock(t: BlockTournament | null | undefined): boolean {
  return !!t && (t.status === 'open' || t.status === 'closed' || t.status === 'running');
}

// ── entries and money ────────────────────────────────────────────────────────

/** The entries in the order the desk reads them: registered by seed, then the waitlist, then the rest. */
export function sortEntries(entries: readonly TourEntry[]): TourEntry[] {
  const rank: Record<TourEntryStatus, number> = {
    registered: 0,
    waitlisted: 1,
    no_show: 2,
    withdrawn: 3,
  };
  return entries
    .map((e, i) => ({ e, i }))
    .sort((x, y) => {
      const s = rank[x.e.status] - rank[y.e.status];
      if (s !== 0) return s;
      if (x.e.status === 'registered')
        return (x.e.seed_no ?? 1e6) - (y.e.seed_no ?? 1e6) || x.i - y.i;
      if (x.e.status === 'waitlisted')
        return (x.e.waitlist_position ?? 1e6) - (y.e.waitlist_position ?? 1e6) || x.i - y.i;
      return x.i - y.i;
    })
    .map((x) => x.e);
}

/** What the money cell says: owed, refund due, paid, or no fee. */
export type EntryMoney =
  | { kind: 'owed'; amount: number }
  | { kind: 'refund'; amount: number }
  | { kind: 'paid' }
  | { kind: 'none' };

export function entryMoney(e: TourEntry, fee: number): EntryMoney {
  if (e.refund_due_iqd > 0) return { kind: 'refund', amount: e.refund_due_iqd };
  if (e.owed_iqd > 0) return { kind: 'owed', amount: e.owed_iqd };
  if (fee > 0 && e.net_paid_iqd > 0) return { kind: 'paid' };
  return { kind: 'none' };
}

/** The entries money is due back to (a cancel, a withdrawal), largest first. */
export function refundsDue(d: Pick<TournamentDetail, 'entries'>): TourEntry[] {
  return d.entries
    .filter((e) => e.refund_due_iqd > 0)
    .sort((x, y) => y.refund_due_iqd - x.refund_due_iqd);
}

/** The row actions an entry offers, by the tournament's stage (§1.6 add / remove / no-show). */
export function entryActions(
  e: TourEntry,
  d: Pick<TournamentDetail, 'status' | 'can' | 'entry_fee_iqd'>,
  caps: { run: boolean; pay: boolean },
): { pay: boolean; remove: boolean; noShow: boolean; promote: boolean } {
  const live = d.status === 'open' || d.status === 'closed' || d.status === 'running';
  return {
    pay:
      caps.pay &&
      d.can.settle &&
      e.status === 'registered' &&
      e.owed_iqd > 0 &&
      d.status !== 'cancelled',
    remove:
      caps.run &&
      (d.status === 'open' || d.status === 'closed') &&
      (e.status === 'registered' || e.status === 'waitlisted'),
    noShow:
      caps.run && (d.status === 'closed' || d.status === 'running') && e.status === 'registered',
    // add_entry on a waitlisted guest promotes them when there is room (M1).
    promote: caps.run && live && d.can.add && e.status === 'waitlisted' && e.guest_id !== null,
  };
}

/** The waitlisted entries a no-show can be replaced by, first in line first. */
export function substitutes(d: Pick<TournamentDetail, 'entries'>): TourEntry[] {
  return sortEntries(d.entries.filter((e) => e.status === 'waitlisted'));
}

/** Registered players now / the cap. */
export function registeredCount(d: Pick<TournamentDetail, 'entries'>): number {
  return d.entries.filter((e) => e.status === 'registered').length;
}
