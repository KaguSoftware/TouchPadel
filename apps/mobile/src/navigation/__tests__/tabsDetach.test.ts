/**
 * THE ANDROID TAB NAVIGATOR MUST NOT DETACH ITS SCREENS.
 *
 * One prop, and the court on the Book tab depends on it. expo-gl's Android view
 * is a `TextureView` whose `onSurfaceTextureDestroyed` destroys the GL context
 * outright (expo-gl GLView.kt), and react-navigation's bottom tabs default
 * `detachInactiveScreens` to true on Android — so a blurred tab went to
 * react-native-screens' activityState 0, its fragment was detached, and the
 * court's context died with the surface. Coming back could not show the court
 * again: it had to take a new context, build a new `THREE.WebGLRenderer` and
 * compile every shader in the scene before one frame could be drawn, with the
 * stage held at zero throughout (Court3D's REVEAL_MS). The court blinked out on
 * every return (owner, 2026-09-12, Android).
 *
 * With the prop false, react-native-screens hides the blurred screen with
 * `display: 'none'` instead, which Fabric maps to `View.INVISIBLE`
 * (SurfaceMountingManager.kt) — attached to the window, so the surface lives;
 * skipped by the draw, so it costs nothing.
 *
 * Nothing about that is visible to typecheck or lint, and the prop reads like
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
});
