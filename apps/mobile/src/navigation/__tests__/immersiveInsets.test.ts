import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');

/** Comments explain the discarded approach by name, so assert against code only. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SRC = stripComments(read('src/navigation/immersiveInsets.tsx'));
const LAYOUT = stripComments(read('app/_layout.tsx'));

/**
 * The bottom inset is zeroed because the app HIDES the Android nav bar, and it
 * must not be gated on `useVisibility()`.
 *
 * That hook seeds its state to `null` and only leaves it when the native
 * listener fires a CHANGE. On a normal launch the bar is already hidden before
 * anything subscribes, so no change is emitted, the value sits at `null`, and a
 * `visibility === 'hidden'` guard never passes — the real inset stays published
 * and the dead band under the tab bar survives. That shipped once and looked
 * exactly like no fix at all, hence this test.
 */
describe('immersive bottom inset', () => {
  it('zeroes the bottom inset without gating on nav-bar visibility', () => {
    expect(SRC).toMatch(/bottom:\s*0/);
    // The Platform check is the ONLY guard on the override.
    expect(SRC).toMatch(/if \(Platform\.OS !== 'android'\) return/);
    expect(SRC).not.toMatch(/visibility !== 'hidden'/);
  });

  it('still pushes the bar back down whenever Android re-shows it', () => {
    expect(SRC).toMatch(/visibility !== 'visible'/);
    expect(SRC).toMatch(/setVisibilityAsync\('hidden'\)/);
  });

  it('overrides the context rather than the measurement', () => {
    expect(SRC).toMatch(/SafeAreaInsetsContext\.Provider/);
  });

  /**
   * The bar sizes itself from TAB_BAR_BASE and every tab screen pads its scroll
   * content with useTabBarHeight()'s fallback. They describe the SAME bar, so a
   * drift pads content to a height the bar does not have — content cut off
   * under it, or a gap above it.
   *
   * TAB_BAR_BASE is imported (it lives in tabBarGeometry.ts); the fallback is
   * read from source because useTabBarHeight.ts imports react-native, which the
   * node suite cannot load.
   */
  it('keeps the bar height and its fallback in agreement', () => {
    const bar = stripComments(read('src/navigation/TabsLayout.android.tsx'));
    const hook = stripComments(read('src/components/useTabBarHeight.ts'));
    const base = bar.match(/const TAB_BAR_BASE = (\d+)/)?.[1];
    const fallback = hook.match(/const ANDROID_TAB_BAR_HEIGHT = (\d+)/)?.[1];
    expect(base).toBeDefined();
    expect(fallback).toBe(base);
  });

  /**
   * The tablist row is `flex: 1` over the bar's full height, so an item with a
   * height of its OWN sits top-aligned in it and leaves a band of bare bar
   * below the labels — the gap this whole change exists to remove. Pinning the
   * item shorter than the bar also clips the label and drops the active dot.
   */
  it('lets the tab item fill the bar instead of pinning its height', () => {
    const bar = stripComments(read('src/navigation/TabsLayout.android.tsx'));
    const item = bar.match(/tabBarItemStyle: \{[^}]*\}/)?.[0];
    expect(item).toBeDefined();
    expect(item).toMatch(/flex: 1/);
    expect(item).not.toMatch(/height:/);
  });

  /**
   * The grey band was Android's `enforceNavigationBarContrast` scrim — a
   * translucent layer the OS paints over the nav-bar region so system buttons
   * stay legible. It defaults to TRUE and is drawn above the app, which is why
   * no JS change ever removed it. Only the native theme attribute turns it off,
   * and in a managed app that means the config plugin.
   */
  it('turns the contrast scrim off natively', () => {
    const cfg = stripComments(read('app.config.ts'));
    expect(cfg).toMatch(/'expo-navigation-bar'/);
    expect(cfg).toMatch(/enforceContrast: false/);
  });

  /**
   * The bar is its own content on the screen edge — the revealed nav bar floats
   * OVER it. Nothing stretches it, so no `paddingBottom` and no added inset.
   */
  it('keeps the bar at its content height so the nav bar can overlay it', () => {
    const bar = stripComments(read('src/navigation/TabsLayout.android.tsx'));
    expect(bar).toMatch(/height: TAB_BAR_BASE,/);
    expect(bar).not.toMatch(/paddingBottom:/);
    expect(bar).not.toMatch(/hiddenInset/);
  });

  /**
   * Order matters: it must be INSIDE SafeAreaProvider (there is an inset to
   * override) and OUTSIDE everything that lays out against one.
   */
  it('is mounted inside SafeAreaProvider', () => {
    const provider = LAYOUT.indexOf('<SafeAreaProvider>');
    const immersive = LAYOUT.indexOf('<ImmersiveInsets>');
    expect(provider).toBeGreaterThan(-1);
    expect(immersive).toBeGreaterThan(provider);
  });
});
