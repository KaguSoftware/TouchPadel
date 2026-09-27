/**
 * The smoke suite's global mocks.
 *
 * WHY THEY ARE GLOBAL AND NOT PER-TEST. Almost everything here runs at MODULE
 * SCOPE, on import, before a single component mounts:
 * `app/_layout.tsx` calls `SplashScreen.preventAutoHideAsync()` and
 * `SystemUI.setBackgroundColorAsync()` while its module is being evaluated,
 * `src/lib/supabase.ts` builds a real client with SecureStore storage, and half
 * the gates read `Redirect` from expo-router. A `jest.mock` inside a test file
 * is hoisted within that file, but the setup file runs before any of them — so
 * this is the only place that is reliably earlier than the imports.
 *
 * WHAT IS MOCKED, AND THE RULE. Anything that would reach a native module, the
 * network, or the keychain. NOT the app's own UI: a smoke render is worthless
 * if the thing it renders is a stub, so every component under test is the real
 * one. The two exceptions are named below with their reasons (`Court3D`,
 * `NativeTabs`), and both are drawn by something that does not exist in Node.
 *
 * Mocks that a test needs to STEER read from a mutable holder
 * (`src/test/routerState.ts`, `src/test/authState.ts`) rather than being
 * re-declared per file — see those files for why.
 */
import { jest } from '@jest/globals';
import { webcrypto } from 'node:crypto';
import { createContext, createElement, useEffect, type ReactNode } from 'react';
// react-native's OWN `Text`, not `src/i18n/text` (the restricted-import rule is
// turned off for this file in eslint.config.mjs). The one use below is the
// stand-in for a UIKit tab-bar label, which is not app copy and has no
// paragraph direction to carry — the app's `Text` would drag LocaleProvider
// into a mock that has to work before any provider is mounted.
import { Text, View } from 'react-native';
import { routerState } from './src/test/routerState';
import { authState } from './src/test/authState';

/**
 * THE `mock` PREFIX IS NOT DECORATION.
 *
 * `jest.mock` calls are hoisted above every import in the file, so a factory
 * that closed over an ordinary module-scope binding would throw "not allowed
 * to reference any out-of-scope variables" before a single test ran.
 * babel-plugin-jest-hoist makes ONE exception: a name beginning with `mock`.
 * These aliases are what the factories below are allowed to reach, and they
 * hold the REAL react / react-native pieces each stub is built from — so the
 * stubs render actual host components rather than `jest.requireActual`
 * returning `unknown` inside every factory.
 *
 * They are read when a factory RUNS (on the first `require` of the mocked
 * module, from a test file), long after this module has finished evaluating.
 */
const mockView = View;
const mockText = Text;
const mockH = createElement;
const mockCreateContext = createContext;
const mockUseEffect = useEffect;
const mockRouterState = routerState;
const mockAuthState = authState;

/**
 * The slice of bottom-tabs' screen options the `Tabs` stand-in below reads.
 * Declared HERE, not inside the factory: babel-plugin-jest-hoist treats a
 * parameter name in a function-type annotation as a free variable and refuses
 * the factory, and a type is erased anyway. `Mock`-prefixed for the same
 * reason as the aliases above.
 */
type MockTabOptions = {
  tabBarButton?: (props: Record<string, unknown>) => ReactNode;
  tabBarIcon?: (props: { focused: boolean; color: string; size: number }) => ReactNode;
  tabBarLabel?: (props: { focused: boolean; color: string }) => ReactNode;
};
type MockTabsScreenProps = {
  name: string;
  options?: MockTabOptions | ((info: { route: { name: string } }) => MockTabOptions);
};

// ── expo core ───────────────────────────────────────────────────────────────

jest.mock('expo', () => ({
  // SPREAD, not replaced. `expo` is also where `requireNativeView` lives, and
  // every `@expo/ui` component calls it at module scope — a wholesale stub
  // makes the first import of the country picker throw
  // "requireNativeView is not a function" before any test runs.
  ...jest.requireActual<Record<string, unknown>>('expo'),
  // The app asks this to decide whether Google sign-in and the native Apple
  // button are available. `false` is the shipped build's answer, which is the
  // one worth smoking.
  isRunningInExpoGo: () => false,
}));

// ── expo-router ─────────────────────────────────────────────────────────────

/**
 * Stand-ins for the navigator components.
 *
 * `Stack`, `Tabs` and `NativeTabs` are DECLARATIONS — they describe screens to
 * a navigator that owns the whole app. A smoke test renders ONE screen, not the
 * app, so there is no navigator for them to talk to and nothing they would draw
 * that belongs to the screen under test. `Stack` renders null, which lets a
 * layout file mount and be inspected for everything else it does.
 *
 * `Tabs` renders a little more: each `Tabs.Screen`'s OWN `tabBarButton`, with
 * that screen's `tabBarIcon` and `tabBarLabel` as its children, the way
 * bottom-tabs' BottomTabItem composes them. Nothing here is the app's UI —
 * the button, icon and label render functions all come from the layout file
 * under test (`TabsLayout.android.tsx` puts `tabs.book` on its Pressable), so
 * the smoke case that mounts it asserts on ids app code minted. It does NOT
 * navigate, focus or press: `focused` is `true` for the initial route only.
 *
 * `Redirect` is null for a different reason: it is what a gate returns when a
 * screen must not be shown. A test that renders a gated screen signed-out
 * asserts on the ABSENCE of the screen's ids, and a Redirect that tried to
 * navigate would throw instead of simply rendering nothing.
 */
jest.mock('expo-router', () => {
  const state = mockRouterState;
  const nullRender = (name: string) => {
    const C = () => null;
    C.displayName = name;
    return C;
  };
  const record = (method: string) => (arg?: unknown) => {
    state.calls.push({ method, arg });
  };
  const router = {
    push: record('push'),
    replace: record('replace'),
    navigate: record('navigate'),
    back: record('back'),
    dismissAll: record('dismissAll'),
    canGoBack: () => false,
    setParams: record('setParams'),
  };
  const Stack = nullRender('Stack') as ReturnType<typeof nullRender> & Record<string, unknown>;
  Stack.Screen = nullRender('Stack.Screen');
  const Tabs = ({ children }: { children?: ReactNode }) => mockH(mockView, null, children);
  Tabs.displayName = 'Tabs';
  const TabsScreen = ({ name, options }: MockTabsScreenProps) => {
    const o = (typeof options === 'function' ? options({ route: { name } }) : options) ?? {};
    // `index` is the initial route (app/(tabs)/_layout.tsx unstable_settings).
    const focused = name === 'index';
    const inner = mockH(
      mockView,
      null,
      o.tabBarIcon?.({ focused, color: '#000000', size: 24 }),
      o.tabBarLabel?.({ focused, color: '#000000' }),
    );
    return o.tabBarButton
      ? o.tabBarButton({ children: inner, onPress: () => {}, accessibilityRole: 'button' })
      : inner;
  };
  TabsScreen.displayName = 'Tabs.Screen';
  Tabs.Screen = TabsScreen;
  return {
    Stack,
    Tabs,
    Redirect: nullRender('Redirect'),
    Link: nullRender('Link'),
    router,
    useRouter: () => router,
    useLocalSearchParams: () => state.params,
    useGlobalSearchParams: () => state.params,
    usePathname: () => state.pathname,
    useSegments: () => state.segments,
    // `addListener` returns its own UNSUBSCRIBE. review.tsx registers a
    // `beforeRemove` listener in an effect and calls the return value on
    // cleanup; handing back undefined there is a TypeError on unmount, which
    // would fail every case in afterEach rather than in the test.
    useNavigation: () => ({
      addListener: () => () => {},
      removeListener: () => {},
      setOptions: () => {},
      navigate: record('navigate'),
      goBack: record('back'),
      canGoBack: () => false,
      isFocused: () => true,
    }),
    // The screen under test IS the focused screen, and it never blurs: run the
    // effect once, like a real focus would, and clean it up on unmount.
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockUseEffect(() => cb(), [cb]);
    },
    ThemeProvider: ({ children }: { children: ReactNode }) => children,
    // react-navigation's own theme, which `src/navigation/theme.ts` SPREADS to
    // build the app's. A missing one is `...undefined` inside a `useMemo`, so
    // the root stack throws before it renders anything.
    DefaultTheme: {
      dark: false,
      colors: {
        primary: '#3360AB',
        background: '#FFFFFF',
        card: '#FFFFFF',
        text: '#000000',
        border: '#E4E9F1',
        notification: '#FF3B30',
      },
      fonts: {
        regular: { fontFamily: 'System', fontWeight: '400' },
        medium: { fontFamily: 'System', fontWeight: '500' },
        bold: { fontFamily: 'System', fontWeight: '700' },
        heavy: { fontFamily: 'System', fontWeight: '900' },
      },
    },
    useNavigationContainerRef: () => ({ current: null }),
    // `undefined` = "the root navigator has not mounted". True here (there is
    // no navigator at all), and it is a state the real app passes through on
    // every cold start — `useAuthDeepLink` holds its redirect until it has a
    // key, precisely so a `router.replace` is not swallowed.
    useRootNavigationState: () => undefined,
    useRootNavigation: () => null,
  };
});

jest.mock('expo-router/react-navigation', () => ({
  LocaleDirContext: mockCreateContext('ltr'),
  useNavigation: () => ({ addListener: () => () => {}, setOptions: () => {} }),
}));

jest.mock('expo-router/js-tabs', () => ({
  useBottomTabBarHeight: () => 56,
  BottomTabBarHeightContext: mockCreateContext(56),
}));

/**
 * `NativeTabs` stands in for UIKit, and the stand-in is the ONLY place the
 * iOS tab ids exist.
 *
 * `NativeTabs.Trigger` is configuration for a `UITabBarItem` the system draws
 * outside the React tree — there is no RN node on it, which is why
 * TabsLayout.ios.tsx carries no testID of its own. The mock renders each
 * trigger as a View named after the route it declares, with `index` spelled
 * `book` exactly as Android's own Pressable spells it
 * (TabsLayout.android.tsx), so `tabs.book` means the same thing on both sides.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT: that the layout declares three
 * triggers, for the three expected routes, with the labels the locale gives.
 * It does NOT prove UIKit renders them — nothing running in Node can.
 */
jest.mock('expo-router/unstable-native-tabs', () => {
  const Trigger = ({ name, children }: { name: string; children?: ReactNode }) =>
    mockH(mockView, { testID: `tabs.${name === 'index' ? 'book' : name}` }, children);
  Trigger.displayName = 'NativeTabs.Trigger';
  const Icon = () => null;
  Icon.displayName = 'NativeTabs.Trigger.Icon';
  Trigger.Icon = Icon;
  // A real `Text`, not the bare string: UIKit draws the label, so the real
  // component hands the string straight to the native item — but a loose
  // string under a View is not a text node in a render tree, and
  // `getByText` (which is how a case proves the AR catalog was used) would
  // never find it.
  Trigger.Label = ({ children }: { children?: ReactNode }) => mockH(mockText, null, children);
  const NativeTabs = ({ children }: { children?: ReactNode }) => mockH(mockView, null, children);
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});

// ── expo native modules ─────────────────────────────────────────────────────

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
  setOptions: jest.fn(),
}));

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(() => Promise.resolve()),
  getBackgroundColorAsync: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('expo-navigation-bar', () => ({
  // `useVisibility` is a HOOK, and `ImmersiveInsets` calls it on every render —
  // under the root layout, above everything. Left off this stub it is
  // `undefined()`, which throws inside the one component the whole tree hangs
  // from. `null` is what the real hook reports until the native listener fires
  // a change, which on a normal launch it never does (immersiveInsets.tsx).
  useVisibility: () => null,
  setVisibilityAsync: jest.fn(() => Promise.resolve()),
  setBehaviorAsync: jest.fn(() => Promise.resolve()),
  setStyle: jest.fn(),
  setButtonStyleAsync: jest.fn(() => Promise.resolve()),
}));

/**
 * PINNED to en-AE, never the host's locale.
 *
 * The app picks its first language from the device when there is no stored
 * preference. Left to the real module that answer is whatever machine runs the
 * suite, so the same test would render English on CI and Arabic on a
 * developer's Arabic-configured laptop — and the EN cases would fail there for
 * no reason anyone could see. `renderRoute` passes the locale explicitly; this
 * just makes the fallback deterministic.
 */
jest.mock('expo-localization', () => ({
  getLocales: () => [
    { languageTag: 'en-AE', languageCode: 'en', regionCode: 'AE', textDirection: 'ltr' },
  ],
  getCalendars: () => [{ timeZone: 'Asia/Baghdad' }],
  locale: 'en-AE',
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  WHEN_UNLOCKED: 'whenUnlocked',
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

/**
 * react-native-screens, reduced to what the app reads from it in a render.
 *
 * `react-native-screens/mock` was named here for months and never resolved —
 * the package (4.x) ships no such entry, and the factory was never RUN because
 * nothing a smoke case mounted imported the module. `TabsLayout.android.tsx`
 * does (`ScreenContext` + `InnerScreen`, its stable-order fix), so the stub is
 * now written out: a context nobody provides and a `View` where a native
 * screen would be. Same rule as every other native view here — it occupies
 * its slot and asserts nothing about what the native side would draw.
 */
jest.mock('react-native-screens', () => ({
  ScreenContext: mockCreateContext(mockView),
  InnerScreen: mockView,
  Screen: mockView,
  ScreenContainer: mockView,
  ScreenStack: mockView,
  enableScreens: () => {},
  enableFreeze: () => {},
  screensEnabled: () => true,
}));

/**
 * The library's OWN test mock, which renders its children immediately with a
 * fixed set of insets.
 *
 * The real `SafeAreaProvider` renders NOTHING until a native `onLayout`
 * reports the window — correct on a device, fatal in Node, where that event
 * never arrives. `app/_layout.tsx` mounts it without `initialMetrics` (it has
 * a real window), so a smoke render of the ROOT LAYOUT saw an empty
 * `<RNCSafeAreaProvider />` and nothing beneath it. `renderRoute` can pass
 * metrics for the screens it builds; the layout is the one tree it cannot.
 */
// `.default`: the library ships its mock as a DEFAULT export, and returning
// the module record itself would hand every import `{ default: … }` and an
// undefined `SafeAreaProvider`.
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

// ── visual native views ─────────────────────────────────────────────────────
// Each renders a plain View: the screens under test lay out AROUND them, so
// they must occupy their slot, but nothing about a blur or a gradient is
// assertable in Node.

jest.mock('expo-blur', () => ({ BlurView: mockView }));

jest.mock('expo-linear-gradient', () => ({ LinearGradient: mockView }));

jest.mock('expo-glass-effect', () => ({
  // FALSE, deliberately: it is the answer every device below iOS 26 gives,
  // and it is the branch that has to keep working on all of them.
  isLiquidGlassAvailable: () => false,
  GlassView: mockView,
  GlassContainer: mockView,
}));

jest.mock('expo-symbols', () => ({ SymbolView: mockView }));

// ── device / platform services ──────────────────────────────────────────────

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined', granted: false })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied', granted: false })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));

jest.mock('expo-device', () => ({ isDevice: true, modelName: 'jest', osName: 'iOS' }));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
  nativeBuildVersion: '1',
  applicationId: 'com.touch.padel',
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(() => Promise.resolve('digest')),
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  getRandomBytes: (n: number) => new Uint8Array(n),
  getRandomBytesAsync: (n: number) => Promise.resolve(new Uint8Array(n)),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
}));

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `touchpadel://${path}`,
  openURL: jest.fn(() => Promise.resolve()),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  parse: (url: string) => ({ path: url, queryParams: {} }),
  useURL: () => null,
}));

jest.mock('expo-apple-authentication', () => ({
  // A View, so the testID `AppleButton.ios.tsx` puts on the native control is
  // still findable — that id is the only evidence in a render tree that the
  // Apple path was offered at all.
  AppleAuthenticationButton: mockView,
  AppleAuthenticationButtonType: { CONTINUE: 2, SIGN_IN: 0, SIGN_UP: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2, WHITE: 0, WHITE_OUTLINE: 1 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  signInAsync: jest.fn(() => Promise.resolve({ identityToken: 'token' })),
}));

jest.mock('react-native-nitro-google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    signIn: jest.fn(() => Promise.resolve({ idToken: 'token' })),
    signOut: jest.fn(() => Promise.resolve()),
  },
}));

// ── the app's own edges ─────────────────────────────────────────────────────

/**
 * The Supabase client, stubbed at the module that owns it.
 *
 * The real one builds against SecureStore and opens a websocket the moment a
 * channel is subscribed. Every method a screen can reach on a first render
 * answers here with an empty, successful result — so a query resolves to
 * "nothing yet" rather than hanging, and a screen's loading branch gives way to
 * its empty branch instead of its error branch. `configError: null` because a
 * non-null one makes app/_layout.tsx render the config screen and nothing else.
 */
jest.mock('./src/lib/supabase', () => {
  const ok = () => Promise.resolve({ data: [], error: null });
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: () => Promise.resolve('ok'),
  };
  const query: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lte', 'neq', 'is', 'filter']) {
    query[m] = () => query;
  }
  query.single = () => Promise.resolve({ data: null, error: null });
  query.maybeSingle = () => Promise.resolve({ data: null, error: null });
  query.then = (resolve: (v: unknown) => unknown) => ok().then(resolve);
  return {
    configError: null,
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ subscription: { unsubscribe: () => {} } }),
        signOut: () => Promise.resolve({ error: null }),
      },
      from: () => query,
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
      realtime: { setAuth: () => {} },
    },
    startAuthRefreshLifecycle: () => () => {},
  };
});

/**
 * The auth context, with the session INJECTED rather than fetched.
 *
 * The real provider starts `initializing: true` and only settles after an
 * async `getSession()`. Every gated screen renders a spinner until then, so a
 * test that rendered and asserted in the same tick would find `Loading` and
 * nothing else — and `act()`-ing past it on every case would put a timing
 * question in the middle of a test about layout. The session is a value here,
 * read from `src/test/authState.ts`, so `RequireSession` resolves on the
 * FIRST render and the screen is on screen synchronously.
 */
jest.mock('./src/features/auth/context', () => {
  const state = mockAuthState;
  const Ctx = mockCreateContext<{ session: unknown; initializing: boolean }>({
    session: null,
    initializing: false,
  });
  return {
    AuthProvider: ({ children }: { children: ReactNode }) =>
      mockH(Ctx.Provider, { value: { session: state.session, initializing: false } }, children),
    useAuth: () => ({ session: state.session, initializing: false }),
  };
});

/**
 * Push registration, stubbed at the module that owns it.
 *
 * `src/features/profile/push.ts` reaches expo-notifications and expo-device
 * through `await import(…)` — deliberately, so a guest who never enables
 * notifications never pays for the module. Node's VM cannot do a dynamic
 * import without `--experimental-vm-modules`, so every one of those calls
 * rejects, the app's own telemetry catches it exactly as designed, and the
 * suite prints four `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` errors per
 * run for a failure that exists only in the test environment. Real errors then
 * have somewhere to hide.
 *
 * `undetermined` is the state a fresh install is in, which is the one the
 * Settings screen's "enable notifications" branch is written for.
 */
jest.mock('./src/features/profile/push', () => ({
  startPushRegistrationLifecycle: () => Object.assign(() => {}, { sync: () => {} }),
  installNotificationHandler: () => () => {},
  forgetWrittenPushToken: () => {},
  registerPushToken: () => Promise.resolve('unavailable'),
  unregisterPushTokenLocally: () => Promise.resolve(false),
  getPushPermissionState: () => Promise.resolve('undetermined'),
  permissionStateAfter: () => 'undetermined',
}));

/**
 * The court, replaced by a View.
 *
 * `Court3D` builds a THREE.WebGLRenderer on an `expo-gl` surface and runs a
 * frame loop. There is no GL context in Node and nothing about a rally is
 * assertable from a render tree — but the Book tab lays out AROUND it, so it
 * has to occupy its slot. `book.court-3d` marks where it stood.
 */
jest.mock('./src/components/Court3D', () => ({
  Court3D: ({
    style,
    onUnavailable,
  }: React.ComponentProps<typeof View> & { onUnavailable?: () => void }) => {
    // REPORTS ITSELF UNAVAILABLE, on mount, exactly as the real component does
    // on a device with no GL context. That is not a workaround: in Node there
    // IS no GL, and the branch the Book tab then takes — the flat
    // `CourtIllustration` with the CTA under it — is a real shipped path, the
    // one every device without a working `expo-gl` surface gets. Left silent,
    // the screen waits for a court that is never painted and the CTA (which
    // lives inside Court3D's children, anchored to the measured net) never
    // mounts at all.
    mockUseEffect(() => onUnavailable?.(), [onUnavailable]);
    return mockH(mockView, { testID: 'book.court-3d', style });
  },
}));

// `ulid`'s factory is handed a PRNG by src/lib/idempotency.ts, so it needs no
// crypto of its own — but `expo-crypto` is mocked above and anything reaching
// for the Web Crypto global (react-native-get-random-values' target) finds
// nothing in the RN jest environment. Node's own is equivalent and real.
globalThis.crypto ??= webcrypto as unknown as Crypto;

export {};
