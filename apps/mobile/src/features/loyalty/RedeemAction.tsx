import { View } from 'react-native';
import { formatDateTime } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button } from '../../components/ui';
import { CheckIcon } from '../../components/icons';
import { brand, space, useTheme } from '../../theme';

/**
 * Redeem on a free drink or a card gift (Majed, 2026-11-15: "a redeem now button, not go ask the
 * cashier for it"). Before the press: Redeem. After it: a check, until when the press holds (the
 * next bill a till opens frees it; a court hour comes off a booking at the desk), and Show code,
 * which brings the member code into view. The press itself is `useClaimCardReward`'s.
 */
export function RedeemAction({
  testID,
  claimedUntil,
  court,
  tz,
  busy,
  disabled,
  onRedeem,
  onShowCode,
  onGreen,
}: {
  /** `<…>.redeem`; the button takes `${testID}`, Show code `${testID}-show`, the line `${testID}-held`. */
  testID: string;
  /** When the press ends; null before it. */
  claimedUntil: string | null;
  /** A court-hour gift: it comes off a booking at the desk. */
  court?: boolean;
  tz: string;
  busy?: boolean;
  disabled?: boolean;
  onRedeem: () => void;
  onShowCode: () => void;
  /** On the birthday's Padel Green ground: a blue button and navy words, so neither vanishes. */
  onGreen?: boolean;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  if (!claimedUntil) {
    return (
      <Button
        testID={testID}
        label={t('loyalty.guest.redeem.button')}
        variant={onGreen ? 'primary' : 'cta'}
        size="compact"
        busy={busy}
        disabled={disabled || busy}
        onPress={onRedeem}
      />
    );
  }
  const time = formatDateTime(new Date(claimedUntil), locale, tz);
  const ink = onGreen ? brand.navy : colors.gtext;
  return (
    <View style={{ gap: space.s }}>
      <View
        testID={`${testID}-held`}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}
      >
        <View style={{ height: 18, justifyContent: 'center' }}>
          <CheckIcon size={15} color={ink} strokeWidth={2.6} />
        </View>
        <Text
          style={{ flex: 1, fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 18, color: ink }}
        >
          {t(court ? 'loyalty.guest.redeem.heldCourt' : 'loyalty.guest.redeem.held', { time })}
        </Text>
      </View>
      {court ? null : (
        <Button
          testID={`${testID}-show`}
          label={t('loyalty.guest.redeem.showCode')}
          variant="primary"
          size="compact"
          onPress={onShowCode}
        />
      )}
    </View>
  );
}
