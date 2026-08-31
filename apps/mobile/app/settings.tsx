import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import * as Application from 'expo-application';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Locale } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import {
  getPushPermissionState,
  registerPushToken,
  type PushPermissionState,
} from '../src/features/profile/push';
import { useVenueSettings } from '../src/features/availability/hooks';
import { venuePhoneOf } from '../src/features/availability/assemble';
import { radius, space, useTheme, type Appearance } from '../src/theme';
import { Button, Card, Hint, Screen, ScreenHeader, SegmentedControl } from '../src/components/ui';
import { BellIcon, GlobeIcon, MoonIcon, PhoneIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';

/**
 * Settings (design 2026-08-31): Appearance (Light/Dark — app-driven theme),
 * Language (segmented, with the RTL-restart note), Notifications (the three
 * permission states render differently), the venue call card, and the version
 * footer. Public route; reached from the signed-in Profile.
 */
export default function SettingsScreen() {
  const { t, locale, setLocale } = useLocale();
  const { colors, fonts, appearance, setAppearance } = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useVenueSettings();
  const toast = useToast();

  const [showRestartNote, setShowRestartNote] = useState(false);
  const [pushState, setPushState] = useState<PushPermissionState>('undetermined');
  const [busyPush, setBusyPush] = useState(false);

  useEffect(() => {
    void getPushPermissionState().then(setPushState);
  }, []);

  const onPickLocale = async (next: Locale) => {
    if (next === locale) return;
    await setLocale(next);
    // I18nManager.forceRTL applies only after an app restart — tell the user.
    setShowRestartNote(true);
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

  const groupLabel = (icon: React.ReactNode, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {icon}
      <Text
        style={{
          fontFamily: fonts.body700,
          fontSize: 11,
          letterSpacing: 0.66,
          textTransform: 'uppercase',
          color: colors.mut,
        }}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader title={t('settings.title')} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40, gap: space.sm }}
        showsVerticalScrollIndicator={false}
      >
        {/* Appearance */}
        <Card style={{ padding: space.m }}>
          {groupLabel(<MoonIcon size={13} color={colors.gstrong} />, t('settings.appearance'))}
          <View style={{ marginTop: 8 }}>
            <SegmentedControl<Appearance>
              options={[
                { value: 'light', label: t('settings.light') },
                { value: 'dark', label: t('settings.dark') },
              ]}
              value={appearance}
              onChange={setAppearance}
            />
          </View>
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
          {showRestartNote ? <Hint>{t('settings.rtlRestartNote')}</Hint> : null}
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
                onPress={() => void Linking.openSettings()}
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
            }}
          >
            <View>
              <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>
                {t('common.appName')}
              </Text>
              {phone ? (
                <Text
                  style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, marginTop: 2 }}
                >
                  {phone}
                </Text>
              ) : null}
            </View>
            <Button
              label={t('common.call')}
              variant="primary"
              onPress={() => {
                if (phone) void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
                else toast(t('errors.network'), 'info');
              }}
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
          {t('settings.versionLine', {
            name: t('common.appName'),
            version: Application.nativeApplicationVersion ?? '0.0.0',
            build: Application.nativeBuildVersion ?? '0',
          })}
        </Text>
      </ScrollView>
    </Screen>
  );
}
