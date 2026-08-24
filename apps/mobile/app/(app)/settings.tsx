import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Locale } from '@touch/i18n';
import { supabase } from '../../src/lib/supabase';
import { signOut } from '../../src/features/auth/api';
import { registerPushToken, type PushRegistrationResult } from '../../src/features/profile/push';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { theme } from '../../src/theme';
import { Button, ErrorText, Hint, Screen, Title } from '../../src/components/ui';

/** Language switcher (writes profiles.preferred_lang), push opt-in, sign-out. */
export default function SettingsScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const [showRestartNote, setShowRestartNote] = useState(false);
  const [pushState, setPushState] = useState<PushRegistrationResult | null>(null);
  const [busyPush, setBusyPush] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPickLocale = async (next: Locale) => {
    if (next === locale) return;
    await setLocale(next);
    // I18nManager.forceRTL applies only after an app restart — tell the user.
    setShowRestartNote(true);
  };

  const onEnablePush = async () => {
    setBusyPush(true);
    setPushState(await registerPushToken());
    setBusyPush(false);
  };

  const onSignOut = async () => {
    try {
      await signOut(supabase);
      router.replace('/(auth)/sign-in');
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    }
  };

  const langChoice = (value: Locale, label: string) => (
    <Text
      onPress={() => void onPickLocale(value)}
      style={[styles.langOption, locale === value && styles.langOptionActive]}
    >
      {label}
    </Text>
  );

  return (
    <Screen>
      <Title>{t('settings.title')}</Title>

      <Text style={styles.groupLabel}>{t('settings.language')}</Text>
      <View style={styles.langRow}>
        {langChoice('en', t('settings.english'))}
        {langChoice('ar', t('settings.arabic'))}
      </View>
      {showRestartNote ? <Hint>{t('settings.rtlRestartNote')}</Hint> : null}

      <Text style={styles.groupLabel}>{t('settings.notifications')}</Text>
      {pushState === 'registered' ? (
        <Hint>{t('settings.pushRegistered')}</Hint>
      ) : pushState === 'denied' || pushState === 'unavailable' ? (
        <Hint>{t('settings.pushUnavailable')}</Hint>
      ) : (
        <Button label={t('settings.enablePush')} onPress={() => void onEnablePush()} busy={busyPush} />
      )}

      <ErrorText>{error}</ErrorText>
      <Button label={t('auth.signOut')} variant="danger" onPress={() => void onSignOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupLabel: { fontSize: 13, fontWeight: '700', color: theme.mutedFg, marginTop: 20 },
  langRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  langOption: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingStart: 14,
    paddingEnd: 14,
    paddingTop: 8,
    paddingBottom: 8,
    color: theme.fg,
    overflow: 'hidden',
  },
  langOptionActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
    color: theme.accentContrast,
  },
});
