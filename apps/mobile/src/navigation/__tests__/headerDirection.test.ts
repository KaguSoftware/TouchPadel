import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dir } from '@touch/i18n';

/**
 * The Arabic back chevron.
 *
 * react-navigation reads the navigation bar's direction from
 * `LocaleDirContext`. `NavigationContainer` fills that from
 * `I18nManager.getConstants().isRTL` — a BOOT-TIME native constant that only
 * flips on the JS load AFTER `forceRTL` (see `reconcileRtl` in bootPrefs). And
 * expo-router does not expose the container's `direction` prop, so there is no
 * supported way to correct it from the outside.
 *
 * The consequence was Arabic-specific and easy to miss: the bar was told `ltr`,
 * UIKit laid the back item against the wrong edge, and the chevron fell outside
 * the frame while the label — centred within the item — still rendered. Hence
 * "the text is ok but the chevron is not showing".
 *
 * The root layout therefore provides `LocaleDirContext` itself, from the app's
 * own locale. These tests pin that wiring, because nothing else in the suite
 * can see it: it is a native layout property, invisible to typecheck and lint.
 */

const LAYOUT = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');

describe('navigation bar direction', () => {
  it('provides LocaleDirContext around the stack', () => {
    // Without the provider the context falls back to its 'ltr' default and the
    // Arabic bar mirrors the wrong way.
    expect(LAYOUT).toContain('LocaleDirContext.Provider');
    expect(LAYOUT).toContain("from '@react-navigation/native'");
  });

  it('drives the direction from the app locale, not the native RTL flag', () => {
    // `dir` comes from LocaleProvider (the chosen language). Reading
    // I18nManager here instead would reintroduce the boot-order lag.
    expect(LAYOUT).toMatch(/<LocaleDirContext\.Provider value=\{dir\}>/);
    expect(LAYOUT).toMatch(/const \{ dir \} = useLocale\(\);/);
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

describe('locale → direction values', () => {
  it('maps arabic to the exact string the native side converts', () => {
    // RNSScreenStackHeaderConfig.mm maps "rtl" to
    // UISemanticContentAttributeForceRightToLeft; any other spelling silently
    // leaves the bar unmirrored.
    expect(dir('ar')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
  });
});

describe('survives a session where the native RTL flag is stale', () => {
  /**
   * `reconcileRtl` calls `forceRTL`, which only takes effect after a JS reload.
   * `reloadForRtl` performs that reload in development but returns false in a
   * RELEASE build (and on any failure), and the boot gate then proceeds anyway:
   *
   *     if (reconcileRtl(p.locale) && reloadForRtl()) return;
   *     setPrefs(p);
   *
   * So a production session can run Arabic with `I18nManager.isRTL` still
   * false. Anything deriving the bar's direction from that flag is wrong for
   * the whole session — which is precisely how the chevron went missing.
   * Reading the LOCALE instead is immune, so this pins the boot gate's shape
   * together with the provider's source.
   */
  const BOOT = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');

  it('still renders when the reload does not happen', () => {
    // The gate deliberately falls through to setPrefs rather than blocking.
    expect(BOOT).toMatch(/if \(reconcileRtl\([^)]*\) && reloadForRtl\(\)\) return;/);
    expect(BOOT).toContain('setPrefs(p);');
  });

  it('never derives the bar direction from I18nManager', () => {
    const provider = BOOT.slice(BOOT.indexOf('<LocaleDirContext.Provider'));
    expect(provider).not.toContain('I18nManager');
    expect(provider).not.toContain('isRTL');
  });
});

describe('expo-localization must not own the RTL flag', () => {
  /**
   * `LocalizationModule.swift` runs `setRTLPreferences` in OnCreate — BEFORE
   * React loads, on every launch — writing RN's own `RCTI18nUtil_allowRTL` /
   * `RCTI18nUtil_forceRTL` UserDefaults keys. With `supportsRTL: true` and no
   * `forcesRTL`, it derives forceRTL from `isRTLPreferredForCurrentLocale()`,
   * i.e. the DEVICE language.
   *
   * So an Arabic choice made inside the app on an English phone was reset to
   * LTR at every start, silently undoing `reconcileRtl`'s forceRTL. Arabic then
   * rendered in an LTR layout — which is how the back chevron went missing.
   *
   * OnCreate is a no-op when NEITHER Info.plist key is present, so the config
   * must pass no RTL options and let JS (`I18nManager.allowRTL` in the root
   * layout + `reconcileRtl`) follow the CHOSEN language instead.
   */
  const CONFIG = readFileSync(join(__dirname, '..', '..', '..', 'app.config.ts'), 'utf8');

  it('passes no RTL options to the expo-localization plugin', () => {
    expect(CONFIG).not.toMatch(/supportsRTL\s*:/);
    expect(CONFIG).not.toMatch(/forcesRTL\s*:/);
    expect(CONFIG).toContain("'expo-localization'");
  });

  it('still allows RTL from JS, which is what the plugin used to do natively', () => {
    const LAYOUT_SRC = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');
    expect(LAYOUT_SRC).toContain('I18nManager.allowRTL(true)');
  });
});
