/**
 * What a deal SAYS (Majed, 2026-11-15): its value in words, the one line under its name, and the
 * facts its sheet lists. PURE, like deals.ts (no RN), so vitest reads every sentence; the cards
 * and the sheet only lay them out (DealCards.tsx, DealSheetContent.tsx).
 */
import type { Deal } from '@touch/core/loyalty';
import {
  formatDateTime,
  formatIQD,
  formatNumber,
  formatTimeRangeShort,
  formatWeekdayShort,
  isolate,
  isolateLtr,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import { pickText } from '../cafe/logic';
import {
  clockInstant,
  dealBlurb,
  dealCover,
  dealPointsNeeded,
  dealSchedule,
  dealValue,
  usesLeft,
  weekdayInstant,
} from './deals';
import { tierName } from './logic';

export type T = (key: MessageKey, params?: TParams) => string;

const pct = (n: number, locale: Locale) => isolateLtr(`${formatNumber(n, locale)}%`);
const list = (names: string[], locale: Locale) => names.map((n) => isolate(n)).join(locale === 'ar' ? '، ' : ', ');

/** "20% off" / "5,000 IQD off" / "Buy one, get one free": the deal's value, in the guest's language. */
export function dealValueText(deal: Pick<Deal, 'type' | 'value'>, t: T, locale: Locale): string {
  const v = dealValue(deal);
  if (v.kind === 'free') {
    return v.percent >= 100
      ? t('loyalty.guest.deals.bogoShort')
      : t('loyalty.guest.deals.bogoShortPercent', { percent: pct(v.percent, locale) });
  }
  return v.kind === 'percent'
    ? t('loyalty.guest.deals.percentOff', { percent: pct(v.percent, locale) })
    : t('loyalty.guest.deals.amountOff', { amount: isolate(formatIQD(v.iqd, locale)) });
}

/**
 * The one line under a deal's name: the owner's own line, or what the deal is in words ("Buy
 * Latte, get Croissant free", "On Hot drinks", "On your whole café bill").
 */
export function dealHeadline(deal: Deal, t: T, locale: Locale): string {
  const blurb = dealBlurb(deal, locale);
  if (blurb) return blurb;
  const v = dealValue(deal);
  if (v.kind === 'free') {
    const get = list(deal.look.get.map((g) => pickText(g.name_en, g.name_ar, locale)), locale);
    const buy = list(deal.look.buy.map((b) => pickText(b.name_en, b.name_ar, locale)), locale);
    const free = v.percent >= 100;
    if (!buy) {
      return free
        ? t('loyalty.guest.deals.courtGet', { get })
        : t('loyalty.guest.deals.courtGetPercent', { get, percent: pct(v.percent, locale) });
    }
    return free
      ? t('loyalty.guest.deals.bogo', { buy, get })
      : t('loyalty.guest.deals.bogoPercent', { buy, get, percent: pct(v.percent, locale) });
  }
  const cover = dealCover(deal, locale);
  const on =
    cover.names.length === 0
      ? t('loyalty.guest.deals.wholeBill')
      : t(cover.more ? 'loyalty.guest.deals.coversMore' : 'loyalty.guest.deals.covers', {
          names: list(cover.names, locale),
        });
  return deal.on.courts ? `${on}. ${t('loyalty.guest.deals.withCourt')}` : on;
}

/** One fact for the sheet: what it is, and its value. */
export interface DealFact {
  key: string;
  label: string;
  value: string;
}

/** Everything a deal's sheet says about when and how often it can be used. */
export function dealFacts(
  deal: Deal,
  ctx: { t: T; locale: Locale; tz: string; pickedUntil: string | null; points12m: number },
): DealFact[] {
  const { t, locale, tz } = ctx;
  const facts: DealFact[] = [];
  const v = dealValue(deal);
  if (v.kind === 'free') {
    facts.push({
      key: 'buy',
      label: t('loyalty.guest.deals.buy'),
      value:
        deal.look.buy.length > 0
          ? list(deal.look.buy.map((b) => pickText(b.name_en, b.name_ar, locale)), locale)
          : t('loyalty.guest.deals.aCourt'),
    });
    facts.push({
      key: 'get',
      label: t('loyalty.guest.deals.get'),
      value: `${list(deal.look.get.map((g) => pickText(g.name_en, g.name_ar, locale)), locale)} · ${
        v.percent >= 100
          ? t('loyalty.guest.deals.free')
          : t('loyalty.guest.deals.percentOff', { percent: pct(v.percent, locale) })
      }`,
    });
    if (deal.look.per_bill !== null && deal.look.per_bill > 1) {
      facts.push({
        key: 'per-bill',
        label: t('loyalty.guest.deals.perBill'),
        value: isolateLtr(formatNumber(deal.look.per_bill, locale)),
      });
    }
  }
  const schedule = dealSchedule(deal);
  facts.push({
    key: 'days',
    label: t('loyalty.guest.deals.days'),
    value:
      schedule.weekdays.length > 0
        ? schedule.weekdays
            .map((d) => formatWeekdayShort(weekdayInstant(d), locale, 'UTC'))
            .join(locale === 'ar' ? '، ' : ', ')
        : t('loyalty.guest.deals.everyDay'),
  });
  facts.push({
    key: 'hours',
    label: t('loyalty.guest.deals.hours'),
    value: schedule.hours
      ? formatTimeRangeShort(clockInstant(schedule.hours.from), clockInstant(schedule.hours.to), locale, 'UTC')
      : t('loyalty.guest.deals.allDay'),
  });
  facts.push({
    key: 'until',
    label: t('loyalty.guest.deals.until'),
    value: deal.ends_at ? formatDateTime(new Date(deal.ends_at), locale, tz) : t('loyalty.guest.deals.noEnd'),
  });
  if (deal.min_spend_iqd !== null) {
    facts.push({
      key: 'min',
      label: t('loyalty.guest.deals.minSpend'),
      value: isolate(formatIQD(deal.min_spend_iqd, locale)),
    });
  }
  const left = usesLeft(deal);
  facts.push({
    key: 'uses',
    label: t('loyalty.guest.deals.uses'),
    value:
      left === null || deal.per_customer === null
        ? t('loyalty.guest.deals.usesUnlimited')
        : t('loyalty.guest.deals.usesOf', {
            count: isolateLtr(formatNumber(left, locale)),
            total: isolateLtr(formatNumber(deal.per_customer, locale)),
          }),
  });
  facts.push({
    key: 'card',
    label: t('loyalty.guest.deals.card'),
    value: deal.tier
      ? t('loyalty.guest.deals.needs', { tier: isolate(tierName(deal.tier, locale)) })
      : t('loyalty.guest.deals.anyCard'),
  });
  const needed = dealPointsNeeded(deal, ctx.points12m);
  if (needed !== null) {
    facts.push({
      key: 'needed',
      label: t('loyalty.guest.next.toGo'),
      value: isolateLtr(formatNumber(needed, locale)),
    });
  }
  if (deal.picked && ctx.pickedUntil) {
    facts.push({
      key: 'held',
      label: t('loyalty.guest.deals.heldUntil'),
      value: formatDateTime(new Date(ctx.pickedUntil), locale, tz),
    });
  }
  return facts;
}

