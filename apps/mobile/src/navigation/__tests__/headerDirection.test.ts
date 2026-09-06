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
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
