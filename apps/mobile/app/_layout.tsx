import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/queryClient';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider';
import { AuthProvider } from '../src/features/auth/context';

// Arabic is a first-class locale (bilingual EN/AR, full RTL). forceRTL flips in
// the settings language switcher; RN applies it after an app restart.
I18nManager.allowRTL(true);

function RootStack() {
  const { t } = useLocale();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ title: t('auth.resetPasswordTitle') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <AuthProvider>
          <StatusBar style="auto" />
          <RootStack />
        </AuthProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
