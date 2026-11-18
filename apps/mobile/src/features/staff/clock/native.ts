/**
 * THE ONLY FILE IN THE APP THAT NAMES expo-location OR expo-camera (contract
 * §5; guarded by __tests__/nativeBoundary.test.ts).
 *
 * Location is asked for on the staff clock page alone, "while using the app"
 * only: no background location, no geofence, nothing for a guest. A guest
 * session never reaches the clock page, so it never sees a location prompt.
 * The fix is read while the page is open and sent once with the scan; nothing
 * tracks anyone between scans.
 *
 * BOTH MODULES ARE REQUIRED LAZILY, INSIDE try/catch, AND ONLY TYPES ARE
 * IMPORTED (the photo.ts and Court3D rule). expo-router loads every route file
 * when the app starts, and both packages look up their native module the
 * moment they are evaluated: a value import here would crash EVERY launch, a
 * guest's too, on a binary built before the two plugins were added (an OTA
 * update reaches those binaries). Lazy, such a binary loads fine and the
 * clock page says to update the app.
 */
import { createElement, type ComponentType, type ReactElement } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import type * as LocationModule from 'expo-location';
import type * as CameraModule from 'expo-camera';
import type { ClockPermissions, Fix, PermissionRead } from './logic';

interface ClockNative {
  location: typeof LocationModule;
  camera: typeof CameraModule;
}

function loadNative(): ClockNative | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see the header */
    const location = require('expo-location') as typeof LocationModule;
    const camera = require('expo-camera') as typeof CameraModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (typeof location.getForegroundPermissionsAsync !== 'function' || !camera.CameraView) return null;
    return { location, camera };
  } catch {
    return null;
  }
}

let native: ClockNative | null | undefined;
function getNative(): ClockNative | null {
  if (native === undefined) native = loadNative();
  return native;
}
function need(): ClockNative {
  const n = getNative();
  if (!n) throw new Error('CLOCK_NATIVE_MISSING');
  return n;
}

/** False on a binary built before the camera and location plugins: the page asks for an update. */
export function clockNativeAvailable(): boolean {
  return getNative() !== null;
}

// ── Location ────────────────────────────────────────────────────────────────

type LocationRead = ClockPermissions['location'];

function readStatus(res: { status: string; canAskAgain: boolean }): PermissionRead {
  return {
    status: res.status === 'granted' ? 'granted' : res.status === 'denied' ? 'denied' : 'undetermined',
    canAskAgain: res.canAskAgain,
  };
}

function toLocationRead(res: LocationModule.LocationPermissionResponse): LocationRead {
  // iOS 14+ "Precise: Off" and Android "Approximate" give a fix that cannot place anyone at the club.
  const precise = res.ios?.accuracy !== 'reduced' && res.android?.accuracy !== 'coarse';
  return { ...readStatus(res), precise };
}

export async function readLocationPermission(): Promise<LocationRead> {
  return toLocationRead(await need().location.getForegroundPermissionsAsync());
}

/** The system prompt; only ever called when clockStep says it can still be shown. */
export async function askLocationPermission(): Promise<LocationRead> {
  return toLocationRead(await need().location.requestForegroundPermissionsAsync());
}

export async function locationServicesOn(): Promise<boolean> {
  try {
    return await need().location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

/** Android's own "turn on location" dialog. iOS has none; the page says where the switch is. */
export async function turnOnLocation(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await need().location.enableNetworkProviderAsync();
  } catch {
    // Declined: the page still says how.
  }
}

function toFix(loc: LocationModule.LocationObject): Fix {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracy: typeof loc.coords.accuracy === 'number' ? loc.coords.accuracy : null,
    at: loc.timestamp,
    mocked: loc.mocked ?? false,
  };
}

/**
 * Watch the location while a code may come, so a fix is ready the moment one
 * is read. Returns the stop; the page calls it when it leaves, sends, or goes
 * to the background.
 */
export async function watchFixes(onFix: (fix: Fix) => void): Promise<() => void> {
  const { location } = need();
  const sub = await location.watchPositionAsync(
    { accuracy: location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
    (loc) => onFix(toFix(loc)),
  );
  return () => sub.remove();
}

/** One fix now, beside the watch. */
export async function currentFix(): Promise<Fix> {
  const { location } = need();
  return toFix(await location.getCurrentPositionAsync({ accuracy: location.Accuracy.Highest }));
}

// ── Camera ──────────────────────────────────────────────────────────────────

export async function readCameraPermission(): Promise<PermissionRead> {
  return readStatus(await need().camera.Camera.getCameraPermissionsAsync());
}

export async function askCameraPermission(): Promise<PermissionRead> {
  return readStatus(await need().camera.Camera.requestCameraPermissionsAsync());
}

/**
 * The back camera, reading QR codes only. Nothing on a binary without the
 * module (the page shows its update step before it would get here).
 */
export function ClockScanner({
  onBarcodeScanned,
  style,
}: {
  onBarcodeScanned: (result: { data: string }) => void;
  style?: StyleProp<ViewStyle>;
}): ReactElement | null {
  const view = getNative()?.camera.CameraView as ComponentType<CameraModule.CameraViewProps> | undefined;
  if (!view) return null;
  return createElement(view, {
    style,
    facing: 'back',
    barcodeScannerSettings: { barcodeTypes: ['qr'] },
    onBarcodeScanned,
  });
}
