import { describe, it, expect } from 'vitest';
import {
  mayNavigateTo,
  mayOpenExternally,
  shouldRecoverToRenderer,
  shouldShowTrafficLights,
  clampWindowMinimum,
  LAYOUT_MIN_HEIGHT,
  LAYOUT_MIN_WIDTH,
  openingWindowSize,
  type NavigationPolicy,
} from './window-security';

// The window had no will-navigate handler at all, so nothing stopped the
// renderer moving the top-level frame to remote content with the preload — and
// therefore window.touch: the durable write queue, the PIN unlock, the printer
// — still attached. And setWindowOpenHandler passed any string straight to
// shell.openExternal, which hands it to the OS protocol handler.

const prod: NavigationPolicy = { isDev: false };
const dev: NavigationPolicy = { isDev: true, devServerUrl: 'http://localhost:5174' };

describe('mayNavigateTo', () => {
  it('allows the packaged renderer on file:', () => {
    expect(mayNavigateTo('file:///C:/app/resources/renderer/index.html', prod)).toBe(true);
  });

  it('allows the dev server origin in development', () => {
    expect(mayNavigateTo('http://localhost:5174/till', dev)).toBe(true);
  });

  it('refuses the dev server origin in a packaged build', () => {
    expect(mayNavigateTo('http://localhost:5174/till', prod)).toBe(false);
  });

  it('refuses a different port on the same host', () => {
    // Origin comparison, not a host prefix: another local server is not us.
    expect(mayNavigateTo('http://localhost:3000/', dev)).toBe(false);
  });

  it.each([
    'https://evil.example/phish',
    'http://evil.example/',
    'data:text/html,<script>1</script>',
    'javascript:alert(1)',
    'about:blank',
  ])('refuses %s', (url) => {
    expect(mayNavigateTo(url, dev)).toBe(false);
    expect(mayNavigateTo(url, prod)).toBe(false);
  });

  it('refuses a string that is not a URL at all', () => {
    expect(mayNavigateTo('not a url', prod)).toBe(false);
    expect(mayNavigateTo('', prod)).toBe(false);
  });
});

describe('mayOpenExternally', () => {
  it('allows https in a shipped build', () => {
    expect(mayOpenExternally('https://core.telegram.org/bots', prod)).toBe(true);
  });

  it('refuses plain http in a shipped build', () => {
    expect(mayOpenExternally('http://example.com', prod)).toBe(false);
  });

  it('allows plain http in development', () => {
    // Supabase Studio and local docs.
    expect(mayOpenExternally('http://127.0.0.1:54323', dev)).toBe(true);
  });

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'smb://attacker/share',
    'ms-msdt:/id',
    'javascript:alert(1)',
    'vscode://file/etc/passwd',
  ])('refuses the OS-handler scheme in %s', (url) => {
    // shell.openExternal hands these to Windows, which will happily act on them.
    expect(mayOpenExternally(url, prod)).toBe(false);
    expect(mayOpenExternally(url, dev)).toBe(false);
  });

  it('refuses junk', () => {
    expect(mayOpenExternally('', prod)).toBe(false);
    expect(mayOpenExternally('https:// broken', prod)).toBe(false);
  });
});

describe('shouldRecoverToRenderer', () => {
  const renderer = 'file:///C:/Program%20Files/Touch%20Padel/resources/renderer/index.html';
  const failed = (url: string, errorCode = -6, isMainFrame = true) => ({ url, errorCode, isMainFrame });

  it('recovers a reload of a stale history path (the Windows white screen)', () => {
    expect(shouldRecoverToRenderer(failed('file:///C:/till'), renderer)).toBe(true);
  });

  it('recovers the macOS spelling of the same path', () => {
    expect(
      shouldRecoverToRenderer(failed('file:///till'), 'file:///Applications/Touch.app/Contents/Resources/renderer/index.html'),
    ).toBe(true);
  });

  it('does not reload index.html into itself when the renderer is missing', () => {
    expect(shouldRecoverToRenderer(failed(renderer), renderer)).toBe(false);
    expect(shouldRecoverToRenderer(failed(`${renderer}#/till`), renderer)).toBe(false);
  });

  it('ignores superseded loads, subframes and non-file URLs', () => {
    expect(shouldRecoverToRenderer(failed('file:///C:/till', -3), renderer)).toBe(false);
    expect(shouldRecoverToRenderer(failed('file:///C:/till', -6, false), renderer)).toBe(false);
    expect(shouldRecoverToRenderer(failed('http://localhost:5174/till', -102), renderer)).toBe(false);
  });
});

// A till/KDS station is a kiosk by design and its only exits are Quit to
// desktop and "Exit forced full screen"; a close button there would be a
// third, unaudited one. Everything else on macOS is a machine somebody drives.
describe('shouldShowTrafficLights', () => {
  const mac = { platform: 'darwin' as NodeJS.Platform, isDev: false, configured: true };

  it('shows them on a configured macOS desk station', () => {
    expect(shouldShowTrafficLights({ ...mac, mode: 'desk' })).toBe(true);
  });

  it('withholds them from a till kiosk', () => {
    expect(shouldShowTrafficLights({ ...mac, mode: 'till' })).toBe(false);
  });

  it('withholds them from a KDS kiosk', () => {
    expect(shouldShowTrafficLights({ ...mac, mode: 'kds' })).toBe(false);
  });

  it('shows them on an unconfigured station, whatever the default mode', () => {
    expect(shouldShowTrafficLights({ ...mac, configured: false, mode: 'till' })).toBe(true);
  });

  it('shows them in development, even for a till', () => {
    expect(shouldShowTrafficLights({ ...mac, isDev: true, mode: 'till' })).toBe(true);
  });

  it('never claims them on Windows, which draws none', () => {
    expect(shouldShowTrafficLights({ ...mac, platform: 'win32', mode: 'desk' })).toBe(false);
    expect(shouldShowTrafficLights({ ...mac, platform: 'win32', isDev: true, mode: 'desk' })).toBe(false);
  });
});


describe('clampWindowMinimum', () => {
  const floor = { width: LAYOUT_MIN_WIDTH, height: LAYOUT_MIN_HEIGHT };

  it('keeps the floor on a display that can hold it', () => {
    expect(clampWindowMinimum(floor, { width: 1920, height: 1080 })).toEqual(floor);
  });

  // The floor is meant to fit every Mac the app runs on, so on real laptop
  // work areas it should survive untouched — 13" Air, then an 11" Air.
  it('keeps the floor on a 13-inch laptop work area', () => {
    expect(clampWindowMinimum(floor, { width: 1440, height: 845 })).toEqual(floor);
  });

  it('keeps the floor on an 11-inch laptop work area', () => {
    expect(clampWindowMinimum(floor, { width: 1366, height: 768 })).toEqual(floor);
  });

  // The failure this exists to prevent: a minimum taller than the screen makes
  // the bottom of the app unreachable, with no way to shrink the window.
  it('never demands more height than the work area has', () => {
    expect(clampWindowMinimum(floor, { width: 1280, height: 600 }).height).toBe(600);
  });

  it('never demands more width than the work area has', () => {
    expect(clampWindowMinimum(floor, { width: 900, height: 900 }).width).toBe(900);
  });

  it('clamps both axes on a display smaller than the floor all round', () => {
    expect(clampWindowMinimum(floor, { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });
});

describe('the derived layout floor', () => {
  // The till is the widest screen: rail 208 + main padding 48 + gaps 32 +
  // its three columns (11+17+16 = 44rem = 704 at the 16px root) = 992. If a
  // column grows, this should fail and the floor should be re-derived.
  it('clears what the till actually needs', () => {
    const RAIL = 208;
    const MAIN_PADDING = 48;
    const COLUMN_GAPS = 32;
    const TILL_COLUMNS = (11 + 17 + 16) * 16;
    expect(LAYOUT_MIN_WIDTH).toBeGreaterThanOrEqual(RAIL + MAIN_PADDING + COLUMN_GAPS + TILL_COLUMNS);
  });

  // A floor no Mac can honour would be silently clamped away on every station,
  // which is the same as having none. 1366x768 is the smallest we expect.
  it('fits the smallest work area we ship to', () => {
    expect(LAYOUT_MIN_WIDTH).toBeLessThanOrEqual(1366);
    expect(LAYOUT_MIN_HEIGHT).toBeLessThanOrEqual(768);
  });
});

describe('openingWindowSize', () => {
  const floor = { width: LAYOUT_MIN_WIDTH, height: LAYOUT_MIN_HEIGHT };

  // The bug: Electron's 800x600 default is under the floor, so the window
  // opened small and macOS snapped it up on the first drag.
  it('never opens below the floor, which is what caused the jump', () => {
    const open = openingWindowSize(floor, { width: 1024, height: 700 });
    expect(open.width).toBeGreaterThanOrEqual(floor.width);
    expect(open.height).toBeGreaterThanOrEqual(floor.height);
  });

  it('opens at a share of a large screen rather than at the floor', () => {
    const open = openingWindowSize(floor, { width: 2560, height: 1440 });
    expect(open).toEqual({ width: 2304, height: 1296 });
  });

  it('opens within a 13-inch laptop work area', () => {
    const work = { width: 1440, height: 845 };
    const open = openingWindowSize(floor, work);
    expect(open.width).toBeLessThanOrEqual(work.width);
    expect(open.height).toBeLessThanOrEqual(work.height);
    expect(open.height).toBeGreaterThanOrEqual(floor.height);
  });

  // A window bigger than the desktop cannot be dragged back into view, so the
  // work area beats the floor when the two genuinely conflict.
  it('never opens larger than the work area, even under the floor', () => {
    const work = { width: 900, height: 600 };
    expect(openingWindowSize(floor, work)).toEqual(work);
  });

  it('returns whole pixels', () => {
    const open = openingWindowSize(floor, { width: 1333, height: 777 });
    expect(Number.isInteger(open.width)).toBe(true);
    expect(Number.isInteger(open.height)).toBe(true);
  });
});
