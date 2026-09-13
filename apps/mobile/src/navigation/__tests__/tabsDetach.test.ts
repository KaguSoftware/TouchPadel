/**
 * THE ANDROID TAB NAVIGATOR MUST NOT DETACH ITS SCREENS — OR MOVE THEM.
 *
 * Two lines, and the court on the Book tab depends on both. expo-gl's Android
 * view is a `TextureView` whose `onSurfaceTextureDestroyed` destroys the GL
 * context outright (expo-gl GLView.kt), and that happens whenever the view
 * leaves the window. Coming back cannot show the court again: it has to take a
 * new context, build a new `THREE.WebGLRenderer` and compile every shader in the
 * scene before one frame can be drawn — while the rest of the page is already
 * there (owner, 2026-09-12 and again 2026-09-13, Android).
 *
 * Two things took it out of the window on every tab switch:
 *
 *   · react-navigation's bottom tabs default `detachInactiveScreens` to true on
 *     Android, so a blurred tab's fragment was detached. With the prop false,
 *     react-native-screens hides it with `display: 'none'` instead, which Fabric
 *     maps to `View.INVISIBLE` (SurfaceMountingManager.kt) — attached, skipped
 *     by the draw.
 *   · bottom-tabs still gives each screen `zIndex: isFocused ? 0 : -1`. Fabric
 *     orders siblings by zIndex, so every switch reordered the tabs, and the
 *     differ writes a reorder as REMOVE + INSERT of the screen being left —
 *     detaching it just the same. The prop alone therefore never kept the
 *     surface; `StableOrderScreen` strips the zIndex through react-native-screens'
 *     own `ScreenContext`, as the library already does for its native screens.
 *
 * Nothing about either is visible to typecheck or lint, and both read like
 * boilerplate, so the rule is on the source. iOS is not checked here: it runs
 * `NativeTabs`, which keeps the surface without being asked.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const android = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../TabsLayout.android.tsx'),
  'utf8',
);

describe('Android tabs', () => {
  it('keeps blurred screens attached, so the court keeps its GL context', () => {
    expect(android).toContain('detachInactiveScreens={false}');
  });

  it('says why, where the next person to tidy the prop will read it', () => {
    const at = android.indexOf('detachInactiveScreens={false}');
    // The reason lives immediately above the prop, not in a commit message.
    expect(android.slice(0, at)).toMatch(/GL surface|GL context/);
  });

  it('never reorders the tab screens, so leaving the Book tab does not detach it', () => {
    // Every screen the navigator renders goes through the provider…
    expect(android).toMatch(
      /<ScreenContext\.Provider value=\{StableOrderScreen\}>\s*<AndroidTabs \/>\s*<\/ScreenContext\.Provider>/,
    );
    // …and the screen it provides takes bottom-tabs' zIndex off, last in the
    // style array so nothing after it can put it back.
    const at = android.indexOf('const StableOrderScreen = forwardRef');
    expect(at).toBeGreaterThan(-1);
    const screen = android.slice(at, android.indexOf('});', at));
    expect(screen).toContain('<InnerScreen');
    expect(screen).toContain('style={[style, { zIndex: undefined }]}');
  });

  it('says why, above the screen that strips the zIndex', () => {
    const at = android.indexOf('const StableOrderScreen = forwardRef');
    const note = android.slice(android.lastIndexOf('/**', at), at);
    expect(note).toMatch(/REMOVE \+ INSERT/);
    expect(note).toMatch(/GL\s+context/);
  });
});
