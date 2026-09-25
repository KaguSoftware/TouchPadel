/**
 * `staff.media.*` — the staff phone’s photo picker and its permissions.
 * Owned by lane G (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in media.ar.ts.
 *
 * Read by src/components/PhotoButton.tsx. The system prompts themselves (the
 * camera and photo-library usage text) are native strings in
 * apps/mobile/locales/ios.{en,ar}.json, not here.
 */
export const staffMediaEn = {
  add: 'Add photo',
  // The source sheet: the platform's own action sheet (iOS) or alert (Android).
  sourceTitle: 'Add a photo',
  camera: 'Take photo',
  library: 'Choose from library',
  cancel: 'Cancel',
  uploading: 'Uploading photo…',
  // Accessibility labels; {n} counts from 1.
  photo: 'Photo {n}',
  remove: 'Remove photo {n}',
  count: '{count} of {max} photos',
  cameraOff: 'Camera access is off for Touch Padel. Turn it on in Settings to take a work photo.',
  openSettings: 'Open Settings',
  unavailable: 'This version of the app cannot attach photos. Update Touch Padel, then try again.',
  failed: 'The photo did not upload. Try again.',
} as const;
