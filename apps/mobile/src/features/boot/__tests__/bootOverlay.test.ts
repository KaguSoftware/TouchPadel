import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { brand } from '../../../theme/tokens';

/**
 * BootOverlay cannot be mounted under plain node (react-native, expo), so what
 * it promises is held on its SOURCE — the same way the direction rules and the
 * stale-cover call site are. Each of these is a handoff that would visibly
 * break if the number on one side drifted from the other.
 */
const here = dirname(fileURLToPath(import.meta.url));
const OVERLAY = readFileSync(join(here, '../BootOverlay.tsx'), 'utf8');
const APP_CONFIG = readFileSync(join(here, '../../../../app.config.ts'), 'utf8');

describe('the first frame is the native splash', () => {
  it('draws the lockup at the splash image width', () => {
    const inOverlay = /const LOGO_W = (\d+);/.exec(OVERLAY);
    const inSplash = /imageWidth:\s*(\d+)/.exec(APP_CONFIG);
    expect(inOverlay?.[1]).toBeDefined();
    expect(inSplash?.[1]).toBeDefined();
    expect(inOverlay![1]).toBe(inSplash![1]);
  });

  it('paints the splash background colour', () => {
    // The splash plugin block carries the colour as a literal.
    const splashBlock = APP_CONFIG.slice(
      APP_CONFIG.indexOf("'expo-splash-screen'"),
      APP_CONFIG.indexOf(']', APP_CONFIG.indexOf("'expo-splash-screen'")),
    );
    expect(splashBlock).toContain(`backgroundColor: '${brand.blue}'`);
    expect(OVERLAY).toContain('backgroundColor: brand.blue');
  });

  it('draws the vector lockup, not the geometry builder or three', () => {
    expect(OVERLAY).toMatch(/from '\.\.\/\.\.\/components\/LogoMark'/);
    expect(OVERLAY).toMatch(/from '\.\.\/courtTransition\/logoPaths'/);
    expect(OVERLAY).not.toMatch(/logoMark'|from 'three'|SmileyBall/);
  });

  it('starts the serve only once the splash is down', () => {
    // The choreography effect is keyed on `revealed`.
    const start = OVERLAY.indexOf('const serve = Animated.sequence(');
    expect(start).toBeGreaterThan(-1);
    const deps = OVERLAY.slice(start, OVERLAY.indexOf(');', OVERLAY.indexOf('}, [', start)));
    expect(deps).toContain('revealed');
  });
});

describe('what the screen may not do', () => {
  it('keeps every animation on the native driver', () => {
    expect(OVERLAY).not.toContain('useNativeDriver: false');
  });

  it('keeps the hold, fade and watchdog timings', () => {
    expect(OVERLAY).toContain('const HOLD_MS = 1000;');
    expect(OVERLAY).toContain('const FADE_MS = 260;');
    expect(OVERLAY).toContain('const WATCHDOG_MS = 1500;');
  });

  it('uses no physical edge and no fill rule', () => {
    // `start`, never `left` (i18n/direction); nonzero, the default, never
    // evenodd (logoPaths).
    expect(OVERLAY).not.toMatch(/^\s+(left|right):/m);
    expect(OVERLAY).not.toContain('fillRule');
  });
});
