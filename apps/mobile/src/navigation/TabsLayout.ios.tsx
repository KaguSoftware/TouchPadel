import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, useTheme } from '../theme';

/**
 * iOS bottom tabs backed by the real `UITabBar`, via expo-router's own
 * `NativeTabs`. It renders through `react-native-screens`, which is already
 * compiled into Expo Go, so this needs no dev build — unlike a standalone
 * native tab library, whose view is missing from the Expo Go binary.
 *
 * The system draws the bar, so it picks up the native material (Liquid Glass on
 * iOS 26), scroll-edge behavior, RTL mirroring and iPad layout. Labels still
 * take the design's Archivo face, and the selected tab tints its icon with the
 * design's green; the 14x3 green active dot has no UIKit equivalent and is
 * dropped here. Android keeps the custom bar in
 * `TabsLayout.android.tsx` — that platform split is deliberate.
 */
export default function TabsLayoutIOS() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();

  return (
    <NativeTabs
      blurEffect="systemChromeMaterial"
      minimizeBehavior="onScrollDown"
      labelStyle={{
        default: { fontFamily: fonts.display600, fontSize: 10, color: colors.fnt2 },
        selected: { fontFamily: fonts.display800, fontSize: 10, color: colors.blue },
      }}
      iconColor={{ default: colors.fnt2, selected: brand.green }}
    >
      <NativeTabs.Trigger name="bookings">
        <Icon sf="calendar" />
        <Label>{t('tabs.bookings')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <Icon sf="figure.tennis" />
        <Label>{t('tabs.book')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf="person.crop.circle" />
        <Label>{t('tabs.profile')}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
