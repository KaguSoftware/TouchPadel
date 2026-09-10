import { View } from 'react-native';
import { Text } from '../src/i18n/text';
import { pickLocale } from '@touch/core';
import { formatTime, isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { useOwnProfile } from '../src/features/profile/hooks';
import { usePendingSlot } from '../src/features/booking/pendingSlot';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { brand, radius, useTheme } from '../src/theme';
import { Button, Screen } from '../src/components/ui';
import { CheckIcon } from '../src/components/icons';

/**
 * A sentinel to split the sentence around its placeholder, written as an
 * ESCAPE and never as a literal NUL byte: a raw 0x00 in the source makes the
 * whole file binary to `file`, to grep, and to every grep-driven sweep over
 * this repo — which is exactly how this screen was skipped by one.
 */
const LABEL_SLOT = '\u0000';

/**
 * Verified (design 2026-08-31): the green-check moment after the emailed link
 * lands a session. Continue resumes the pending slot (hold -> Review) or goes
 * to the tabs. Reached from verify-email's session effect.
 */
export default function VerifyResultScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const pending = usePendingSlot();

  const name = profile.data?.full_name?.split(/\s+/)[0] ?? '';
  const pendingLabel = pending
    ? `${pickLocale({ en: pending.courtNameEn, ar: pending.courtNameAr }, locale)} · ${formatTime(
        new Date(pending.startAt),
        locale,
      )}`
    : '';
  // Design bolds the slot label inside the sentence; split the translated
  // template around a placeholder so the bold span sits where the language puts it.
  const [pendingLead = '', pendingTail = ''] = t('auth.verifiedPending', {
    label: LABEL_SLOT,
  }).split(LABEL_SLOT);

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: 28,
          paddingEnd: 28,
          paddingBottom: 20,
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
          {pending ? (
            <>
              {' '}
              {pendingLead}
              <Text style={{ fontFamily: fonts.body800, color: colors.ink }}>
                {isolate(pendingLabel)}
              </Text>
              {pendingTail}
            </>
          ) : null}
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
