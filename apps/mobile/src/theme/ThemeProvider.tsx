/**
 * App-driven light/dark theming. Settings offers System / Light / Dark, so the
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
import { Animated, AppState, Appearance as NativeAppearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../lib/telemetry';
import { APPEARANCE_KEY } from '../lib/bootPrefs';
import { useReduceMotion } from '../lib/useReduceMotion';
import { useLocale } from '../i18n/LocaleProvider';
import { palettes, fontSets, type Palette, type FontSet } from './tokens';
import { fontsLoaded } from './fonts';
import { settleAnimation } from './settleAnimation';
import { claimSwitch, isLiveSwitch } from './switchGeneration';
import { onDeviceSchemeChange, onForeground } from './appearanceEvents';
import {
  deviceAppearance,
  rememberAppearance,
  resolveAppearance,
  type AppearancePreference,
} from './lastAppearance';

export type { AppearancePreference };

export type Appearance = 'light' | 'dark';

const FADE_OUT_MS = 120;
const FADE_IN_MS = 180;

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
  /** Brand font families by role — one set of faces, both scripts. */
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
  fonts: fontSets.brand,
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

/**
 * A fade that always settles — see settleAnimation for why that matters here
 * (a system theme change fires while the app is backgrounded, where rAF-driven
 * animations do not advance and this promise would otherwise never resolve).
 */
function animateTo(value: Animated.Value, toValue: number, duration: number): Promise<void> {
  return settleAnimation(
    Animated.timing(value, { toValue, duration, useNativeDriver: true }),
    value,
    toValue,
    duration,
  );
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
  // The stored pick ('automatic' included) and the scheme it paints as. Seeded
  // from the same prop: `initialAppearance` IS the preference, so an automatic
  // install resolves against the device on this first render rather than
  // painting light and correcting itself a frame later.
  const [preference, setPreferenceState] = useState<AppearancePreference>(initialAppearance);
  const [appearance, setAppearanceState] = useState<Appearance>(() =>
    resolveAppearance(initialAppearance),
  );
  // Both mirrored into refs: crossfadeTo and the device listener read them
  // without taking either value as a dependency, which would rebuild the
  // callback mid-fade and re-subscribe the listener on every switch.
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;

  const [switching, setSwitching] = useState(false);
  const cover = useRef(new Animated.Value(0)).current;
  // Starts on the light background rather than the live one: the cover is
  // invisible until a switch paints it (crossfadeTo sets it from the outgoing
  // palette before fading up), so the seed is never what the eye sees.
  const [coverColor, setCoverColor] = useState<string>(
    () => palettes[resolveAppearance(initialAppearance)].bg,
  );
  const reduceMotion = useReduceMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  /** The last value written to the OS, so the same pin is never written twice. */
  const pinned = useRef<string | null>(null);
  // Re-entrancy guard for the whole window, cover fade-out to settle.
  const inFlight = useRef(false);
  // A switch asked for while one is in flight; applied at settle, latest wins.
  const queued = useRef<AppearancePreference | null>(null);
  const mounted = useRef(true);
  /**
   * WHICH SWITCH IS THE LIVE ONE.
   *
   * `animateTo` resolves come what may (settleAnimation's whole point), and a
   * promise already in flight cannot be cancelled — so the tail of an
   * ABANDONED switch still runs. That is the Control Center glitch: the flip
   * arrives while the shade is down, `applyNow` tears the in-flight crossfade
   * down and commits outright, and then the old fade's `.then(settle)` lands
   * anyway. It clears `inFlight` and `switching` unconditionally, so if a new
   * switch had started by then it loses its re-entrancy guard mid-fade and a
   * third can run on top of it — cover stranded up, or cut away over the old
   * palette.
   *
   * Every switch takes a ticket; `applyNow` and each new crossfade burn the
   * previous one. A tail whose ticket is stale does nothing at all.
   */
  const generation = useRef(0);
  // Resolved by the effect that runs AFTER the commit that changed the theme,
  // so the fade only continues once the new palette is actually on screen.
  const committed = useRef<(() => void) | null>(null);
  // Nothing paints under AppRoot until `useFonts` has settled, so this is a
  // constant for the life of a mount — but the crash and config-error screens
  // mount their own provider above it, and those render in the system face
  // rather than in a family the OS does not know.
  const facesReady = fontsLoaded();

  // Tell the OS so keyboards, alerts, share sheets and scroll indicators follow
  // the in-app choice (app.config.ts declares userInterfaceStyle 'automatic').
  // Runs on the commit under the cover, so the OS-level cut is hidden too.
  //
  // Under 'automatic' this hands the scheme BACK to the OS ('unspecified')
  // rather than pinning it. Writing the resolved value would be self-defeating:
  // an override is what `getColorScheme()` then reports, so the app would be
  // following its own echo and would never see the device change again.
  //
  // WRITE-ONCE PER VALUE. `setColorScheme` is not a passive setter: on iOS it
  // assigns `window.overrideUserInterfaceStyle`, which makes the OS post its
  // userInterfaceStyle-did-change notification, and RCTAppearance responds by
  // moving its `_currentColorScheme` and emitting `appearanceChanged` only when
  // that value CHANGED. Writing the same value repeatedly therefore keeps
  // resetting the native module's idea of "current" and can consume the very
  // transition the app is waiting for, so the app stops being told the device
  // flipped. This effect is the ONLY caller — reads never write (see
  // deviceAppearance) — and the guard below keeps it to one write per value.
  useEffect(() => {
    const next = preference === 'automatic' ? 'unspecified' : appearance;
    if (pinned.current === next) return;
    pinned.current = next;
    try {
      // 'unspecified' is the release value, NOT `null`: RN caches the scheme
      // and only re-reads the device for 'unspecified', writing anything else
      // — `null` included — straight into that cache, which is what left the
      // app reporting no scheme at all. It is in the native module's
      // ColorSchemeName but not RN's re-exported TS union, hence the cast.
      NativeAppearance.setColorScheme(next as Appearance);
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
      // Light → System on a light device repaints nothing. Switching System
      // off and on again is a real preference change the picker must reflect,
      // but there is no dissolve to run for it — fading an identical image in
      // over itself is a stall, not a transition.
      if (samePaint) {
        setPreferenceState(nextPreference);
        return;
      }
      inFlight.current = true;
      const ticket = claimSwitch(generation);
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
          // Superseded while the cover was going up — `applyNow` has already
          // committed the right theme and put the cover away. Touching any of
          // it now would undo that, so this switch simply stops existing.
          if (!isLiveSwitch(generation, ticket)) return;
          // Unmounted behind the cover: release the guard rather than returning
          // straight out of it. Leaving `inFlight` true made every later switch
          // queue behind a fade that had already gone away, so a provider that
          // was remounted (the crash screen mounts its own) could never switch
          // again.
          if (!mounted.current) {
            inFlight.current = false;
            return;
          }
          await new Promise<void>((resolve) => {
            committed.current = resolve;
            // ONE commit: palette, native scheme, status bar, root background.
            setPreferenceState(nextPreference);
            setAppearanceState(nextAppearance);
          });
        } catch (error) {
          // Never strand the user behind the cover.
          captureException(error, { label: 'theme.switch', next: nextPreference });
          // Only if we are still the live switch — otherwise the recovery
          // would tear the cover off whatever replaced us.
          if (!isLiveSwitch(generation, ticket)) return;
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
   * Commit a theme with no transition, and tear down anything a stalled switch
   * left behind. Used when there is no one watching (the app is backgrounded),
   * where a crossfade cannot run and would only strand the cover.
   */
  const applyNow = useCallback(
    (nextPreference: AppearancePreference, nextAppearance: Appearance) => {
      // Abandon whatever crossfade is in flight: its remaining awaits resolve
      // regardless, and this ticket makes those tails inert so they cannot
      // reopen the cover or drop the guard over this commit.
      claimSwitch(generation);
      queued.current = null;
      committed.current?.();
      committed.current = null;
      inFlight.current = false;
      cover.setValue(0);
      setSwitching(false);
      rememberAppearance(nextPreference);
      setPreferenceState(nextPreference);
      setAppearanceState(nextAppearance);
    },
    [cover],
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
    // The event's own payload is ignored: `deviceAppearance()` re-reads the
    // scheme through the same path every other caller uses, so the listener and
    // the foreground reconcile can never disagree about what the device says.
    const sub = NativeAppearance.addChangeListener(() => {
      // The branch itself lives in appearanceEvents.ts, as a pure function, so
      // the background/foreground paths are covered by tests instead of by
      // reasoning: a dissolve started while backgrounded cannot advance, would
      // strand the cover, and would block the commit behind it.
      const device = deviceAppearance();
      const action = onDeviceSchemeChange({
        preference: preferenceRef.current,
        device,
        painted: appearanceRef.current,
        appState: AppState.currentState,
      });
      if (action.type === 'apply') applyNow('automatic', action.appearance);
      else if (action.type === 'crossfade') crossfadeTo('automatic', action.appearance, false);
    });
    return () => sub.remove();
  }, [crossfadeTo, applyNow]);

  /**
   * Reconcile on FOREGROUND. The listener above covers a change the OS delivers
   * while we are backgrounded, but it cannot be relied on alone: the event may
   * be coalesced or dropped across a long excursion, and on iOS the scheme can
   * change while the app is suspended and simply be true on return with no
   * event at all. Either way the app would come back painting the old theme
   * with nothing further scheduled to correct it.
   *
   * So on every return to 'active' under 'automatic', read the device and
   * commit if it disagrees. Committing outright rather than crossfading: the
   * change happened off-screen, so there is no transition to show — the app
   * should simply already be in the right theme on the first frame back.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const action = onForeground({
        preference: preferenceRef.current,
        device: deviceAppearance(),
        painted: appearanceRef.current,
        appState: next,
      });
      if (action.type === 'apply') applyNow('automatic', action.appearance);
    });
    return () => sub.remove();
  }, [applyNow]);

  useEffect(() => {
    const resolve = committed.current;
    if (!resolve) return; // the initial render
    committed.current = null;
    resolve();
    // The tree underneath is now the NEW theme; repaint the cover to match so
    // it dissolves into the incoming background instead of onto the old one.
    setCoverColor(palettes[appearance].bg);
    // The switch this fade-away belongs to. `animateTo` always resolves, so
    // without this the tail of a switch that `applyNow` (or a newer pick) has
    // already replaced would still clear the guards belonging to whatever is
    // running now.
    const ticket = generation.current;
    const settle = () => {
      if (!isLiveSwitch(generation, ticket)) return;
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
      fonts: facesReady ? fontSets.brand : fontSets.system,
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
