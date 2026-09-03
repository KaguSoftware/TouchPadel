/**
 * App-driven light/dark theming. Settings offers Light / Dark / Auto, so the
 * theme is a stored PREFERENCE that resolves to a scheme — under 'automatic'
 * it follows the device and keeps following it, live. Default light (see
 * bootPrefs); persisted to AsyncStorage; status bar + root background follow
 * the resolved scheme in app/_layout.tsx.
 *
 * TWO VALUES, and the difference is load-bearing. `preference` is what the
 * user picked and what the segmented control shows; `appearance` is what is
 * actually painted and is never 'automatic'. Consumers that branch on the
 * scheme — a native blur tint, the Google button variant, the Apple button —
 * read `appearance`, so none of them has to know this option exists.
 *
 * The initial value arrives as a prop from the boot hook (src/lib/bootPrefs.ts)
 * so the first frame is already the right theme — reading it in an effect here
 * painted a white frame on every cold start of a dark-mode install.
 *
 * A CHANGE CROSSFADES, it does not cut. Every color in the app is a plain hex
 * string read from `palettes[appearance]`, so there is nothing to interpolate:
 * the flip is one commit, and the native chrome that goes with it (status bar,
 * the native header, the tab bar's blur, the system root background) cuts on
 * its own clock regardless. So the switch borrows the language switch's
 * mechanism (src/i18n/LocaleProvider.tsx): an opaque cover fades up in the
 * OUTGOING background, the palette flips beneath it in one commit, and the
 * cover fades away onto the incoming one. Both halves are a fade against a
 * matching backdrop, so what the eye sees is the old theme dissolving into the
 * new — and the native cut happens while the cover hides it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Appearance as NativeAppearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../lib/telemetry';
import { APPEARANCE_KEY } from '../lib/bootPrefs';
import { useReduceMotion } from '../lib/useReduceMotion';
import { useLocale } from '../i18n/LocaleProvider';
import { palettes, fontSets, type Palette, type FontSet } from './tokens';
import { fontsLoaded, subscribeFontsRegistered } from './fonts';
import { deviceAppearance, rememberAppearance, resolveAppearance } from './lastAppearance';
import type { AppearanceName, AppearancePreference } from './lastAppearance';

/** The scheme actually painted. Never 'automatic'. */
export type Appearance = AppearanceName;
/** What the user picked in Settings. */
export type { AppearancePreference } from './lastAppearance';

/**
 * The crossfade. Slower than the language switch's (120/180): that one hides a
 * text swap, this one carries the whole surface from one palette to the other,
 * and a dissolve that reads as a dissolve needs the extra frames.
 */
const FADE_OUT_MS = 160;
const FADE_IN_MS = 240;

export interface ThemeContextValue {
  /**
   * The scheme being painted, 'light' or 'dark' — already resolved, so a
   * consumer branching on it is correct under 'automatic' too.
   */
  appearance: Appearance;
  /** What the user picked: 'light', 'dark' or 'automatic'. For the picker. */
  preference: AppearancePreference;
  /** Persisted; applies behind the crossfade. Same preference: no-op. */
  setAppearance: (next: AppearancePreference) => void;
  /** The active palette — the only color source components should touch. */
  colors: Palette;
  /** Locale-resolved font families (Arabic renders in Cairo throughout). */
  fonts: FontSet;
  /**
   * Letter-spacing guard. Positive tracking visually disconnects the letters of
   * a cursive script, so every uppercase micro-label and button in the app
   * rendered as broken-up Arabic. Returns 0 under Arabic, `px` otherwise.
   */
  tracking: (px: number) => number;
}

/** Read by ThemeFade only, so crossfade ticks re-render nothing else. */
export interface ThemeSwitchValue {
  /** A switch is applying; input is blocked meanwhile. */
  switching: boolean;
  /** The cover's opacity, 0 (clear) → 1 (opaque) → 0. */
  cover: Animated.Value;
  /**
   * What the cover is painted with: the OUTGOING background while it fades up,
   * the incoming one while it fades away. Held apart from `colors` because it
   * has to lag the commit by exactly one phase.
   */
  coverColor: string;
}

const ThemeContext = createContext<ThemeContextValue>({
  appearance: 'light',
  preference: 'light',
  setAppearance: () => {},
  colors: palettes.light,
  fonts: fontSets.latin,
  tracking: (px) => px,
});

const ThemeSwitchContext = createContext<ThemeSwitchValue>({
  switching: false,
  cover: new Animated.Value(0),
  coverColor: palettes.light.bg,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function useThemeSwitch(): ThemeSwitchValue {
  return useContext(ThemeSwitchContext);
}

function animateTo(value: Animated.Value, toValue: number, duration: number): Promise<void> {
  return new Promise((resolve) => {
    Animated.timing(value, { toValue, duration, useNativeDriver: true }).start(() => resolve());
  });
}

export function ThemeProvider({
  children,
  initialAppearance = 'light',
}: {
  children: ReactNode;
  /** The stored PREFERENCE from the boot hook — may be 'automatic'. */
  initialAppearance?: AppearancePreference;
}) {
  const { locale } = useLocale();
  const [preference, setPreferenceState] = useState<AppearancePreference>(initialAppearance);
  // Resolved once for the first frame, then kept in step by the two paths
  // below: an explicit pick, and (under 'automatic') the device flipping.
  const [appearance, setAppearanceState] = useState<Appearance>(() =>
    resolveAppearance(initialAppearance),
  );
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  // Faces that register after mount (a switch's late download) re-render us.
  const [, bump] = useState(0);
  useEffect(() => subscribeFontsRegistered(() => bump((n) => n + 1)), []);
  // A script whose faces are not registered (a failed or still-running
  // download) renders in the system face rather than in a family the OS does
  // not know — per script, so one failed download never costs the other.
  const facesReady = fontsLoaded(locale);

  const [switching, setSwitching] = useState(false);
  // Painted with the outgoing background for the fade-up, then repainted with
  // the incoming one for the fade-away. Never null while the cover is visible.
  // Seeded from the RESOLVED scheme: `initialAppearance` may be 'automatic',
  // which is not a palette.
  const [coverColor, setCoverColor] = useState(
    () => palettes[resolveAppearance(initialAppearance)].bg,
  );
  const cover = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  // Re-entrancy guard for the whole window, cover fade-up to settle.
  const inFlight = useRef(false);
  // A switch asked for while one is in flight; applied at settle, latest wins.
  const queued = useRef<AppearancePreference | null>(null);
  const mounted = useRef(true);
  // Resolves from the effect that runs AFTER the commit that changed
  // `appearance`, so the fade-away starts on a tree that has already repainted.
  const committed = useRef<(() => void) | null>(null);

  // Tell the OS so keyboards, alerts, share sheets and scroll indicators follow
  // the in-app choice (app.config.ts declares userInterfaceStyle 'automatic').
  // Runs on the commit under the cover, so the OS-level cut is hidden too.
  //
  // Under 'automatic' this hands the scheme BACK to the OS (`null`) rather than
  // pinning it. Writing the resolved value would be self-defeating: an override
  // is what `getColorScheme()` then reports, so the app would be following its
  // own echo and would never see the device change again.
  useEffect(() => {
    try {
      NativeAppearance.setColorScheme(preference === 'automatic' ? null : appearance);
    } catch (error) {
      captureException(error, { label: 'theme.nativeScheme' });
    }
  }, [appearance, preference]);

  /**
   * The crossfade, shared by both things that can change the theme: the user
   * picking one, and (under 'automatic') the device flipping underneath us.
   * `nextPreference` is what to store; `nextAppearance` is what to paint.
   */
  const crossfadeTo = useCallback(
    (nextPreference: AppearancePreference, nextAppearance: Appearance, persist: boolean) => {
      if (inFlight.current) {
        queued.current = nextPreference;
        return;
      }
      const samePaint = nextAppearance === appearanceRef.current;
      const samePreference = nextPreference === preferenceRef.current;
      if (samePaint && samePreference) return;
      if (persist) {
        // Written first and independently of the visual switch, so an app
        // killed mid-fade still comes back in the chosen theme. Non-fatal.
        AsyncStorage.setItem(APPEARANCE_KEY, nextPreference).catch((error) =>
          captureException(error, { label: 'theme.persist', next: nextPreference }),
        );
      }
      rememberAppearance(nextPreference);
      // Light → Auto on a light device repaints nothing. Switching Auto off and
      // on again is a real preference change the picker must reflect, but there
      // is no dissolve to run for it — fading an identical image in over itself
      // is a stall, not a transition.
      if (samePaint) {
        setPreferenceState(nextPreference);
        return;
      }
      inFlight.current = true;
      void (async () => {
        try {
          setSwitching(true);
          // Cover the tree in the theme it is WEARING, so the fade-up is
          // invisible and only the flip beneath it reads.
          setCoverColor(palettes[appearanceRef.current].bg);
          // Under Reduce Motion the cover goes up at once — an instant opaque
          // cover is still no motion, and only an opaque cover takes touches on
          // iOS (Fabric ignores near-transparent views when hit-testing).
          if (reduceMotionRef.current) cover.setValue(1);
          else await animateTo(cover, 1, FADE_OUT_MS);
          if (!mounted.current) return;
          await new Promise<void>((resolve) => {
            committed.current = resolve;
            // ONE commit: palette, native scheme, status bar, root background.
            setPreferenceState(nextPreference);
            setAppearanceState(nextAppearance);
          });
        } catch (error) {
          // Never strand the user behind the cover.
          captureException(error, { label: 'theme.switch', next: nextPreference });
          cover.setValue(0);
          inFlight.current = false;
          setSwitching(false);
        }
      })();
    },
    [cover],
  );

  const setAppearance = useCallback(
    (next: AppearancePreference) => {
      crossfadeTo(next, resolveAppearance(next), true);
    },
    [crossfadeTo],
  );

  /**
   * The device flipping while the preference is 'automatic' — Settings, a
   * scheduled sundown, Control Center. Crossfades exactly like a manual pick,
   * so the app never cuts. Not persisted: the stored value is 'automatic'
   * itself, and the scheme is re-derived every launch.
   *
   * The listener is attached unconditionally so it is never missed mid-flight,
   * and reads the preference from the ref: subscribing only under 'automatic'
   * would race a switch that is still behind the cover.
   */
  useEffect(() => {
    const sub = NativeAppearance.addChangeListener(() => {
      if (preferenceRef.current !== 'automatic') return;
      crossfadeTo('automatic', deviceAppearance(), false);
    });
    return () => sub.remove();
  }, [crossfadeTo]);

  useEffect(() => {
    const resolve = committed.current;
    if (!resolve) return; // the initial render
    committed.current = null;
    resolve();
    // The tree underneath is now the NEW theme; repaint the cover to match so
    // it dissolves into the incoming background instead of onto the old one.
    setCoverColor(palettes[appearance].bg);
    const settle = () => {
      inFlight.current = false;
      setSwitching(false);
      const next = queued.current;
      queued.current = null;
      // A pick made during the fade wins, and is re-resolved rather than
      // remembered: a queued 'automatic' must paint the device scheme as it is
      // NOW, which may have moved while the cover was up.
      if (next) {
        crossfadeTo(next, resolveAppearance(next), true);
        return;
      }
      // Nothing queued, but under 'automatic' the device may have flipped
      // while we were mid-fade — the listener drops those (a switch was in
      // flight), so the settled scheme can be one behind. Reconcile here, and
      // do NOT persist it: the stored preference is still 'automatic'.
      if (preferenceRef.current === 'automatic') {
        const live = deviceAppearance();
        if (live !== appearanceRef.current) crossfadeTo('automatic', live, false);
      }
    };
    if (reduceMotionRef.current) {
      cover.setValue(0);
      settle();
      return;
    }
    void animateTo(cover, 0, FADE_IN_MS).then(settle);
  }, [appearance, cover, crossfadeTo]);

  // Never leave a caller awaiting a commit that can no longer happen.
  useEffect(
    () => () => {
      mounted.current = false;
      committed.current?.();
      committed.current = null;
    },
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      preference,
      setAppearance,
      colors: palettes[appearance],
      fonts: !facesReady ? fontSets.system : locale === 'ar' ? fontSets.arabic : fontSets.latin,
      tracking: locale === 'ar' ? () => 0 : (px) => px,
    }),
    [appearance, preference, setAppearance, locale, facesReady],
  );
  const switchValue = useMemo<ThemeSwitchValue>(
    () => ({ switching, cover, coverColor }),
    [switching, cover, coverColor],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ThemeSwitchContext.Provider value={switchValue}>{children}</ThemeSwitchContext.Provider>
    </ThemeContext.Provider>
  );
}
