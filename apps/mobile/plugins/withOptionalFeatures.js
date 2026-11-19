/**
 * Play Console "device compatibility": hardware features the manifest implies and Play therefore
 * treats as REQUIRED, which hides the app from devices without them.
 *
 *  - android.hardware.wifi: implied by ACCESS_WIFI_STATE (pulled in by netinfo). The app only needs
 *    to know whether it is online, and works over mobile data or ethernet too.
 *  - android.hardware.screen.portrait: implied by the portrait lock (`orientation: 'portrait'`).
 *    The app is portrait-only by design, but a device that reports landscape only (some tablets,
 *    Chromebooks, TVs) should still be allowed to install it.
 *
 * Declaring them `required="false"` changes which devices may install, not how the app behaves.
 * It is a manifest change, so it needs a new binary: an OTA update cannot carry it.
 */
// Expo loads config plugins as CommonJS, so `require` is the only form that works here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_FEATURES = ['android.hardware.wifi', 'android.hardware.screen.portrait'];

module.exports = function withOptionalFeatures(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((f) => f.$['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return c;
  });
};
