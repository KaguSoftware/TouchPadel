import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Text } from '../src/i18n/text';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isolate, type Locale } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import {
  getPushPermissionState,
  registerPushToken,
  type PushPermissionState,
} from '../src/features/profile/push';
import { useVenueSettings } from '../src/features/availability/hooks';
import { venuePhoneOf } from '../src/features/availability/assemble';
import { callPhone } from '../src/lib/phone';
import { radius, space, useTheme, type AppearancePreference } from '../src/theme';
import { Button, Card, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { BellIcon, GlobeIcon, MoonIcon, PhoneIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';

/**
 * Settings (design 2026-08-31): Appearance (Auto/Light/Dark — app-driven theme,
 * Auto following the device),
 * Language (segmented; the switch applies in place), Notifications (the three
 * permission states render differently), the venue call card, and the version
 * footer. Public route; reached from the signed-in Profile.
 */
export default function SettingsScreen() {
  const { t, locale, setLocale } = useLocale();
  const { colors, fonts, preference, setAppearance } = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useVenueSettings();
  const toast = useToast();

  const [pushState, setPushState] = useState<PushPermissionState>('undetermined');
  const [busyPush, setBusyPush] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPushPermissionState().then((state) => {
      if (!cancelled) setPushState(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPickLocale = async (next: Locale) => {
    // Fades the tree out, flips strings + faces + direction in one commit,
    // fades back in — on this very screen, no reload (LocaleProvider).
    await setLocale(next);
  };

  const onEnablePush = async () => {
    setBusyPush(true);
    const result = await registerPushToken();
    setPushState(
      result === 'registered' ? 'granted' : result === 'denied' ? 'denied' : 'unavailable',
    );
    setBusyPush(false);
  };

  const phone = venuePhoneOf(settings.data);
  const onCall = () => {
    if (!phone) {
      toast(t('settings.phoneUnavailable'), 'info');
      return;
    }
    void callPhone(phone).then((ok) => {
      // Isolated: an RTL paragraph would otherwise reorder the number groups.
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  // Expo Go reports ITS OWN native version; the app's comes from the config.
  const appVersion = Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? '0.0.0';
  const build = isRunningInExpoGo() ? 'dev' : (Application.nativeBuildVersion ?? '0');

  // A plain row: the layout direction (DirectionRoot) puts the icon on the
  // leading side in both languages.
  const groupLabel = (icon: React.ReactNode, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {icon}
      <MicroLabel>{label}</MicroLabel>
    </View>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('settings.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
      >
        {/* Appearance. Bound to the PREFERENCE, not the resolved scheme: under
            Auto on a dark device the control has to read Auto, not Dark. */}
        <Card style={{ padding: space.m }}>
          {groupLabel(<MoonIcon size={13} color={colors.gstrong} />, t('settings.appearance'))}
          <View style={{ marginTop: 8 }}>
            <SegmentedControl<AppearancePreference>
              options={[
                { value: 'automatic', label: t('settings.automatic') },
                { value: 'light', label: t('settings.light') },
                { value: 'dark', label: t('settings.dark') },
              ]}
              value={preference}
              onChange={setAppearance}
            />
          </View>
          {/* Only under Auto: what it follows is not obvious, and a permanent
              line of explanation under a control the user already understands
              is noise. Matches the language card's note. */}
          {preference === 'automatic' ? (
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 11.5,
                lineHeight: 17,
                color: colors.fnt,
                marginTop: 8,
              }}
            >
              {t('settings.automaticNote')}
            </Text>
          ) : null}
        </Card>

        {/* Language */}
        <Card style={{ padding: space.m }}>
          {groupLabel(<GlobeIcon size={13} color={colors.gstrong} />, t('settings.language'))}
          <View style={{ marginTop: 8 }}>
            <SegmentedControl<Locale>
              options={[
                { value: 'en', label: t('settings.english') },
                { value: 'ar', label: t('settings.arabic') },
              ]}
              value={locale}
              onChange={(next) => void onPickLocale(next)}
              pinOrder
            />
          </View>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 11.5,
              lineHeight: 17,
              color: colors.fnt,
              marginTop: 8,
            }}
          >
            {t('settings.languageNote')}
          </Text>
        </Card>

        {/* Notifications — three permission states, rendered differently */}
        <Card style={{ padding: space.m }}>
          {groupLabel(<BellIcon size={13} color={colors.gstrong} />, t('settings.notifications'))}
          {pushState === 'granted' ? (
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 12.5,
                color: colors.gtext,
                marginTop: 7,
              }}
            >
              ✓ {t('settings.notifGranted')}
            </Text>
          ) : pushState === 'denied' ? (
            <>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.mut2,
                  marginTop: 7,
                }}
              >
                {t('settings.notifDenied')}
              </Text>
              <Button
                label={t('settings.openSystemSettings')}
                variant="secondary"
                size="compact"
                onPress={() => void Linking.openSettings().catch(() => {})}
                style={{ marginTop: 10 }}
              />
            </>
          ) : pushState === 'unavailable' ? (
            <Hint>{t('settings.pushUnavailable')}</Hint>
          ) : (
            <>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.mut2,
                  marginTop: 7,
                }}
              >
                {t('settings.notifBody')}
              </Text>
              <Button
                label={t('settings.enablePush')}
                variant="cta"
                size="compact"
                busy={busyPush}
                onPress={() => void onEnablePush()}
                style={{ marginTop: 10 }}
              />
            </>
          )}
        </Card>

        {/* Venue */}
        <Card style={{ padding: space.m }}>
          {groupLabel(<PhoneIcon size={13} color={colors.gstrong} />, t('settings.venue'))}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
              gap: 10,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>
                {t('common.appName')}
              </Text>
              {phone ? (
                <Text
                  numberOfLines={1}
                  // Shrink-wrapped to the leading edge (logical, English unchanged):
                  // a digits-only string has no strong character, so iOS's natural
                  // alignment would put it on the LEFT of this column in Arabic.
                  style={{
                    alignSelf: 'flex-start',
                    fontFamily: fonts.body400,
                    fontSize: 12,
                    color: colors.mut,
                    marginTop: 2,
                  }}
                >
                  {phone}
                </Text>
              ) : null}
            </View>
            <Button
              label={t('common.call')}
              variant="primary"
              size="compact"
              disabled={settings.isLoading}
              onPress={onCall}
              style={{
                minHeight: 0,
                paddingTop: 10,
                paddingBottom: 10,
                paddingStart: 18,
                paddingEnd: 18,
                borderRadius: radius.pill,
              }}
            />
          </View>
        </Card>

        <Text
          style={{
            textAlign: 'center',
            fontFamily: fonts.body400,
            fontSize: 11,
            color: colors.fnt2,
            marginTop: 6,
          }}
        >
          {t('settings.versionLine', { name: t('common.appName'), version: appVersion, build })}
        </Text>
      </ScrollView>
    </Screen>
  );
}
