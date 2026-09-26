import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * READING THE DEVICE SCHEME MUST NOT WRITE ANYTHING.
 *
 * This started as the opposite: `deviceAppearance()` released the app's pin
 * (`setColorScheme('unspecified')`) before reading, so it could see past an
 * override left by an explicit 'light' / 'dark' preference. That fixed one bug
 * and caused a worse one on device.
 *
 * On iOS `setColorScheme` assigns `window.overrideUserInterfaceStyle`. That
 * makes the OS post its userInterfaceStyle-did-change notification, and
 * RCTAppearance answers it by updating `_currentColorScheme` and emitting
 * `appearanceChanged` ONLY if that value actually changed. So a read that
 * released the pin kept moving the native module's notion of "current" — and
 * when the user really flipped the phone, the guard found nothing had changed,
 * no event was emitted, and the app never learned about it. Dark mode simply
 * stopped responding.
 *
 * The pin never needed working around here anyway: it exists only under an
 * explicit preference, and `resolveAppearance` answers those from the
 * preference without consulting the device at all.
 */

let device: 'light' | 'dark' = 'light';
/** RN's cached scheme; `undefined` = not yet read (lazy init). */
let cached: 'light' | 'dark' | null | undefined;
/** Every setColorScheme call, so a read that writes is a test failure. */
let writes: Array<string | null>;

vi.mock('react-native', () => ({
  Appearance: {
    getColorScheme: () => (cached === undefined ? device : cached),
    setColorScheme: (next: 'light' | 'dark' | 'unspecified' | null) => {
      writes.push(next);
      cached = next === 'unspecified' ? device : next;
    },
  },
}));

const { deviceAppearance, resolveAppearance } = await import('../lastAppearance');

beforeEach(() => {
  device = 'light';
  cached = undefined;
  writes = [];
});

describe('deviceAppearance', () => {
  it('reads the device scheme', () => {
    device = 'dark';
    expect(deviceAppearance()).toBe('dark');
  });

  it('NEVER writes — a read that mutates suppresses the OS change event', () => {
    device = 'dark';
    deviceAppearance();
    deviceAppearance();
    deviceAppearance();
    expect(writes).toEqual([]);
  });

  it('defaults to light when the OS reports no scheme', () => {
    device = null as unknown as 'light';
    expect(deviceAppearance()).toBe('light');
  });

  it('reports light when the OS reports light', () => {
    device = 'light';
    expect(deviceAppearance()).toBe('light');
  });

  it('is stable across repeated reads', () => {
    device = 'dark';
    expect([deviceAppearance(), deviceAppearance()]).toEqual(['dark', 'dark']);
  });
});

describe('resolveAppearance', () => {
  it('resolves automatic against the device', () => {
    device = 'dark';
    expect(resolveAppearance('automatic')).toBe('dark');
  });

  it('answers an explicit preference WITHOUT consulting the device', () => {
    device = 'dark';
    // The pin the provider may have left is irrelevant: the preference wins,
    // which is why the read never needs to see past an override.
    expect(resolveAppearance('light')).toBe('light');
    expect(resolveAppearance('dark')).toBe('dark');
    expect(writes).toEqual([]);
  });

  it('never writes, whatever the preference', () => {
    for (const p of ['automatic', 'light', 'dark'] as const) resolveAppearance(p);
    expect(writes).toEqual([]);
  });
});
