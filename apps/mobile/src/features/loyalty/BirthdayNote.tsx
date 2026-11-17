import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDate, isolate } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { ChevronIcon, CourtIcon, GiftIcon } from '../../components/icons';
import { brand, radius, space, useTheme, withAlpha } from '../../theme';
import { BIRTH_TZ, birthDateToDate } from '../profile/birthDate';
import { tierName } from './logic';
import type { BirthdayView } from './extras';
import { RedeemAction } from './RedeemAction';

/**
 * The birthday on the Club tab (0445), one of four lines `birthdayView` picks:
 *
 *   open      the warm banner: Padel Green edge to edge with the navy ink (theme-invariant, like
 *             the green CTA), "Happy birthday", each gift open today by its owner-written name,
 *             and the day it ends (once when every gift ends that day). A free court hour comes
 *             off a booking at the desk, not at the cashier, so the banner says so: in its body
 *             when every open gift is a court hour, under that gift when it sits beside items;
 *   noDate    a quiet row: the card holds a birthday gift and the profile has no date; it opens
 *             Edit profile, where the date is set;
 *   waiting   a quiet line: a date set or changed recently counts from that day;
 *   nextYear  a quiet line: changed too late for this birthday, the next one counts.
 *
 * Draws nothing for `none`. Each open gift waits for the guest's Redeem (Majed, 2026-11-15: a
 * button, not "ask the cashier"); then the cashier's scan of the member card applies it, or the
 * desk takes a court hour off a booking.
 */
export function BirthdayNote({
  testID,
  view,
  onAddDate,
  tz,
  busyId,
  onRedeem,
  onShowCode,
}: {
  /** `<route>.birthday`; the parts take `${testID}.gift.<perkId>` (Redeem `.redeem`), `${testID}.add-date`. */
  testID: string;
  view: BirthdayView;
  /** Opens Edit profile for the date of birth. */
  onAddDate: () => void;
  tz: string;
  /** The gift whose Redeem is on its way. */
  busyId?: string | null;
  /** Redeem one gift; without it the banner shows no buttons. */
  onRedeem?: (perkId: string) => void;
  /** Brings the member code into view. */
  onShowCode?: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const date = (d: string | null) => {
    const at = birthDateToDate(d);
    return at ? isolate(formatDate(at, locale, BIRTH_TZ)) : null;
  };

  if (view.kind === 'none') return null;

  if (view.kind === 'open') {
    const ink = brand.navy;
    const sameEnd = date(view.sameEnd);
    const anyItems = view.gifts.some((g) => g.target === 'items');
    return (
      <View
        testID={testID}
        style={{ borderRadius: 22, overflow: 'hidden', backgroundColor: brand.green, padding: space.l, gap: space.sm }}
      >
        {/* The light a card catches across its face, as the next-card block has. */}
        <LinearGradient
          colors={[withAlpha(brand.white, 0.35), withAlpha(brand.white, 0)]}
          locations={[0, 0.6]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: withAlpha(brand.white, 0.45),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GiftIcon size={22} color={ink} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.display900, fontSize: 24, lineHeight: 30, color: ink }}>
              {t('loyalty.guest.birthday.title')}
            </Text>
            <Text style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: ink }}>
              {t(anyItems ? 'loyalty.guest.birthday.body' : 'loyalty.guest.birthday.bodyCourt')}
            </Text>
          </View>
        </View>
        <View
          style={{
            borderRadius: radius.cell,
            backgroundColor: withAlpha(brand.white, 0.4),
            paddingVertical: space.s,
            paddingHorizontal: space.sm,
            gap: 6,
          }}
        >
          {view.gifts.map((g) => {
            const until = view.sameEnd ? null : date(g.until);
            const court = g.target === 'court_hour';
            const Icon = court ? CourtIcon : GiftIcon;
            return (
              <View
                key={g.perk_id}
                testID={`${testID}.gift.${g.perk_id}`}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}
              >
                <View style={{ height: 20, justifyContent: 'center' }}>
                  <Icon size={14} color={ink} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.body700, fontSize: 14, lineHeight: 20, color: ink }}>
                    {tierName(g, locale)}
                  </Text>
                  {court && anyItems ? (
                    <Text style={{ fontFamily: fonts.body600, fontSize: 12, lineHeight: 17, color: ink }}>
                      {t('loyalty.guest.birthday.courtNote')}
                    </Text>
                  ) : null}
                  {onRedeem && onShowCode ? (
                    <View style={{ marginTop: space.s, marginBottom: 2 }}>
                      <RedeemAction
                        testID={`${testID}.gift.${g.perk_id}.redeem`}
                        claimedUntil={g.claimedUntil}
                        court={court}
                        tz={tz}
                        busy={busyId === g.perk_id}
                        disabled={!!busyId}
                        onRedeem={() => onRedeem(g.perk_id)}
                        onShowCode={onShowCode}
                        onGreen
                      />
                    </View>
                  ) : null}
                </View>
                {until ? (
                  <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: ink }}>
                    {t('loyalty.guest.birthday.until', { date: until })}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
        {sameEnd ? (
          <Text testID={`${testID}.until`} style={{ fontFamily: fonts.body700, fontSize: 12.5, color: ink }}>
            {t('loyalty.guest.birthday.until', { date: sameEnd })}
          </Text>
        ) : null}
      </View>
    );
  }

  if (view.kind === 'noDate') {
    return (
      <Pressable
        testID={`${testID}.add-date`}
        accessibilityRole="button"
        accessibilityHint={t('loyalty.guest.birthday.addDate')}
        onPress={onAddDate}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          padding: space.m,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: pressed ? colors.sub : colors.card,
        })}
      >
        <GiftIcon size={18} color={colors.gtext} strokeWidth={2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.ink }}>
            {t('loyalty.guest.birthday.noDate')}
          </Text>
          <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.gstrong }}>
            {t('loyalty.guest.birthday.addDate')}
          </Text>
        </View>
        <ChevronIcon size={16} color={colors.fnt2} />
      </Pressable>
    );
  }

  // waiting / nextYear: said, not asked.
  const line =
    view.kind === 'waiting'
      ? t('loyalty.guest.birthday.waiting', { date: date(view.countsFrom) ?? '' })
      : t('loyalty.guest.birthday.nextYear');
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s, paddingHorizontal: space.xs }}>
      <View style={{ height: 18, justifyContent: 'center' }}>
        <GiftIcon size={14} color={colors.mut} strokeWidth={2} />
      </View>
      <Text style={{ flex: 1, fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
        {line}
      </Text>
    </View>
  );
}
