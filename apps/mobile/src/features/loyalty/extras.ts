/**
 * The drink card and the birthday gifts on the phone (0445, `app.my_card_extras`). PURE: no RN,
 * expo or supabase imports, so it runs under the plain-node vitest setup.
 *
 * Every figure is the server's: the stamps, the card's size (a stamp_size privilege already
 * lowered it), whether the next bill frees a drink (`ready`) or an open bill carries it (`held`),
 * and each birthday gift's window, eligibility and use. The phone only decides what to SAY:
 * `drinkCardView` lays the slots out, `birthdayView` picks the one birthday line to show.
 */
import { localParts } from '@touch/core';
import type { CardExtras, GiftTarget } from '@touch/core/loyalty';
import { VENUE_TZ } from '@touch/i18n';
import { isObj, list, num, str, strOrNull } from './logic';

/** What a server without 0445 (or a read that failed) reads as: no drink card, no gifts. */
export const NO_EXTRAS: CardExtras = {
  stamps: { enabled: false, count: 0, size: 8, ready: false, held: false, claimed_until: null },
  birthday: { has_date: false, gifts: [], counts_from: null, gifts_on_card: [] },
  gifts: [],
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** An instant the server sent, or null (a Redeem press's end). */
const instant = (v: unknown): string | null => {
  const s = strOrNull(v);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};
const day = (v: unknown): string | null => {
  const s = strOrNull(v);
  return s && ISO_DAY.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

type Gift = CardExtras['birthday']['gifts'][number];
type GiftOnCard = CardExtras['birthday']['gifts_on_card'][number];
type CardGift = NonNullable<CardExtras['gifts']>[number];

/** items unless the server says court_hour (a server before the court gifts sends none). */
const target = (v: unknown): GiftTarget => (v === 'court_hour' ? 'court_hour' : 'items');

function parseGift(raw: unknown): Gift | null {
  if (!isObj(raw) || !str(raw.perk_id)) return null;
  return {
    perk_id: str(raw.perk_id),
    name_en: str(raw.name_en).trim(),
    name_ar: str(raw.name_ar).trim(),
    target: target(raw.target),
    window_from: day(raw.window_from),
    window_to: day(raw.window_to),
    eligible: raw.eligible === true,
    used: raw.used === true,
    claimed_until: instant(raw.claimed_until),
  };
}

function parseGiftOnCard(raw: unknown): GiftOnCard | null {
  if (!isObj(raw) || !str(raw.perk_id)) return null;
  const days = Math.round(num(raw.days));
  return {
    perk_id: str(raw.perk_id),
    name_en: str(raw.name_en).trim(),
    name_ar: str(raw.name_ar).trim(),
    target: target(raw.target),
    days: days >= 1 && days <= 31 ? days : 7,
  };
}

/** A monthly or card-up gift open now (0445, `my_card_extras.gifts`); an unknown `when` is left out. */
function parseCardGift(raw: unknown): CardGift | null {
  if (!isObj(raw) || !str(raw.perk_id)) return null;
  if (raw.when !== 'monthly' && raw.when !== 'card_up') return null;
  return {
    perk_id: str(raw.perk_id),
    name_en: str(raw.name_en).trim(),
    name_ar: str(raw.name_ar).trim(),
    when: raw.when,
    target: target(raw.target),
    window_to: day(raw.window_to) ?? '',
    used: raw.used === true,
    claimed_until: instant(raw.claimed_until),
  };
}

/** app.my_card_extras(). Anything unreadable reads as off, never as a crash. */
export function parseCardExtras(raw: unknown): CardExtras {
  const o = isObj(raw) ? raw : {};
  const s = isObj(o.stamps) ? o.stamps : {};
  const b = isObj(o.birthday) ? o.birthday : {};
  const size = Math.round(num(s.size));
  return {
    stamps: {
      enabled: s.enabled === true,
      count: Math.max(0, Math.round(num(s.count))),
      // The table holds 2..20; anything else is the club's standard.
      size: size >= 2 && size <= 20 ? size : NO_EXTRAS.stamps.size,
      ready: s.ready === true,
      held: s.held === true,
      claimed_until: instant(s.claimed_until),
    },
    birthday: {
      has_date: b.has_date === true,
      gifts: list(b.gifts, parseGift),
      counts_from: day(b.counts_from),
      gifts_on_card: list(b.gifts_on_card, parseGiftOnCard),
    },
    gifts: list(o.gifts, parseCardGift),
  };
}

// ── the drink card ───────────────────────────────────────────────────────────

/**
 * filling: stamps on their way; ready: a free drink to Redeem (Majed, 2026-11-15: a button, not
 * "ask the cashier"); claimed: Redeemed, the next bill a till opens frees their dearest stamping
 * drink until `claimedUntil`; held: an open bill carries that drink already (the stamps are spent
 * when it settles).
 */
export type DrinkCardState = 'filling' | 'ready' | 'claimed' | 'held';

export interface DrinkCardView {
  state: DrinkCardState;
  size: number;
  /** Slots filled, 0..size (stamps past a full card wait for the next one). */
  filled: number;
  /** Stamps still to a free drink; 0 once full. */
  remaining: number;
  /** The slots as rows, true = stamped, the free drink's slot last. */
  rows: boolean[][];
  /** claimed: when the Redeem press ends. */
  claimedUntil: string | null;
}

/** Slots per row: one row up to 8, then two even rows (10 at most for a card of 20). */
export function slotsPerRow(size: number): number {
  return size <= 8 ? size : Math.ceil(size / 2);
}

/**
 * The drink card as the screen draws it, or null when there is none to show (the owner has the
 * drink card or loyalty off). `held` wins over `ready`: the drink is already on a bill.
 */
export function drinkCardView(stamps: CardExtras['stamps'] | null | undefined): DrinkCardView | null {
  if (!stamps?.enabled) return null;
  const size = Math.min(20, Math.max(2, Math.round(stamps.size) || NO_EXTRAS.stamps.size));
  const full = stamps.ready || stamps.count >= size;
  const filled = full || stamps.held ? size : Math.min(size, Math.max(0, stamps.count));
  const claimedUntil = full && !stamps.held ? (stamps.claimed_until ?? null) : null;
  const state: DrinkCardState = stamps.held ? 'held' : claimedUntil ? 'claimed' : full ? 'ready' : 'filling';
  const per = slotsPerRow(size);
  const slots = Array.from({ length: size }, (_, i) => i < filled);
  const rows: boolean[][] = [];
  for (let i = 0; i < size; i += per) rows.push(slots.slice(i, i + per));
  return { state, size, filled, remaining: Math.max(0, size - filled), rows, claimedUntil };
}

// ── the birthday ─────────────────────────────────────────────────────────────

export interface OpenGift {
  perk_id: string;
  name_en: string;
  name_ar: string;
  /** court_hour: one free hour of the court fee on a booking in the window, taken off at the desk. */
  target: GiftTarget;
  /** The last day it can be used, `YYYY-MM-DD`. */
  until: string | null;
  /** When their Redeem press ends; null: not redeemed yet (it waits for the button). */
  claimedUntil: string | null;
}

/**
 * The one birthday line to show, in this order:
 *   open      a gift is open today, counted and unused: the warm banner, with each gift and the
 *             day it ends (`sameEnd` when they all end on one day, so it is said once);
 *   noDate    the card holds birthday gifts but the profile has no birth date: a quiet prompt;
 *   nextYear  a gift is open today but the date was set or changed less than 30 days before the
 *             window opened, so it starts with the next birthday;
 *   waiting   the date was set or changed recently and starts counting on `countsFrom`;
 *   none      nothing to say (no gifts on the card, or all of today's are used).
 */
export type BirthdayView =
  | { kind: 'open'; gifts: OpenGift[]; sameEnd: string | null }
  | { kind: 'noDate' }
  | { kind: 'nextYear' }
  | { kind: 'waiting'; countsFrom: string }
  | { kind: 'none' };

/** The club's calendar day, `YYYY-MM-DD` (Baghdad, as the server reads `counts_from`). */
export function clubToday(now: Date = new Date()): string {
  return localParts(now, VENUE_TZ).date;
}

/**
 * `today` is the club's calendar day, `YYYY-MM-DD` (the server reads the window in the branch's
 * zone and `counts_from` in Baghdad's; the club is one zone).
 */
export function birthdayView(
  birthday: CardExtras['birthday'] | null | undefined,
  today: string,
): BirthdayView {
  if (!birthday) return { kind: 'none' };
  const open = birthday.gifts.filter((g) => g.eligible && !g.used && (g.name_en || g.name_ar));
  if (open.length > 0) {
    const gifts = open.map((g) => ({
      perk_id: g.perk_id,
      name_en: g.name_en,
      name_ar: g.name_ar,
      target: g.target,
      until: g.window_to,
      claimedUntil: g.claimed_until ?? null,
    }));
    const ends = new Set(gifts.map((g) => g.until));
    return { kind: 'open', gifts, sameEnd: ends.size === 1 ? (gifts[0]?.until ?? null) : null };
  }
  const onCard = birthday.gifts_on_card.length > 0 || birthday.gifts.length > 0;
  if (!onCard) return { kind: 'none' };
  if (!birthday.has_date) return { kind: 'noDate' };
  const counting = birthday.counts_from !== null && birthday.counts_from > today;
  if (birthday.gifts.some((g) => !g.eligible)) {
    return counting ? { kind: 'waiting', countsFrom: birthday.counts_from as string } : { kind: 'nextYear' };
  }
  if (counting) return { kind: 'waiting', countsFrom: birthday.counts_from as string };
  return { kind: 'none' };
}

// ── the monthly and card-up gifts ────────────────────────────────────────────

export interface OpenCardGift extends OpenGift {
  when: 'monthly' | 'card_up';
}

/**
 * The monthly and card-up gifts to show on the Club tab (0445): open now and not used (a used
 * one, or one another open bill holds, is not offered again), in the server's order. The card-up
 * welcomes first: they come once.
 */
export function openCardGifts(gifts: CardExtras['gifts'] | null | undefined): OpenCardGift[] {
  return (gifts ?? [])
    .filter((g) => !g.used && (g.name_en || g.name_ar))
    .map((g) => ({
      perk_id: g.perk_id,
      name_en: g.name_en,
      name_ar: g.name_ar,
      target: g.target,
      when: g.when,
      until: g.window_to || null,
      claimedUntil: g.claimed_until ?? null,
    }))
    .sort((a, b) => (a.when === b.when ? 0 : a.when === 'card_up' ? -1 : 1));
}
