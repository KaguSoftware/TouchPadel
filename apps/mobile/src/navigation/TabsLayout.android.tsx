import { forwardRef } from 'react';
import { Tabs } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../i18n/text';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InnerScreen, ScreenContext, type ScreenProps } from 'react-native-screens';
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
 * EVERY TAB SCREEN STAYS WHERE IT IS IN THE NATIVE HIERARCHY — because moving
 * one takes it out of the window, and the Book tab's court dies with that.
 *
 * With detaching turned off (`detachInactiveScreens`, below), bottom-tabs
 * renders each tab as a plain view — hidden with `display: 'none'` when
 * blurred — and gives it `zIndex: isFocused ? 0 : -1` (expo-router's vendored
 * BottomTabView). That zIndex is the problem. Fabric ORDERS siblings by it
 * (sliceChildShadowNodeViewPairs.cpp), so every switch reorders the tabs, and
 * the differ expresses a reorder as REMOVE + INSERT of the screen that moved
 * (Differentiator.cpp) — which, working through the algorithm RN 0.86 runs by
 * default, is always the one being LEFT. Android's `removeViewAt` detaches it
 * from the window, the court's TextureView releases its SurfaceTexture, and
 * expo-gl destroys the GL context with it (GLView.kt,
 * `onSurfaceTextureDestroyed`). Every return to the Book tab then waited for a
 * brand-new context, a new renderer and every shader compiled again before the
 * court could draw — while the page around it was already there (owner,
 * 2026-09-13: "for a really short time the court isn't loaded and the rest of
 * the page is loaded already").
 *
 * react-native-screens strips exactly this zIndex from its NATIVE screens, for
 * exactly this reason (its Screen.tsx, issue #2345), but not from the plain-view
 * branch the tabs take here. This puts the same one line on that branch through
 * `ScreenContext`, the library's own hook for swapping the screen component.
 *
 * Nothing needs the zIndex. A blurred tab is `display: 'none'`, which Fabric maps
 * to `View.INVISIBLE` with a zero-size frame (SurfaceMountingManager.kt), so it
 * neither draws nor takes a touch whatever its order. That holds for as long as
 * tab switches are not animated — with an `animation` on the tabs, two screens
 * are visible at once and the order would matter again.
 */
const StableOrderScreen = forwardRef<View, ScreenProps>(function StableOrderScreen(
  { style, ...rest },
  ref,
) {
  return <InnerScreen {...rest} ref={ref} style={[style, { zIndex: undefined }]} />;
});

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
  // Around the navigator, so every tab screen it renders is a StableOrderScreen.
  return (
    <ScreenContext.Provider value={StableOrderScreen}>
      <AndroidTabs />
    </ScreenContext.Provider>
  );
}

function AndroidTabs() {
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
       * nobody is looking at.
       *
       * NECESSARY, NOT SUFFICIENT. This alone did not keep the surface: the
       * zIndex bottom-tabs puts on each screen reordered them natively on every
       * switch, and a reorder detaches the screen that moved — see
       * StableOrderScreen above, which is the other half. With both, a return to
       * the tab shows the court it left, which is what iOS has always done:
       * `NativeTabs` keeps the surface.
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
        // `alignSelf: 'flex-start'` (not a fixed height): items stretch to fill their
        // row by default, so the pressable's background/ripple box reached down through
        // the `paddingBottom: insets.bottom` strip below and visually merged with the
        // system nav bar. Sizing to content instead keeps it clear of that strip without
        // fighting the bar's own height math.
        tabBarItemStyle: { paddingTop: 2, alignSelf: 'flex-start' },
        // expo-router's BottomTabItem defaults to `android_ripple: { borderless: true }`,
        // an unbounded circular ripple that ignores the tab item's own box — on this
        // absolutely-positioned edge-to-edge bar it painted past the bar into the
        // system nav bar below. A bounded, non-borderless ripple keeps Android's own
        // clipping confined to the pressable's rect instead of a stray circle.
        tabBarButton: (props) => (
          <Pressable {...props} android_ripple={{ borderless: false, color: colors.line }} />
        ),
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
