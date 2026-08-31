import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, useTheme } from '../../src/theme';
import { TabBookIcon, TabBookingsIcon, TabProfileIcon } from '../../src/components/icons';

/**
 * Bottom tabs per the design: Book / Bookings / Profile, translucent bar,
 * Archivo labels, green active dot. expo-router `Tabs` per the native-feel
 * convention — platform behavior (state preservation, back handling) stays
 * native while the visuals follow the design.
 */
export default function TabsLayout() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const active = colors.blue;
  const inactive = colors.fnt2;

  const label =
    (text: string) =>
    // eslint-disable-next-line react/display-name
    ({ focused }: { focused: boolean }) => (
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.display800,
            fontSize: 9.5,
            letterSpacing: 0.57,
            textTransform: 'uppercase',
            color: focused ? active : inactive,
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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: active,
        tabBarInactiveTintColor: inactive,
        tabBarStyle: {
          backgroundColor: colors.tabBg,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          // The design's bar is translucent over content; elevation shadows
          // fight that on Android, so keep it flat.
          elevation: 0,
          height: Platform.OS === 'ios' ? 86 : 66,
        },
        tabBarItemStyle: { paddingTop: 8 },
        // Dark bar needs its own blur tint on iOS if we ever add BlurView;
        // the F2-alpha background reads correctly on both platforms as-is.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color }) => <TabBookIcon color={color} />,
          tabBarLabel: label(t('tabs.book')),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          tabBarIcon: ({ color }) => <TabBookingsIcon color={color} />,
          tabBarLabel: label(t('tabs.bookings')),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ color }) => <TabProfileIcon color={color} />,
          tabBarLabel: label(t('tabs.profile')),
        }}
      />
    </Tabs>
  );
}
