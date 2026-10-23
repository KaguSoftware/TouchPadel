import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, useTheme } from '../theme';
import { tournamentsShipped } from '../features/tournaments/shipped';

// SDK 57 expo-router: `Icon` / `Label` are no longer top-level exports; they hang
// off the trigger.
const { Icon, Label } = NativeTabs.Trigger;

/**
 * iOS bottom tabs backed by the real `UITabBar`, via expo-router's own
 * `NativeTabs`. It renders through `react-native-screens`, which is already
 * compiled into Expo Go, so this needs no dev build — unlike a standalone
 * native tab library, whose view is missing from the Expo Go binary.
 *
 * The system draws the bar, so it picks up the native material (Liquid Glass on
 * iOS 26), scroll-edge behavior, RTL mirroring and iPad layout. Labels still
 * take the design's display face, and the selected tab tints its icon and
 * label with `brand.blue` in light and `brand.green` in dark (owner,
 * 2026-09-27). Not `colors.blue`, which is #FFFFFF in blue mode and would not
 * read as selected. The 14x3 green active dot has no UIKit equivalent and is
 * dropped here. Android keeps the custom bar in
 * `TabsLayout.android.tsx` — that platform split is deliberate.
 *
 * Five tabs since 2026-10-19: My reservations, Play, Book, Club, Coaches. In a build that leaves
 * tournaments out (features/tournaments/shipped.ts, Majed 2026-10-22) Play is `hidden`, which takes
 * it out of the bar and out of navigation altogether, and Ranks (the leaderboard) stands in its
 * place: five tabs either way, so Book stays in the middle. Its short name keeps it the width of
 * Club across from it, so the centre holds (iOS 26 sizes each tab by its label).
 * Profile left the bar on 2026-10-17 (Majed): the account is the avatar on the
 * trailing edge of each tab's title row (components/AccountButton.tsx), a push
 * to `app/profile.tsx`. Club (the member card's QR and the café menu, in SF
 * Symbols' `qrcode`) took the centre on 2026-10-19; Book took it back on
 * 2026-10-22, swapping places with Club (Majed). Book is the initial route
 * (`(tabs)/_layout`). Book keeps its `figure.tennis`; Coaches wears
 * `graduationcap` (lessons) rather than a second player figure, since two tabs
 * in the same glyph read as one. Play wears a padel court (assets/tabs/play*.png,
 * the Android TabPlayIcon drawn out), since SF Symbols has none.
 *
 * NO testIDs HERE, deliberately. `NativeTabs.Trigger` is a CONFIGURATION node,
 * not a view: it describes a `UITabBarItem` that UIKit draws outside the React
 * tree, so there is no RN node to hang an id from and nothing a testID could
 * reach. Android's bar is ordinary Pressables and carries `tabs.bookings` /
 * `tabs.play` / `tabs.book` / `tabs.club` / `tabs.coaches`; the smoke tests
 * see those same five ids through the `expo-router/unstable-native-tabs` mock,
 * which stands in for UIKit (jest.setup.ts explains what that does and does
 * not prove).
 */
export default function TabsLayoutIOS() {
  const { t } = useLocale();
  const { appearance, colors, fonts } = useTheme();
  const selected = appearance === 'dark' ? brand.green : brand.blue;
  // Play while tournaments ship; Ranks in its place while they do not.
  const shipped = tournamentsShipped();

  return (
    <NativeTabs
      blurEffect="systemChromeMaterial"
      minimizeBehavior="onScrollDown"
      labelStyle={{
        default: { fontFamily: fonts.display600, fontSize: 10, color: colors.fnt2 },
        selected: { fontFamily: fonts.display800, fontSize: 10, color: selected },
      }}
      iconColor={{ default: colors.fnt2, selected }}
    >
      <NativeTabs.Trigger name="bookings">
        <Icon sf="calendar" />
        <Label>{t('tabs.bookings')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="play" hidden={!shipped}>
        {/* A padel court, not SF Symbols' `sportscourt` (a football pitch):
            Android's TabPlayIcon drawn to PNGs, tinted by the bar as a template. */}
        <Icon src={require('../../assets/tabs/play.png')} renderingMode="template" />
        <Label>{t('tabs.play')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ranks" hidden={shipped}>
        {/* A podium (Android's TabRanksIcon drawn out), as Play's court: SF Symbols has none. */}
        <Icon src={require('../../assets/tabs/ranks.png')} renderingMode="template" />
        <Label>{t('tabs.ranks')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <Icon sf="figure.tennis" />
        <Label>{t('tabs.book')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="club">
        <Icon sf="qrcode" />
        <Label>{t('tabs.club')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="coaches">
        <Icon sf="graduationcap" />
        <Label>{t('tabs.coaches')}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
