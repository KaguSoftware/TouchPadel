/**
 * `renderRoute` — one screen, under the providers it really ships with.
 *
 * A screen in this app is not a standalone component. It reads its language
 * from `LocaleProvider`, its colours from `ThemeProvider`, its safe-area from
 * `SafeAreaProvider`, its data from a `QueryClient`, its session from
 * `AuthProvider` and its toast from `ToastProvider` — and it MIRRORS because
 * `DirectionRoot` puts a Yoga `direction` on the root. Rendering one without
 * that stack does not test the screen, it tests whether the screen throws on a
 * missing context.
 *
 * So this reproduces app/_layout.tsx's provider tree exactly, minus its chrome:
 * no `RootStack` (the test IS the screen), no `BootOverlay`, no
 * `ConnectivityBanner`, no splash and no font gate — none of which a screen can
 * see, and all of which would put async work between `render()` and the first
 * assertion. `AuthProvider` is jest.setup.ts's injectable stand-in, which is
 * what lets a gated screen resolve on its first render instead of after a
 * spinner (that file explains why).
 *
 * `PersistQueryClientProvider` becomes a plain `QueryClientProvider` with a
 * FRESH client per render: persistence is a disk read, `retry: false` turns a
 * failing fixture into a failing render immediately instead of three seconds
 * later, and a shared client would leak one case's data into the next.
 */
import type { ComponentType } from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { render, type RenderResult } from '@testing-library/react-native';
import type { Locale } from '@touch/i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { DirectionRoot } from '../i18n/direction';
import { ThemeProvider } from '../theme';
import { AuthProvider } from '../features/auth/context';
import { ToastProvider } from '../components/overlays';
import { resetRouterState } from './routerState';
import { setTestSession } from './authState';

/**
 * A real device's insets, so a screen that pads by them lays out as it does on
 * hardware. `initialWindowMetrics` is null under test (there is no window), and
 * a null metrics makes `SafeAreaProvider` wait for an `onLayout` that never
 * comes — every `useSafeAreaInsets()` consumer then renders nothing at all.
 */
const METRICS = initialWindowMetrics ?? {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  // `left` / `right` are PHYSICAL by the safe-area API's own contract — an
  // `EdgeInsets` names the four screen edges, not the four logical ones, and
  // the provider mirrors nothing. Same deliberate exception the hit-slop in
  // components/ui.tsx takes, and both of these are 0 anyway.
  // eslint-disable-next-line no-restricted-syntax
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface RenderRouteOptions {
  locale?: Locale;
  /** What `useLocalSearchParams()` answers — `booking/[id]` needs an `id`. */
  params?: Record<string, string>;
  /** `usePathname()` / `useSegments()`. */
  pathname?: string;
  session?: 'in' | 'out';
  /** Seeded into the fresh QueryClient: `[queryKey, data]` pairs. */
  queryData?: [readonly unknown[], unknown][];
}

export interface SmokeResult extends RenderResult {
  /**
   * The direction the tree actually RESOLVED to, read off the one node that
   * carries it (`app.direction-root`, src/i18n/direction.tsx).
   *
   * Flattened rather than read from `style.direction`: the root's style is a
   * single object today but a screen-level change could make it an array, and
   * an assertion that silently read `undefined` off one would pass for `ltr`
   * on every Arabic case.
   */
  direction: () => string | undefined;
}

export function renderRoute(
  Component: ComponentType<Record<string, never>>,
  {
    locale = 'en',
    params = {},
    pathname = '/',
    session = 'out',
    queryData = [],
  }: RenderRouteOptions = {},
): SmokeResult {
  resetRouterState(params, pathname);
  setTestSession(session);

  const client = new QueryClient({
    defaultOptions: {
      // A smoke render must fail on the first attempt or not at all: with
      // retries a broken fixture spends the whole timeout looking like a
      // loading state.
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  for (const [key, data] of queryData) client.setQueryData(key, data);

  const result = render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider>
            <DirectionRoot>
              <AuthProvider>
                <ToastProvider>
                  <Component />
                </ToastProvider>
              </AuthProvider>
            </DirectionRoot>
          </ThemeProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

  return {
    ...result,
    direction: () => {
      const root = result.getByTestId('app.direction-root');
      const flat = StyleSheet.flatten(root.props.style) as { direction?: string } | undefined;
      return flat?.direction;
    },
  };
}
