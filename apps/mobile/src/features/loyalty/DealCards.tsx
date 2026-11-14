import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { Deal, MyDeals } from '@touch/core/loyalty';
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
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button, Hint, MicroLabel } from '../../components/ui';
import { CheckIcon, LockIcon } from '../../components/icons';
import { radius, space, useTheme } from '../../theme';
import { TierChip } from './cardParts';
import {
  clockInstant,
  dealBlurb,
  dealCover,
  dealName,
  dealPointsNeeded,
  dealSchedule,
  dealValue,
  usesLeft,
  weekdayInstant,
} from './deals';
import { tierName } from './logic';

type T = (key: MessageKey, params?: TParams) => string;

/** "20% off" / "5,000 IQD off": the deal's value, in the guest's language. */
export function dealValueText(deal: Pick<Deal, 'type' | 'value'>, t: T, locale: Locale): string {
  const v = dealValue(deal);
  return v.kind === 'percent'
    ? t('loyalty.guest.deals.percentOff', {
        percent: isolateLtr(`${formatNumber(v.percent, locale)}%`),
      })
    : t('loyalty.guest.deals.amountOff', { amount: isolate(formatIQD(v.iqd, locale)) });
}

/** What the deal takes money off, said when the owner wrote no line of their own. */
function coverText(deal: Deal, t: T, locale: Locale): string {
  const cover = dealCover(deal, locale);
  if (cover.names.length === 0) return t('loyalty.guest.deals.wholeBill');
  const names = cover.names.map((n) => isolate(n)).join(locale === 'ar' ? '، ' : ', ');
  return t(cover.more ? 'loyalty.guest.deals.coversMore' : 'loyalty.guest.deals.covers', { names });
}

/** One fact of a deal: what it is at the reading start, its value at the end. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
      <Text style={{ flexGrow: 1, fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
        {label}
      </Text>
      <Text
        style={{
          flexShrink: 1,
          fontFamily: fonts.body700,
          fontSize: 12.5,
          lineHeight: 18,
          color: colors.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/** The small word at the top of a card that says where the deal stands. */
function StateTag({
  tone,
  label,
  icon,
}: {
  tone: 'on' | 'wait' | 'quiet';
  label: string;
  icon?: 'check';
}) {
  const { colors, fonts } = useTheme();
  const look = {
    on: { bg: colors.card, line: colors.gline, fg: colors.gtext },
    wait: { bg: colors.amb, line: colors.ambline, fg: colors.ambtext },
    quiet: { bg: colors.sub, line: colors.line, fg: colors.mut },
  }[tone];
  const Icon = icon === 'check' ? CheckIcon : null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: look.line,
        backgroundColor: look.bg,
        paddingVertical: 4,
        paddingHorizontal: 9,
      }}
    >
      {Icon ? <Icon size={12} color={look.fg} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: look.fg }}>{label}</Text>
    </View>
  );
}

interface DealCardProps {
  /** `<route>`; the card takes `${testID}.deal.<id>`, its actions `.deal-use.<id>`, `.deal-show.<id>`, `.deal-clear.<id>`. */
  testID: string;
  deal: Deal;
  /** When the pick lapses (the picked card says until when it stays on the member card). */
  pickedUntil: string | null;
  /** The member's points in the last 12 months, for what a locked deal's card still needs. */
  points12m: number;
  tz: string;
  /** The id being picked right now, `null` while the pick is being cleared, `undefined` when idle. */
  pending: string | null | undefined;
  onUse: (id: string) => void;
  onShowCard: () => void;
  onClear: () => void;
}

/**
 * One deal (0410). The value is the biggest thing on it, then its name, then the owner's line or,
 * without one, what the deal covers; under a hairline, only the limits it actually has (days,
 * hours, an end, a minimum bill, uses left).
 *
 *   open    "Use at the cashier": picks it and takes the guest to their member card. A deal
 *           outside its hours can still be picked for later; it says "Not right now".
 *   picked  the green card: "Show my card", and a quiet way to take it off the card
 *   locked  the card it needs (its chip, its name, a lock) and the points still to go; nothing
 *           to press
 *   used    marked used; nothing to press
 */
function DealCard({
  testID,
  deal,
  pickedUntil,
  points12m,
  tz,
  pending,
  onUse,
  onShowCard,
  onClear,
}: DealCardProps) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const points = (n: number) => isolateLtr(formatNumber(n, locale));

  const open = deal.state === 'open';
  const picked = open && deal.picked;
  const dimmed = !open;
  const blurb = dealBlurb(deal, locale);
  const schedule = dealSchedule(deal);
  const left = usesLeft(deal);
  const needed = dealPointsNeeded(deal, points12m);
  const busy = pending !== undefined;

  const tag = picked ? (
    <StateTag tone="on" icon="check" label={t('loyalty.guest.deals.picked')} />
  ) : deal.state === 'used' ? (
    <StateTag tone="quiet" label={t('loyalty.guest.deals.used')} />
  ) : open && !deal.live_now ? (
    <StateTag tone="wait" label={t('loyalty.guest.deals.notNow')} />
  ) : null;

  const facts: ReactNode[] = [];
  if (schedule.weekdays.length > 0) {
    facts.push(
      <Fact key="days" label={t('loyalty.guest.deals.days')}>
        {schedule.weekdays
          .map((d) => formatWeekdayShort(weekdayInstant(d), locale, 'UTC'))
          .join(locale === 'ar' ? '، ' : ', ')}
      </Fact>,
    );
  }
  if (schedule.hours) {
    facts.push(
      <Fact key="hours" label={t('loyalty.guest.deals.hours')}>
        {formatTimeRangeShort(
          clockInstant(schedule.hours.from),
          clockInstant(schedule.hours.to),
          locale,
          'UTC',
        )}
      </Fact>,
    );
  }
  if (deal.ends_at) {
    facts.push(
      <Fact key="until" label={t('loyalty.guest.deals.until')}>
        {formatDateTime(new Date(deal.ends_at), locale, tz)}
      </Fact>,
    );
  }
  if (deal.min_spend_iqd !== null) {
    facts.push(
      <Fact key="min" label={t('loyalty.guest.deals.minSpend')}>
        {isolate(formatIQD(deal.min_spend_iqd, locale))}
      </Fact>,
    );
  }
  if (left !== null && deal.state !== 'used') {
    facts.push(
      <Fact key="left" label={t('loyalty.guest.deals.usesLeft')}>
        {points(left)}
      </Fact>,
    );
  }
  if (needed !== null) {
    facts.push(
      <Fact key="needed" label={t('loyalty.guest.next.toGo')}>
        {points(needed)}
      </Fact>,
    );
  }
  if (picked && pickedUntil) {
    facts.push(
      <Fact key="held" label={t('loyalty.guest.deals.heldUntil')}>
        {formatDateTime(new Date(pickedUntil), locale, tz)}
      </Fact>,
    );
  }

  return (
    <View
      testID={`${testID}.deal.${deal.id}`}
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: picked ? colors.gstrong : colors.line,
        backgroundColor: picked ? colors.gtint : colors.card,
        padding: space.l,
        gap: space.sm,
      }}
    >
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text
            testID={`${testID}.deal-value.${deal.id}`}
            style={{
              flex: 1,
              fontFamily: fonts.display900,
              fontSize: 26,
              lineHeight: 32,
              color: dimmed ? colors.mut : colors.ink,
              fontVariant: ['tabular-nums'],
            }}
          >
            {dealValueText(deal, t, locale)}
          </Text>
          {tag}
        </View>
        <Text style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: colors.ink }}>
          {dealName(deal, locale)}
        </Text>
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}>
          {blurb ?? coverText(deal, t, locale)}
        </Text>
        {deal.on.courts ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}>
            {t('loyalty.guest.deals.withCourt')}
          </Text>
        ) : null}
      </View>

      {deal.state === 'locked' && deal.tier ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <TierChip color={deal.tier.color} width={24} />
          <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13, lineHeight: 19, color: colors.ink }}>
            {t('loyalty.guest.deals.needs', { tier: isolate(tierName(deal.tier, locale)) })}
          </Text>
          <LockIcon size={15} color={colors.mut} />
        </View>
      ) : null}

      {facts.length > 0 ? (
        <View
          style={{
            gap: 5,
            paddingTop: space.sm,
            borderTopWidth: 1,
            borderTopColor: picked ? colors.gline : colors.line,
          }}
        >
          {facts}
        </View>
      ) : null}

      {picked ? (
        <View style={{ gap: 2 }}>
          <Button
            testID={`${testID}.deal-show.${deal.id}`}
            label={t('loyalty.guest.deals.showCard')}
            variant="primary"
            size="medium"
            disabled={busy}
            onPress={onShowCard}
          />
          <Button
            testID={`${testID}.deal-clear.${deal.id}`}
            label={t('loyalty.guest.deals.clear')}
            variant="ghost"
            busy={pending === null}
            disabled={busy}
            onPress={onClear}
            // A full 44 pt target for the quiet action.
            style={{ minHeight: 44 }}
          />
        </View>
      ) : open ? (
        <Button
          testID={`${testID}.deal-use.${deal.id}`}
          label={t('loyalty.guest.deals.use')}
          variant="primary"
          size="medium"
          busy={pending === deal.id}
          disabled={busy}
          onPress={() => onUse(deal.id)}
        />
      ) : null}
    </View>
  );
}

/**
 * The deals section of Points & rewards (0410): the picked deal first, then open, locked, used,
 * as the server orders them. With no deals it draws nothing at all.
 */
export function DealsSection({
  testID,
  deals,
  points12m,
  tz,
  pending,
  onUse,
  onShowCard,
  onClear,
}: Omit<DealCardProps, 'deal' | 'pickedUntil'> & { deals: MyDeals | null | undefined }) {
  const { t } = useLocale();
  if (!deals || deals.deals.length === 0) return null;
  return (
    <View testID={`${testID}.deals`} style={{ gap: space.s, marginTop: space.s }}>
      <View style={{ gap: 0 }}>
        <MicroLabel>{t('loyalty.guest.deals.title')}</MicroLabel>
        <Hint>{t('loyalty.guest.deals.hint')}</Hint>
      </View>
      {deals.deals.map((deal) => (
        <DealCard
          key={deal.id}
          testID={testID}
          deal={deal}
          pickedUntil={deals.picked_until}
          points12m={points12m}
          tz={tz}
          pending={pending}
          onUse={onUse}
          onShowCard={onShowCard}
          onClear={onClear}
        />
      ))}
    </View>
  );
}
