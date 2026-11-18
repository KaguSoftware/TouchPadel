import { View } from 'react-native';
import type { CardExtras } from '@touch/core/loyalty';
import { countPhrase, formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { CupIcon, GiftIcon, StampCardIcon } from '../../components/icons';
import { brand, radius, space, useTheme } from '../../theme';
import { drinkCardView } from './extras';
import { RedeemAction } from './RedeemAction';

/**
 * The drink card (0445): a stamp card, one slot per stamp to a free drink, the free drink's slot
 * last with a gift in it. A slot fills, in Padel Green with a cup, for every drink the guest paid
 * for; the card fills at 8 (the club's standard) or fewer on a card that lowers it (Blue: 6).
 *
 * Full, it turns green and says "Your next drink is on us" with Redeem (Majed, 2026-11-15: a
 * button, not "ask the cashier"); once redeemed, the next bill a till opens frees their dearest
 * stamping drink, and the card says until when and offers Show code. Once a bill carries it, "On
 * your open bill". Hidden while the owner has the drink card off. Every figure is
 * `my_card_extras`'s (`drinkCardView`).
 *
 * The slots fill from the reading start (the row flips in Arabic); the count is a figure, LTR.
 */
export function DrinkCard({
  testID,
  stamps,
  tz,
  busy,
  onRedeem,
  onShowCode,
}: {
  /** `<route>.drink-card`; the slots take `${testID}.slot.<n>`, the state line `${testID}.state`, Redeem `${testID}.redeem`. */
  testID: string;
  stamps: CardExtras['stamps'] | undefined;
  tz: string;
  /** The press is on its way. */
  busy?: boolean;
  /** Redeem the free drink; without it the card shows no button. */
  onRedeem?: () => void;
  /** Brings the member code into view. */
  onShowCode?: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const v = drinkCardView(stamps);
  if (!v) return null;
  const full = v.state !== 'filling';
  const figure = (n: number) => isolateLtr(formatNumber(n, locale));

  const redeemable = (v.state === 'ready' || v.state === 'claimed') && onRedeem && onShowCode;
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: full ? colors.gstrong : colors.line,
        backgroundColor: full ? colors.gtint : colors.card,
        padding: space.l,
        gap: space.sm,
      }}
    >
      {/* The card reads as one sentence; the button below stays its own element. */}
      <View
        accessible
        style={{ gap: space.sm }}
        accessibilityLabel={`${t('loyalty.guest.drinkCard.a11y', { count: figure(v.filled), size: figure(v.size) })}. ${
          v.state === 'ready' || v.state === 'claimed'
            ? t('loyalty.guest.drinkCard.readyTitle')
            : v.state === 'held'
              ? t('loyalty.guest.drinkCard.heldTitle')
              : t('loyalty.guest.drinkCard.toGo', {
                  stamps: countPhrase('loyalty.guest.drinkCard.stamps', v.remaining, locale),
                })
        }`}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <StampCardIcon size={18} color={full ? colors.gtext : colors.ink} />
          <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
            {t('loyalty.guest.drinkCard.title')}
          </Text>
          <Text
            testID={`${testID}.count`}
            style={{
              fontFamily: fonts.display800,
              fontSize: 14,
              color: full ? colors.gtext : colors.ink,
              fontVariant: ['tabular-nums'],
            }}
          >
            {isolateLtr(`${formatNumber(v.filled, locale)} / ${formatNumber(v.size, locale)}`)}
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          {v.rows.map((row, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 6 }}>
              {row.map((stamped, c) => {
                const n = r * (v.rows[0]?.length ?? 0) + c;
                const last = n === v.size - 1;
                return (
                  <View
                    key={n}
                    testID={`${testID}.slot.${n}`}
                    style={{
                      flex: 1,
                      maxWidth: 36,
                      aspectRatio: 1,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      // A stamp is Padel Green in both themes (the green CTA's ground and ink).
                      backgroundColor: stamped ? brand.green : undefined,
                      borderWidth: stamped ? 0 : 1.5,
                      borderStyle: 'dashed',
                      borderColor: last ? colors.gstrong : colors.line,
                    }}
                  >
                    {last ? (
                      <GiftIcon
                        size={14}
                        color={stamped ? brand.navy : colors.gtext}
                        strokeWidth={2}
                      />
                    ) : stamped ? (
                      <CupIcon size={13} color={brand.navy} strokeWidth={2.2} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {full ? (
          <View testID={`${testID}.state`} style={{ gap: 2 }}>
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: 17,
                lineHeight: 23,
                color: colors.ink,
              }}
            >
              {t(
                v.state === 'held'
                  ? 'loyalty.guest.drinkCard.heldTitle'
                  : 'loyalty.guest.drinkCard.readyTitle',
              )}
            </Text>
            {v.state === 'claimed' ? null : (
              <Text
                style={{
                  fontFamily: fonts.body600,
                  fontSize: 12.5,
                  lineHeight: 18,
                  color: colors.gtext,
                }}
              >
                {t(
                  v.state === 'held'
                    ? 'loyalty.guest.drinkCard.heldBody'
                    : 'loyalty.guest.drinkCard.readyBody',
                )}
              </Text>
            )}
          </View>
        ) : (
          <View testID={`${testID}.state`} style={{ gap: 2 }}>
            <Text
              style={{ fontFamily: fonts.body700, fontSize: 13, lineHeight: 19, color: colors.ink }}
            >
              {t('loyalty.guest.drinkCard.toGo', {
                stamps: countPhrase('loyalty.guest.drinkCard.stamps', v.remaining, locale),
              })}
            </Text>
            <Text
              style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 17, color: colors.mut }}
            >
              {t('loyalty.guest.drinkCard.how')}
            </Text>
          </View>
        )}
      </View>
      {redeemable ? (
        <RedeemAction
          testID={`${testID}.redeem`}
          claimedUntil={v.claimedUntil}
          tz={tz}
          busy={busy}
          onRedeem={onRedeem}
          onShowCode={onShowCode}
        />
      ) : null}
    </View>
  );
}
