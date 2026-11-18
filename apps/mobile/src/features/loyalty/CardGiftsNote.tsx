import { View } from 'react-native';
import { formatDate, isolate } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { CalendarIcon, CardUpIcon, CourtIcon } from '../../components/icons';
import { radius, space, useTheme } from '../../theme';
import { BIRTH_TZ, birthDateToDate } from '../profile/birthDate';
import { tierName } from './logic';
import type { OpenCardGift } from './extras';
import { RedeemAction } from './RedeemAction';

/**
 * The monthly and card-up gifts open now (0445), on the Club tab under the code: one green row
 * each, ready like everything ready on these screens. A card-up gift welcomes the member to the
 * card they just reached ("Welcome to Touch Padel green"), a monthly one is "Your gift this
 * month"; under it the owner's name for the gift and the day it ends, and where it is taken: the
 * cashier's scan of the member card for an item, a booking at the desk for a free court hour.
 * Each waits for the guest's Redeem (Majed, 2026-11-15), then says until when it holds.
 * A used gift is not offered (`openCardGifts`); with none open it draws nothing.
 */
export function CardGiftsNote({
  testID,
  gifts,
  cardName,
  tz,
  busyId,
  onRedeem,
  onShowCode,
}: {
  /** `<route>.card-gifts`; each row `${testID}.<perkId>`, its button `${testID}.<perkId>.redeem`. */
  testID: string;
  gifts: OpenCardGift[];
  /** The member's card, in their language, for the card-up welcome; null when unread. */
  cardName: string | null;
  tz: string;
  /** The gift whose Redeem is on its way. */
  busyId?: string | null;
  onRedeem: (perkId: string) => void;
  /** Brings the member code into view. */
  onShowCode: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  if (gifts.length === 0) return null;
  const date = (d: string | null) => {
    const at = birthDateToDate(d);
    return at ? isolate(formatDate(at, locale, BIRTH_TZ)) : '';
  };
  return (
    <View testID={testID} style={{ gap: space.s }}>
      {gifts.map((g) => {
        const court = g.target === 'court_hour';
        const Icon = court ? CourtIcon : g.when === 'card_up' ? CardUpIcon : CalendarIcon;
        const title =
          g.when === 'card_up'
            ? cardName
              ? t('loyalty.guest.cardGifts.cardUpTitle', { card: isolate(cardName) })
              : t('loyalty.guest.cardGifts.cardUpTitleNoCard')
            : t('loyalty.guest.cardGifts.monthlyTitle');
        return (
          <View
            key={g.perk_id}
            testID={`${testID}.${g.perk_id}`}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.sm,
              padding: space.m,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.gstrong,
              backgroundColor: colors.gtint,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.card,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon size={17} color={colors.gtext} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.gtext }}>{title}</Text>
              <Text style={{ fontFamily: fonts.display800, fontSize: 16, lineHeight: 22, color: colors.ink }}>
                {tierName(g, locale)}
              </Text>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
                {t(court ? 'loyalty.guest.cardGifts.court' : 'loyalty.guest.cardGifts.items', { date: date(g.until) })}
              </Text>
              <View style={{ marginTop: space.s }}>
                <RedeemAction
                  testID={`${testID}.${g.perk_id}.redeem`}
                  claimedUntil={g.claimedUntil}
                  court={court}
                  tz={tz}
                  busy={busyId === g.perk_id}
                  disabled={!!busyId}
                  onRedeem={() => onRedeem(g.perk_id)}
                  onShowCode={onShowCode}
                />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
