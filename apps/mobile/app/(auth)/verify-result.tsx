import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { useOwnProfile } from '../../src/features/profile/hooks';
import { getPendingSlot } from '../../src/features/booking/pendingSlot';
import { usePostAuthContinue } from '../../src/features/booking/usePostAuthContinue';
import { brand, radius, useTheme } from '../../src/theme';
import { Button, Screen } from '../../src/components/ui';
import { CheckIcon } from '../../src/components/icons';
import { formatTime } from '@touch/i18n';

/**
 * Verified (design 2026-08-31): the green-check moment after the emailed link
 * lands a session. Continue resumes the pending slot (hold -> Review) or goes
 * to the tabs. Reached from verify-email's session effect.
 */
export default function VerifyResultScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const pending = getPendingSlot();

  const name = profile.data?.full_name?.split(/\s+/)[0] ?? '';
  const pendingLabel = pending
    ? `${pickLocale({ en: pending.courtNameEn, ar: pending.courtNameAr }, locale)} · ${formatTime(
        new Date(pending.startAt),
        locale,
      )}`
    : '';

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: 28,
          paddingEnd: 28,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 20,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.pill,
            backgroundColor: brand.green,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckIcon size={30} color={brand.greenInk} strokeWidth={3} />
        </View>
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 22,
            textTransform: 'uppercase',
            color: colors.ink,
            marginTop: 18,
            textAlign: 'center',
          }}
        >
          {t('auth.verifiedTitle')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 13,
            lineHeight: 21,
            color: colors.mut,
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          {t('auth.verifiedBody', { name })}
          {pending ? ` ${t('auth.verifiedPending', { label: pendingLabel })}` : ''}
        </Text>
        <Button
          label={t('auth.continueCta')}
          onPress={continueAfterAuth}
          busy={holdBusy}
          variant="primary"
          style={{ marginTop: 22, alignSelf: 'stretch' }}
        />
      </View>
    </Screen>
  );
}
