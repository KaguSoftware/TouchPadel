/**
 * Staff clock-in's native side (0442; contract §5):
 *
 *   * the import boundary: clock/native.ts is the only file that names
 *     expo-location or expo-camera, so no guest screen can ever raise a
 *     location prompt, and it imports their types only, requiring them inside
 *     try/catch (a binary without them must still launch);
 *   * the native config: location "while using the app" only, with a purpose
 *     string in both languages and nothing for the background; the camera
 *     with the picker's own purpose string and no microphone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '../../../../..');
const NATIVE = readFileSync(join(here, '../native.ts'), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe('the clock import boundary', () => {
  it('no file but clock/native.ts names expo-location or expo-camera', () => {
    const naming = [...sources(join(APP, 'src')), ...sources(join(APP, 'app'))]
      .filter((f) => !f.includes(`${sep}__tests__${sep}`) && !f.includes(`${sep}smoke${sep}`))
      .filter((f) => /['"]expo-(location|camera)['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(APP, f).split(sep).join('/'));
    expect(naming).toEqual(['src/features/staff/clock/native.ts']);
  });

  it('native.ts imports their types only, and requires them inside try/catch', () => {
    for (const mod of ['expo-location', 'expo-camera']) {
      const imports = [...NATIVE.matchAll(new RegExp(`^import\\s+([^;]*?)\\s+from '${mod}';`, 'gm'))];
      expect(imports.length, mod).toBeGreaterThan(0);
      for (const m of imports) expect(m[1], mod).toMatch(/^type\s/);
    }
    const body = NATIVE.slice(NATIVE.indexOf('function loadNative('));
    expect(body).toMatch(/^[^]*?try\s*\{[^]*?require\('expo-location'\)[^]*?require\('expo-camera'\)[^]*?\}\s*catch\s*\{\s*return null;/);
  });

  it('the only file that imports native.ts is the clock page', () => {
    const importing = [...sources(join(APP, 'src')), ...sources(join(APP, 'app'))]
      .filter((f) => !f.includes(`${sep}__tests__${sep}`) && !f.includes(`${sep}smoke${sep}`))
      .filter((f) => /from '[^']*clock\/native'|from '\.\/native'/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(APP, f).split(sep).join('/'));
    expect(importing).toEqual(['src/features/staff/clock/ClockPage.tsx']);
  });
});

describe('the clock native config', () => {
  it('asks for location while in use only, never in the background, and the camera without the microphone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { default: appConfig } = await import('../../../../../app.config');
    warn.mockRestore();
    const config = appConfig({ config: {} } as never);
    const plugin = (name: string) =>
      (config.plugins?.find((p) => Array.isArray(p) && p[0] === name) as [string, Record<string, unknown>] | undefined)?.[1];

    const location = plugin('expo-location');
    expect(location).toMatchObject({
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      locationFullAccuracyPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
      isAndroidMotionActivityEnabled: false,
    });
    const why = location?.locationWhenInUsePermission as string;
    expect(why).toMatch(/starts or finishes work/);
    expect(why).toMatch(/never in the background/);
    // The motion line is one string for expo-sensors and expo-location, whichever writes last.
    expect(location?.motionUsagePermission).toBe(plugin('expo-sensors')?.motionPermission);

    const camera = plugin('expo-camera');
    expect(camera).toMatchObject({ microphonePermission: false, recordAudioAndroid: false });
    expect(camera?.cameraPermission).toBe(plugin('expo-image-picker')?.cameraPermission);

    const blocked = config.android?.blockedPermissions ?? [];
    expect(blocked).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.RECORD_AUDIO',
      ]),
    );
    expect(JSON.stringify(config.ios?.infoPlist ?? {})).not.toMatch(/UIBackgroundModes|NSLocationAlways/);

    for (const lang of ['en', 'ar'] as const) {
      const file = JSON.parse(readFileSync(join(APP, `locales/ios.${lang}.json`), 'utf8')) as {
        ios: Record<string, string>;
      };
      const line = file.ios.NSLocationWhenInUseUsageDescription;
      expect(typeof line).toBe('string');
      expect(Object.keys(file.ios).some((k) => k.startsWith('NSLocationAlways'))).toBe(false);
      if (lang === 'en') expect(line).toBe(why);
      else expect(line).toMatch(/[؀-ۿ]/);
    }
  });
});
