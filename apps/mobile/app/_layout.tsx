import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../src/lib/supabase';

// I18n init — Arabic is a first-class locale (HANDOFF: bilingual EN/AR, full RTL).
// TODO(FE1): initialise the active locale from device settings + user preference via
// @touch/i18n once its catalog API is wired here; flipping I18nManager.forceRTL
// requires an app restart — surface that in the language switcher.
I18nManager.allowRTL(true);

export default function RootLayout() {
  useEffect(() => {
    // Supabase session bootstrap stub. Refresh tokens live in expo-secure-store
    // (design-arch.md §4 auth table). Real flow (email+password, email verify,
    // redirect to (auth)/sign-in when signed out): FE1, Drop 1 (design-delivery.md W1).
    void supabase.auth.getSession().then(({ data }) => {
      // TODO: hydrate an auth context / route guard from data.session.
      void data.session;
    });
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Touch Padel' }} />
        <Stack.Screen name="(auth)/sign-in" options={{ title: 'Sign in' }} />
      </Stack>
    </>
  );
}
