import { Tabs } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, useTheme } from '../theme';
import { TabBookIcon, TabBookingsIcon, TabProfileIcon } from '../components/icons';

/** Design: 62 pt bar; the home indicator / Android nav bar inset is added below it. */
const TAB_BAR_BASE = 62;

/** Archivo label + the 14×3 green active dot, per the design. */
function TabLabel({ text, focused }: { text: string; focused: boolean }) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text
        style={{
          fontFamily: focused ? fonts.display800 : fonts.display600,
          fontSize: 9.5,
          letterSpacing: tracking(0.57),
          textTransform: 'uppercase',
          color: focused ? colors.blue : colors.fnt2,
        }}
      >
        {text}
      </Text>
      <View
        style={{
          width: 14,
          height: 3,
          borderRadius: radius.pill,
          backgroundColor: focused ? brand.green : 'transparent',
        }}
      />
    </View>
  );
}

/**
 * Bottom tabs per the design: Bookings / Book / Profile, translucent bar
 * floating over the content, Archivo labels, green active icon and dot. expo-router
 * `Tabs` per the native-feel convention — platform behavior (state
 * preservation, back handling) stays native while the visuals follow the
 * design. Screens pad their scroll content with useBottomTabBarHeight().
 *
 * A fixed `height: 86/66` used to ignore the safe-area inset: clipped labels
 * under Android's gesture bar (SDK 54 is edge-to-edge) and a too-tall bar on
 * phones without a home indicator.
 */
export default function TabsLayoutAndroid() {
  const { t } = useLocale();
  const { colors, appearance } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.fnt2,
        tabBarStyle: {
          position: 'absolute',
          // iOS blurs the content behind; Android draws the 95 % tint flat.
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.tabBg,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          elevation: 0,
          height: TAB_BAR_BASE + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 4,
        },
        tabBarBackground:
          Platform.OS === 'ios'
            ? () => (
                <BlurView
                  intensity={40}
                  tint={appearance === 'dark' ? 'dark' : 'light'}
                  style={[StyleSheet.absoluteFill, { backgroundColor: colors.tabBg }]}
                />
              )
            : undefined,
        tabBarItemStyle: { paddingTop: 2 },
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="bookings"
        options={{
          tabBarIcon: ({ focused, color }) => (
            <TabBookingsIcon color={focused ? brand.green : color} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel text={t('tabs.bookings')} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused, color }) => (
            <TabBookIcon color={focused ? brand.green : color} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel text={t('tabs.book')} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused, color }) => (
            <TabProfileIcon color={focused ? brand.green : color} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel text={t('tabs.profile')} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
