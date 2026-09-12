import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from '../i18n/text';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, useTheme } from '../theme';
import { TabBookIcon, TabBookingsIcon, TabProfileIcon } from '../components/icons';

/** Design: 62 pt bar; the home indicator / Android nav bar inset is added below it. */
const TAB_BAR_BASE = 62;

/** Display-face label + the 14×3 green active dot, per the design. */
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
 * floating over the content, display-face labels, green active icon and dot. expo-router
 * `Tabs` per the native-feel convention — platform behavior (state
 * preservation, back handling) stays native while the visuals follow the
 * design. Screens pad their scroll content with useBottomTabBarHeight().
 *
 * A fixed `height: 86/66` used to ignore the safe-area inset: clipped labels
 * under Android's gesture bar (edge-to-edge, mandatory since SDK 55) and a too-tall bar on
 * phones without a home indicator.
 */
export default function TabsLayoutAndroid() {
  const { t } = useLocale();
  const { colors, appearance } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      /**
       * THE BLURRED TAB IS HIDDEN, NOT DETACHED — because the Book tab holds a
       * GL surface and detaching it destroys the court.
       *
       * expo-gl's Android view is a `TextureView` whose
       * `onSurfaceTextureDestroyed` calls `glContext.destroy()` (expo-gl
       * GLView.kt), and react-navigation's bottom tabs default
       * `detachInactiveScreens` to true on Android: a blurred tab goes to
       * react-native-screens' activityState 0, its fragment is detached, the
       * SurfaceTexture goes with it and the whole GL context dies. Coming back
       * therefore could not just show the court again — it had to be handed a
       * BRAND NEW context, build a new `THREE.WebGLRenderer` on it and compile
       * and link every shader in the scene before one frame could be drawn,
       * with the stage held at zero through all of it (Court3D's REVEAL_MS
       * note). That is the court blinking out on the way back in (owner,
       * 2026-09-12, Android).
       *
       * With this false the screens stay mounted natively and
       * react-native-screens hides the blurred one with `display: 'none'`,
       * which Fabric maps to `View.INVISIBLE` (SurfaceMountingManager.kt) —
       * still attached to the window, so the SurfaceTexture and the context
       * live, and still skipped by the draw, so nothing is composited for a tab
       * nobody is looking at. The return is then only the entrance fade, which
       * is exactly what iOS has always done: `NativeTabs` keeps the surface, and
       * this is the one platform where the court was paying for the difference.
       *
       * The court's frame loop is gated on router focus, not on this, so a
       * hidden tab still draws nothing and costs no battery. What it does keep
       * is the GL memory — and the Book tab is the initial route, so that was
       * allocated from launch anyway: this holds the peak rather than raising it.
       */
      detachInactiveScreens={false}
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
