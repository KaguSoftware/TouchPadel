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
import { Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dir as dirOf, makeT, type Direction, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { supabase } from '../lib/supabase';
import { LOCALE_KEY } from '../lib/bootPrefs';
import { useReduceMotion } from '../lib/useReduceMotion';
import { addBreadcrumb, captureException } from '../lib/telemetry';
import { ensureFontsLoaded } from '../theme/fonts';
import { rememberLocale } from './lastLocale';

/** The switch crossfade: cover up, one commit, cover down. Skipped under Reduce Motion. */
const FADE_OUT_MS = 120;
const FADE_IN_MS = 180;
/**
 * How long a switch may wait for the target script's faces before committing
 * anyway (they normally preloaded right after first paint). Past this the
 * theme renders system faces and swaps in the brand faces when they register.
 */
const FONT_WAIT_CAP_MS = 1500;

export interface LocaleContextValue {
  locale: Locale;
  /** The layout direction. Every mirrored thing in the app derives from this. */
  dir: Direction;
  t: (key: MessageKey, params?: TParams) => string;
  /**
   * Switch language IN PLACE: a cover fades over the tree, strings + faces +
   * direction change in a single commit, the cover fades away. Persists
   * on-device and writes profiles.preferred_lang when a session exists.
   * Resolves once the new language has been COMMITTED (the cover may still be
   * fading) — but a closure created before the call still holds the old `t`;
   * anything that must speak the new language reads it from the context.
   * Same locale: no-op. A request during a switch is queued (latest wins) and
   * applied when the switch settles.
   */
  setLocale: (locale: Locale) => Promise<void>;
}

/** Read by DirectionRoot and the modals only, so switch ticks re-render nothing else. */
export interface LocaleSwitchValue {
  /** A switch is applying; input is blocked meanwhile. */
  switching: boolean;
  /** The cover's opacity, 0 (clear) → 1 (opaque) → 0. */
  cover: Animated.Value;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  dir: 'ltr',
  t: makeT('en'),
  setLocale: async () => {},
});

const LocaleSwitchContext = createContext<LocaleSwitchValue>({
  switching: false,
  cover: new Animated.Value(0),
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function useLocaleSwitch(): LocaleSwitchValue {
  return useContext(LocaleSwitchContext);
}

function animateTo(value: Animated.Value, toValue: number, duration: number): Promise<void> {
  return new Promise((resolve) => {
    Animated.timing(value, { toValue, duration, useNativeDriver: true }).start(() => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort: a guest may be offline. Retried the next time they switch. */
async function syncProfileLanguage(next: Locale): Promise<void> {
  try {
    // getSession() is a local read; getUser() was a network round-trip that
    // made the language toggle hang offline for the whole fetch timeout.
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from('profiles').update({ preferred_lang: next }).eq('id', uid);
    if (error) throw error;
  } catch (error) {
    captureException(error, { label: 'locale.profileSync', next });
  }
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  /** Resolved by src/lib/bootPrefs.ts BEFORE first paint. */
  initialLocale: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [switching, setSwitching] = useState(false);
  const cover = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  // Re-entrancy guard for the whole window, cover fade-out to settle.
  const inFlight = useRef(false);
  // A switch asked for while one is in flight; applied at settle, latest wins.
  // Its callers are released when that locale commits (or is dropped as
  // already current).
  const queued = useRef<Locale | null>(null);
  const queuedResolvers = useRef<(() => void)[]>([]);
  const mounted = useRef(true);
  // Resolves the in-flight setLocale from the effect that runs AFTER the
  // commit that changed `locale`, so the promise means what it says.
  const committed = useRef<(() => void) | null>(null);

  const setLocale = useCallback(
    async (next: Locale): Promise<void> => {
      if (inFlight.current) {
        queued.current = next;
        return new Promise<void>((resolve) => {
          queuedResolvers.current.push(resolve);
        });
      }
      if (next === localeRef.current) return;
      inFlight.current = true;
      try {
        setSwitching(true);
        addBreadcrumb('locale.switch', { next });
        // Written first and independently of the visual switch, so an app killed
        // mid-fade still comes back in the chosen language. Non-fatal on failure.
        AsyncStorage.setItem(LOCALE_KEY, next).catch((error) =>
          captureException(error, { label: 'locale.persist', next }),
        );
        // Under Reduce Motion the cover goes up at once — an instant opaque
        // cover is still no motion, and only an opaque cover takes touches on
        // iOS (Fabric ignores near-transparent views when hit-testing).
        if (reduceMotionRef.current) cover.setValue(1);
        else await animateTo(cover, 1, FADE_OUT_MS);
        try {
          await Promise.race([ensureFontsLoaded(next), delay(FONT_WAIT_CAP_MS)]);
        } catch (error) {
          captureException(error, { label: 'locale.switchPrep', next });
        }
        if (!mounted.current) return;
        rememberLocale(next);
        void syncProfileLanguage(next);
        await new Promise<void>((resolve) => {
          committed.current = resolve;
          // ONE commit: strings, faces (ThemeProvider), direction (DirectionRoot)
          // and the native header's direction (LocaleDirContext) change here.
          setLocaleState(next);
        });
      } catch (error) {
        // Never strand the user behind the cover.
        captureException(error, { label: 'locale.switch', next });
        cover.setValue(0);
        inFlight.current = false;
        setSwitching(false);
      }
    },
    [cover],
  );

  useEffect(() => {
    const resolve = committed.current;
    if (!resolve) return; // the initial render
    committed.current = null;
    resolve();
    const settle = () => {
      inFlight.current = false;
      setSwitching(false);
      const next = queued.current;
      queued.current = null;
      const waiting = queuedResolvers.current.splice(0);
      const release = () => waiting.forEach((resolve) => resolve());
      if (next && next !== localeRef.current) void setLocale(next).then(release);
      else release();
    };
    if (reduceMotionRef.current) {
      cover.setValue(0);
      settle();
      return;
    }
    void animateTo(cover, 0, FADE_IN_MS).then(settle);
  }, [locale, cover, setLocale]);

  // Never leave a caller awaiting a commit that can no longer happen.
  useEffect(
    () => () => {
      mounted.current = false;
      committed.current?.();
      committed.current = null;
      queuedResolvers.current.splice(0).forEach((resolve) => resolve());
    },
    [],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: dirOf(locale), t: makeT(locale), setLocale }),
    [locale, setLocale],
  );
  const switchValue = useMemo<LocaleSwitchValue>(() => ({ switching, cover }), [switching, cover]);

  return (
    <LocaleContext.Provider value={value}>
      <LocaleSwitchContext.Provider value={switchValue}>{children}</LocaleSwitchContext.Provider>
    </LocaleContext.Provider>
  );
}
