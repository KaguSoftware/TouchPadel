import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');

/** Comments name the throwing hook to explain it, so assert against code only. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const HOOK = stripComments(read('src/components/useTabBarHeight.ts'));
const SCREENS = ['app/(tabs)/index.tsx', 'app/(tabs)/bookings.tsx', 'app/(tabs)/profile.tsx'];

/**
 * `useBottomTabBarHeight()` THROWS when its context is missing, and the context
 * is genuinely missing on both platforms: iOS runs the real UITabBar through
 * expo-router `NativeTabs` (not a react-navigation navigator at all), and an
 * Android screen can render before the tabs settle. That crashed the Book tab
 * on render — in English and Arabic alike, since it happens before layout.
 *
 * Reading the context cannot throw, so the shape of the fix is what matters
 * here: these pin it so the throwing hook cannot creep back in.
 */
describe('tab bar height never throws on render', () => {
  it('reads the context instead of requiring it', () => {
    expect(HOOK).toMatch(/useContext\(BottomTabBarHeightContext\)/);
    // The throwing hook must not be called — importing the context is fine.
    expect(HOOK).not.toMatch(/useBottomTabBarHeight\s*\(/);
  });

  it('falls back to a real height when no navigator provides one', () => {
    expect(HOOK).toMatch(/if \(measured != null\) return measured;/);
    expect(HOOK).toMatch(/IOS_TAB_BAR_HEIGHT : ANDROID_TAB_BAR_HEIGHT\) \+ bottomInset/);
  });

  it('keeps every tab screen on the safe hook', () => {
    for (const path of SCREENS) {
      const src = stripComments(read(path));
      expect(src).toMatch(/useTabBarHeight\(\)/);
      expect(src).not.toMatch(/useBottomTabBarHeight/);
    }
  });
});
