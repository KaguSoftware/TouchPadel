import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dir } from '@touch/i18n';

/**
 * THE NATIVE BAR'S DIRECTION, and the native flag it must never depend on.
 *
 * react-navigation reads the navigation bar's direction from `LocaleDirContext`
 * and hands it to react-native-screens, which sets the navigation controller's
 * semantic direction on iOS (bar, back item + chevron, push/pop edge, back-swipe
 * edge) and the toolbar's layout direction on Android. expo-router's container
 * fills that context from `I18nManager.getConstants().isRTL` — a boot-time
 * constant, and one this app pins LTR — so the root layout provides it from the
 * app's own direction. That is the only supported way to correct it, since
 * expo-router does not expose the container's `direction` prop.
 *
 * The native flag itself is pinned left-to-right on every launch: layout
 * direction is app state (src/i18n/direction.tsx), applied live, and the flag
 * would only add a second, boot-time direction the bundle cannot observe — and,
 * when RTL, make Fabric rewrite every physical left/right for the surface.
 *
 * These are native layout properties, invisible to typecheck and lint, so the
 * tests read the source.
 */

const ROOT = join(__dirname, '..', '..', '..');
const LAYOUT = readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8');
const CONFIG = readFileSync(join(ROOT, 'app.config.ts'), 'utf8');
const ENTRY = readFileSync(join(ROOT, 'index.js'), 'utf8');
const PIN = readFileSync(join(ROOT, 'src', 'i18n', 'nativeDirection.ts'), 'utf8');

function walk(d: string, out: string[] = []): string[] {
  for (const name of readdirSync(d)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|js)$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src')), join(ROOT, 'index.js')];
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
/** Code only: the design is explained in comments that name the very tokens the tests forbid. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (f: string) => stripComments(readFileSync(f, 'utf8'));

describe('navigation bar direction', () => {
  it('provides LocaleDirContext around the stack', () => {
    // Without the provider the context falls back to its 'ltr' default and the
    // Arabic bar mirrors the wrong way.
    expect(LAYOUT).toContain('LocaleDirContext.Provider');
    // SDK 56+: react-navigation is vendored by expo-router; the bare package
    // is no longer resolvable from app code.
    expect(LAYOUT).toContain("from 'expo-router/react-navigation'");
  });

  it('drives the direction from the app locale, not the native RTL flag', () => {
    // Fed through `useNativeBarDirection`, which is `useLocale().dir` held back
    // one commit across a switch so the back chevron is rebuilt under it (see
    // the "back chevron" suite below). Still the app's own direction, never the
    // native RTL flag.
    expect(LAYOUT).toMatch(/<LocaleDirContext\.Provider value=\{barDir\}>/);
    expect(LAYOUT).toMatch(
      /const \{ direction: barDir, rebuilding \} = useNativeBarDirection\(\);/,
    );
    const bar = readFileSync(join(ROOT, 'src', 'navigation', 'headerDirection.ts'), 'utf8');
    expect(bar).toMatch(/const \{ dir \} = useLocale\(\);/);
  });

  it('wraps the Stack, so every screen header inherits it', () => {
    const open = LAYOUT.indexOf('<LocaleDirContext.Provider');
    const stack = LAYOUT.indexOf('<Stack screenOptions=');
    const close = LAYOUT.indexOf('</LocaleDirContext.Provider>');
    expect(open).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(stack);
  });
});

describe('navigation bar interface style', () => {
  /**
   * react-navigation keeps a theme of its own. `useHeaderConfigProps` reads its
   * `dark` flag and sends it to react-native-screens, which applies it as
   * `navigationBar.overrideUserInterfaceStyle` — and THAT, not
   * `headerTintColor`, is what decides how UIKit draws the back item's chevron
   * and label. expo-router's container hardcodes `DefaultTheme` (`dark: false`)
   * with no prop to change it, so dark mode drew a light bar's chevron
   * (invisible on our ground) and a black title until the theme was provided
   * again inside the container.
   */
  it('provides a navigation theme around the stack', () => {
    expect(LAYOUT).toContain('NavigationThemeProvider');
    expect(LAYOUT).toMatch(/<NavigationThemeProvider value=\{navTheme\}>/);
  });

  it('wraps the Stack, so every screen header inherits it', () => {
    const open = LAYOUT.indexOf('<NavigationThemeProvider');
    const stack = LAYOUT.indexOf('<Stack screenOptions=');
    const close = LAYOUT.indexOf('</NavigationThemeProvider>');
    expect(open).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(stack);
  });

  it('drives it from the app appearance, not the OS colour scheme', () => {
    const theme = readFileSync(join(ROOT, 'src', 'navigation', 'theme.ts'), 'utf8');
    // The app's theme is a stored preference (no "system" option in Settings),
    // so reading useColorScheme() here would desync the bar from the app.
    expect(theme).toMatch(/dark: appearance === 'dark'/);
    expect(stripComments(theme)).not.toMatch(/useColorScheme/);
  });
});

describe('the back chevron is rebuilt when the language flips', () => {
  /**
   * `applySemanticContentAttributeIfNeededToNavCtrl` mirrors the bar's CONTENTS
   * with `+[UIView appearanceWhenContainedInInstancesOfClasses:]`. UIAppearance
   * only styles a view AS IT ENTERS THE WINDOW, so a chevron already on screen
   * keeps the old direction and disappears on a live switch — until an
   * edge-swipe pops the screen and re-creates it. `headerOptions` therefore
   * drops the back item for one commit so UIKit builds a fresh one.
   *
   * Invisible to typecheck and lint, and easily mistaken for dead code, so it
   * is pinned here.
   */
  const HEADER = readFileSync(join(ROOT, 'src', 'navigation', 'headerOptions.tsx'), 'utf8');
  const BAR = readFileSync(join(ROOT, 'src', 'navigation', 'headerDirection.ts'), 'utf8');

  it('hides the back item while the switch is in flight', () => {
    expect(stripComments(HEADER)).toMatch(/headerBackVisible: rebuilding \? false : undefined/);
  });

  it('starts the rebuild from the direction change itself', () => {
    /**
     * NOT keyed on `switching`. That flag stays raised until LocaleProvider's
     * cover has finished fading back in — 180 ms after the commit — so
     * releasing the back item with it made the chevron pop in visibly late,
     * after the screen was already legible. The rebuild only has to outlast
     * the direction commit, so it is timed from `dir` and lasts two frames.
     */
    const bar = stripComments(BAR);
    expect(bar).toMatch(/\}, \[dir\]\);/);
    expect(bar).not.toMatch(/useLocaleSwitch/);
  });

  it('never depends on the state its own steps write', () => {
    /**
     * THE REGRESSION THIS GUARDS.
     *
     * With `shown` in the dependency list the run cancelled itself: the middle
     * step sets `shown`, that re-ran the effect, and the cleanup killed the
     * pending frame that would have put the item back — so the chevron stayed
     * off the bar permanently. Only a NEW language may interrupt a run.
     */
    const bar = stripComments(BAR);
    expect(bar).not.toMatch(/\[dir, shown\]/);
    expect(bar).not.toMatch(/\[dir, restored\]/);
  });

  it('cannot strand the back item off the bar', () => {
    // `rebuilding` is DERIVED from whether the bar has caught up, not stored
    // as a flag of its own — so there is nothing an interrupted run could
    // leave switched on. Cleanup cancels frames and writes no state, which
    // also keeps it correct on unmount and under StrictMode's double mount.
    const bar = stripComments(BAR);
    expect(bar).toMatch(/rebuilding: dir !== shown \|\| !restored/);
    const cleanup = bar.slice(bar.indexOf('return () => {'), bar.indexOf('}, [dir]'));
    expect(cleanup).not.toMatch(/setShown|setRestored/);
  });

  it('restores it as undefined, never true', () => {
    // `headerBackVisible: true` also turns on `backButtonInCustomView` in
    // useHeaderConfigProps — a different layout from the app's default.
    expect(stripComments(HEADER)).not.toMatch(/headerBackVisible: true/);
  });

  it('asks for the bare chevron, never a titled back item', () => {
    /**
     * `'default'` draws the previous screen's title beside the chevron, and on
     * iOS 26 a TITLED back item is rendered as a Liquid Glass capsule. Once the
     * label is long enough to crowd the bar, UIKit drops the chevron from that
     * capsule — which is how Arabic ("رجوع") became a bordered pill with no
     * arrow. `'minimal'` leaves no label to grow, so there is nothing for UIKit
     * to trade the arrow against.
     */
    const header = stripComments(HEADER);
    expect(header).toMatch(/headerBackButtonDisplayMode: 'minimal'/);
    expect(header).not.toMatch(/headerBackButtonDisplayMode: 'default'/);
    // A back title would reintroduce the capsule even under 'minimal'.
    expect(header).not.toMatch(/headerBackTitle:/);
  });

  it('hands the new direction to native only AFTER the item is hidden', () => {
    /**
     * THE ORDERING THE WHOLE FIX RESTS ON.
     *
     * Removing the item and applying the direction in ONE commit restyles the
     * chevron in place — which UIAppearance cannot do, since it only styles a
     * view as it enters the window. So: the bar trails by a frame, then the
     * item returns a frame after that. Frames rather than microtasks, which
     * would be batched back into the same commit and defeat the whole thing.
     */
    const bar = stripComments(BAR);
    const flip = bar.indexOf('setShown(dir)');
    const back = bar.indexOf('setRestored(true)');
    expect(flip).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(flip);
    // Two nested frames: one before the direction, one before the restore.
    expect(bar.match(/requestAnimationFrame/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('is short enough not to be seen as a late-appearing button', () => {
    // Two frames (~32 ms) from the direction commit, not the 180 ms fade.
    const bar = stripComments(BAR);
    expect(bar).not.toMatch(/setTimeout/);
  });

  it('is hidden behind the switch cover, so the rebuild is never seen', () => {
    // LocaleProvider raises an opaque cover for the whole switch, and the two
    // frames sit just after the locale commits — well inside the 180 ms
    // fade-in — so removing and re-adding the item cannot show as a flicker.
    const provider = stripComments(
      readFileSync(join(ROOT, 'src', 'i18n', 'LocaleProvider.tsx'), 'utf8'),
    );
    const raise = provider.indexOf('setSwitching(true)');
    const commit = provider.indexOf('setLocaleState(next)');
    expect(raise).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(raise);
  });

  it('does not blink the item on first mount', () => {
    // `shown` starts AT `dir`, so the effect returns early and `rebuilding` is
    // false from the first frame — the chevron is built under the right
    // direction anyway, and hiding it here would flash on every cold start.
    const bar = stripComments(BAR);
    expect(bar).toMatch(/useState<Direction>\(dir\)/);
    expect(bar).toMatch(/if \(dir === shown\) return;/);
  });
});

describe('locale → direction values', () => {
  it('maps arabic to the exact string the native side converts', () => {
    // RNSScreenStackHeaderConfig.mm maps "rtl" to
    // UISemanticContentAttributeForceRightToLeft; any other spelling silently
    // leaves the bar unmirrored.
    expect(dir('ar')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
  });
});

describe('the native RTL flag is pinned LTR, never forced', () => {
  it('is touched by exactly one module', () => {
    const readers = SOURCES.filter((f) => /\bI18nManager\b/.test(code(f))).map(rel);
    expect(readers).toEqual(['src/i18n/nativeDirection.ts']);
  });

  it('turns the left/right swap off before pinning, and pins LTR', () => {
    // Order matters on Android, which reads the swap preference at the next
    // root sample: the swap must already be off when the direction is written.
    const pin = stripComments(PIN);
    const swap = pin.indexOf('swapLeftAndRightInRTL(false)');
    const allow = pin.indexOf('allowRTL(false)');
    const force = pin.indexOf('forceRTL(false)');
    expect(swap).toBeGreaterThan(-1);
    expect(allow).toBeGreaterThan(swap);
    expect(force).toBeGreaterThan(allow);
    expect(pin).not.toMatch(/forceRTL\(true\)|allowRTL\(true\)/);
  });

  it('is pinned from the entry file, before anything renders', () => {
    expect(ENTRY).toContain("from './src/i18n/nativeDirection'");
    expect(ENTRY).toContain('pinNativeRootLtr();');
  });

  it('never reloads the bundle for a language switch', () => {
    for (const f of SOURCES) {
      expect(code(f), rel(f)).not.toMatch(/DevSettings\.reload|reloadAsync\(/);
    }
  });
});

describe('expo-localization pins the root LTR before React loads', () => {
  /**
   * `LocalizationModule.swift` / `.kt` run in OnCreate — BEFORE React, on every
   * launch — and write RN's own RCTI18nUtil_allowRTL / RCTI18nUtil_forceRTL
   * preferences from the plugin's options. `supportsRTL: false` writes
   * allowRTL=false on both platforms, and forceRTL=false on iOS (Android
   * writes forceRTL only from `forcesRTL`; index.js's pin retires it there).
   * `forcesRTL` must never appear: its iOS branch sets allowRTL=true and
   * derives forceRTL from the DEVICE language — the overwrite that once left
   * Arabic rendered in an LTR layout.
   */
  it('passes supportsRTL: false and never forcesRTL', () => {
    expect(CONFIG).toMatch(/\['expo-localization',\s*\{\s*supportsRTL:\s*false\s*\}\]/);
    expect(CONFIG).not.toMatch(/forcesRTL\s*:/);
  });

  it('keeps the RTL keys out of `extra`, which the plugin also reads', () => {
    // withExpoLocalization merges `{ ...config.extra, ...options }`.
    const extra = CONFIG.slice(CONFIG.indexOf('  extra: {'));
    expect(extra).not.toMatch(/supportsRTL|forcesRTL/);
  });
});
