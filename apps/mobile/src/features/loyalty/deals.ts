/**
 * Deals on the phone (0410: `app.my_deals`, `app.pick_deal`). PURE, like logic.ts: no RN, expo
 * or supabase imports, so it runs under the plain-node vitest setup.
 *
 * A deal is a promotion the owner listed in the app. The guest picks ONE to use next; the pick
 * sits on their member card for 24 hours or until a bill that carries it settles, and the cashier
 * applies it when they scan the card. Nothing here decides what a deal is worth on a bill: the
 * server does. This file parses the two answers and shapes what the screens say about a deal.
 *
 * Anything unreadable reads as "no deals", never as a crash: a deal without an id, a name, a
 * value or a state this build knows is left out, because a card the guest cannot trust is worse
 * than a missing one.
 */
import type { Deal, DealName, DealState, MyDeals } from '@touch/core/loyalty';
import { tierColor } from '@touch/core/loyalty';
import { isObj, list, num, str, strOrNull, tierName } from './logic';

/** What a server without deals (or an unreadable answer) reads as. */
export const NO_DEALS: MyDeals = { picked_id: null, picked_until: null, deals: [] };

const STATES: readonly DealState[] = ['open', 'locked', 'used'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A positive whole number, or null: money and counts are never fractional or negative here. */
const positiveInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(num(v));
  return n > 0 ? n : null;
};

function parseName(raw: unknown): DealName | null {
  if (!isObj(raw)) return null;
  const name_en = str(raw.name_en).trim();
  const name_ar = str(raw.name_ar).trim();
  return name_en || name_ar ? { name_en, name_ar } : null;
}

function parseDealTier(raw: unknown): Deal['tier'] {
  if (!isObj(raw) || !str(raw.id)) return null;
  return {
    id: str(raw.id),
    name_en: str(raw.name_en),
    name_ar: str(raw.name_ar),
    color: tierColor(raw.color),
    min_points_12m: Math.max(0, num(raw.min_points_12m)),
  };
}

function parseDeal(raw: unknown): Deal | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const name_en = str(raw.name_en).trim();
  const name_ar = str(raw.name_ar).trim();
  if (!name_en && !name_ar) return null;
  const type = raw.type === 'percent' || raw.type === 'amount' ? raw.type : null;
  const state = STATES.includes(raw.state as DealState) ? (raw.state as DealState) : null;
  if (!type || !state) return null;
  // An amount is whole IQD (formatIQD refuses anything else); a percent keeps what was sent.
  const value = type === 'amount' ? Math.round(num(raw.value)) : num(raw.value);
  if (!(value > 0) || (type === 'percent' && value > 100)) return null;
  const from = HHMM.test(str(raw.hour_from)) ? str(raw.hour_from) : null;
  const to = HHMM.test(str(raw.hour_to)) ? str(raw.hour_to) : null;
  const on = isObj(raw.on) ? raw.on : {};
  const endsAt = strOrNull(raw.ends_at);
  return {
    id: str(raw.id),
    name_en,
    name_ar,
    blurb_en: strOrNull(typeof raw.blurb_en === 'string' ? raw.blurb_en.trim() : null),
    blurb_ar: strOrNull(typeof raw.blurb_ar === 'string' ? raw.blurb_ar.trim() : null),
    type,
    value,
    ends_at: endsAt && Number.isFinite(Date.parse(endsAt)) ? endsAt : null,
    weekdays: Array.isArray(raw.weekdays)
      ? [...new Set(raw.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
          (a, b) => a - b,
        )
      : [],
    // Hours come as a pair; half a pair is no hours at all.
    hour_from: from && to ? from : null,
    hour_to: from && to ? to : null,
    // Only an explicit false says "not right now": an answer without the flag claims nothing.
    live_now: raw.live_now !== false,
    min_spend_iqd: positiveInt(raw.min_spend_iqd),
    per_customer: positiveInt(raw.per_customer),
    used: Math.max(0, Math.round(num(raw.used))),
    tier: parseDealTier(raw.tier),
    state,
    picked: false,
    venue_id: strOrNull(raw.venue_id),
    on: {
      items: list(on.items, parseName),
      categories: list(on.categories, parseName),
      courts: on.courts === true,
    },
  };
}

/**
 * app.my_deals() / app.pick_deal(). `picked_id` is the one source for the pick: a deal is marked
 * picked only when it is that id AND still open, and a pick that names no listed open deal is no
 * pick (the card would promise a deal the list cannot show).
 */
export function parseMyDeals(raw: unknown): MyDeals {
  if (!isObj(raw)) return NO_DEALS;
  const seen = new Set<string>();
  const deals = list(raw.deals, parseDeal).filter((d) => !seen.has(d.id) && !!seen.add(d.id));
  const asked = strOrNull(raw.picked_id);
  const picked = asked ? deals.find((d) => d.id === asked && d.state === 'open') : undefined;
  const until = strOrNull(raw.picked_until);
  return {
    picked_id: picked ? picked.id : null,
    picked_until: picked && until && Number.isFinite(Date.parse(until)) ? until : null,
    deals: picked ? deals.map((d) => (d.id === picked.id ? { ...d, picked: true } : d)) : deals,
  };
}

/**
 * PostgREST's "no function matches" (PGRST202): the server has no `my_deals` yet (hosted gets
 * 0410 on the next push). Deals then read as "none", silently; any other failure is a failure.
 */
export function isMissingRpc(err: unknown): boolean {
  return isObj(err) && err.code === 'PGRST202';
}

// ── what a deal card says ────────────────────────────────────────────────────

/** The deal the guest picked, while the pick is live at `nowMs` (it lapses after 24 hours). */
export function pickedDeal(deals: MyDeals | null | undefined, nowMs: number): Deal | null {
  if (!deals?.picked_id) return null;
  if (deals.picked_until && Date.parse(deals.picked_until) <= nowMs) return null;
  return deals.deals.find((d) => d.id === deals.picked_id) ?? null;
}

/** A deal's name in the guest's language, the other one when that is empty. */
export function dealName(d: Pick<Deal, 'name_en' | 'name_ar'>, locale: 'en' | 'ar'): string {
  return tierName(d, locale);
}

/** The owner's line in the guest's language (the other one when that is empty), or null. */
export function dealBlurb(d: Pick<Deal, 'blurb_en' | 'blurb_ar'>, locale: 'en' | 'ar'): string | null {
  return (locale === 'ar' ? d.blurb_ar || d.blurb_en : d.blurb_en || d.blurb_ar) || null;
}

/** What the big figure is made of: the screen formats the number in the guest's language. */
export type DealValue = { kind: 'percent'; percent: number } | { kind: 'amount'; iqd: number };

export function dealValue(d: Pick<Deal, 'type' | 'value'>): DealValue {
  return d.type === 'percent' ? { kind: 'percent', percent: d.value } : { kind: 'amount', iqd: d.value };
}

/** How many names a card lists before it says "and more". */
export const COVER_NAMES_MAX = 3;

export interface DealCover {
  /** Named items and categories (categories first), at most COVER_NAMES_MAX. Empty: the whole café bill. */
  names: string[];
  /** There were more names than are listed. */
  more: boolean;
  /** The deal needs a court booking on the bill. */
  courts: boolean;
}

/** What the deal takes money off, for the line shown when the owner wrote none. */
export function dealCover(d: Pick<Deal, 'on'>, locale: 'en' | 'ar'): DealCover {
  const all = [...d.on.categories, ...d.on.items].map((n) => tierName(n, locale)).filter(Boolean);
  const names = [...new Set(all)];
  return {
    names: names.slice(0, COVER_NAMES_MAX),
    more: names.length > COVER_NAMES_MAX,
    courts: d.on.courts,
  };
}

export interface DealSchedule {
  /** 0 = Sunday .. 6 = Saturday, in week order. Empty: every day. */
  weekdays: number[];
  /** 'HH:MM' in the branch's time, or null for all day. */
  hours: { from: string; to: string } | null;
  /** It runs only on some days or at some hours. */
  limited: boolean;
}

/** When a deal runs. Seven named days are every day. */
export function dealSchedule(d: Pick<Deal, 'weekdays' | 'hour_from' | 'hour_to'>): DealSchedule {
  const weekdays = d.weekdays.length >= 7 ? [] : d.weekdays;
  const hours = d.hour_from && d.hour_to ? { from: d.hour_from, to: d.hour_to } : null;
  return { weekdays, hours, limited: weekdays.length > 0 || hours !== null };
}

/**
 * An instant whose UTC weekday is `dow` (0 = Sunday), for `formatWeekdayShort(…, 'UTC')`: the
 * weekday names belong to @touch/i18n, which names them from a date.
 */
export function weekdayInstant(dow: number): Date {
  // 1970-01-04 was a Sunday.
  return new Date(Date.UTC(1970, 0, 4 + (((dow % 7) + 7) % 7), 12));
}

/** An instant whose UTC wall clock is `hhmm`, for `formatTimeRangeShort(…, 'UTC')`. */
export function clockInstant(hhmm: string): Date {
  const [h = '0', m = '0'] = hhmm.split(':');
  return new Date(Date.UTC(1970, 0, 4, Number(h) || 0, Number(m) || 0));
}

/** Uses the guest has left, or null when the deal does not count them. */
export function usesLeft(d: Pick<Deal, 'per_customer' | 'used'>): number | null {
  return d.per_customer === null ? null : Math.max(0, d.per_customer - d.used);
}

/** Points in the last 12 months still needed for a locked deal's card, or null when it names none. */
export function dealPointsNeeded(d: Pick<Deal, 'state' | 'tier'>, points12m: number): number | null {
  if (d.state !== 'locked' || !d.tier) return null;
  return Math.max(0, d.tier.min_points_12m - points12m);
}
