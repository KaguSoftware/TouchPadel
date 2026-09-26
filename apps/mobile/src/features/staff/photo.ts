/**
 * Work photos (build-contracts-2026-09-23 §6.9): the only door from the app to
 * expo-image-picker and expo-image-manipulator, and to the staff-media bucket.
 *
 * NEITHER NATIVE MODULE IS IMPORTED AT MODULE SCOPE. Both resolve their native
 * side at import time, so a value import would crash every route that reaches
 * this file on a binary built before they were added (a stale dev client, or an
 * internal 1.0.0 build taking an OTA that reaches a photo screen) — the expo-gl
 * crash of 2026-09-02 (Court3D.tsx). They are required on first use inside
 * try/catch instead, and a binary without them reports `unavailable`. The
 * boundary is pinned by __tests__/photo.test.ts: no other file names either
 * module.
 *
 * EVERY PHOTO IS RE-ENCODED BEFORE IT LEAVES THE PHONE. The picker's own
 * compression copies the source's EXIF into its output on Android, GPS tags
 * included (expo-image-picker CompressionImageExporter → copyExifData), and an
 * iOS library pick can arrive as the untouched HEIC. The manipulator writes
 * pixels only, so no location or camera metadata reaches the bucket, and the
 * output is always a JPEG the bucket accepts. The long edge is capped at
 * MAX_EDGE so a 24-megapixel shot stays well under the bucket's 5 MiB.
 *
 * Uploading: staff_media_slot mints the path, the bytes go to exactly that
 * path, and only then does a recording RPC name it (§2.3). Reading is by a
 * 10-minute signed URL. This module imports nothing from react-native at load,
 * so its logic runs under vitest with the natives and the client injected.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { ImagePickerAsset, ImagePickerOptions, ImagePickerResult } from 'expo-image-picker';
import type * as Manipulator from 'expo-image-manipulator';
import type * as AppClient from '../../lib/supabase';

type Client = SupabaseClient<Database>;

export const STAFF_MEDIA_BUCKET = 'staff-media';
/**
 * The folders staff_media_slot accepts (§2.3; checklists, teachings and
 * requests since staff_media_folders, §2.24.2; incidents since
 * staff_media_incidents, wave5-addendum §2.4).
 */
export type PhotoFolder =
  | 'proposals'
  | 'tests'
  | 'steps'
  | 'marketing'
  | 'campaigns'
  | 'receipts'
  | 'checklists'
  | 'teachings'
  | 'requests'
  | 'incidents';
export type PhotoSource = 'camera' | 'library';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
  mime: string;
}

/**
 * Why a photo could not be taken. `null` from pickPhoto is not an error: the
 * person cancelled.
 *   unavailable  this binary has no picker (update the app);
 *   permission   the camera is switched off for the app in Settings.
 */
export class PhotoError extends Error {
  constructor(readonly code: 'unavailable' | 'permission') {
    super(`PHOTO_${code.toUpperCase()}`);
    this.name = 'PhotoError';
  }
}

/** The picker options of §6.9: one still image, as taken, no EXIF, no base64. */
export const PICK_OPTIONS: ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.7,
  exif: false,
  base64: false,
};

/** Longest edge after re-encoding, in pixels. */
export const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.7;

/** The slice of each native module this file uses; tests pass fakes. */
export interface PhotoNative {
  picker: {
    requestCameraPermissionsAsync: () => Promise<{ granted: boolean }>;
    launchCameraAsync: (options: ImagePickerOptions) => Promise<ImagePickerResult>;
    launchImageLibraryAsync: (options: ImagePickerOptions) => Promise<ImagePickerResult>;
  };
  /** Decode `uri`, fit it inside `resize`, and save it as a JPEG with no metadata. */
  reencode: (
    uri: string,
    resize: { width: number } | { height: number } | null,
    compress: number,
  ) => Promise<Pick<Manipulator.ImageResult, 'uri' | 'width' | 'height'>>;
}

function loadNative(): PhotoNative | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see the header */
    const picker = require('expo-image-picker') as PhotoNative['picker'];
    const { ImageManipulator, SaveFormat: Format } =
      require('expo-image-manipulator') as typeof Manipulator;
    /* eslint-enable @typescript-eslint/no-require-imports */
    return {
      picker,
      reencode: async (uri, resize, compress) => {
        const context = ImageManipulator.manipulate(uri);
        try {
          if (resize) context.resize(resize);
          const image = await context.renderAsync();
          try {
            return await image.saveAsync({ compress, format: Format.JPEG });
          } finally {
            image.release();
          }
        } finally {
          context.release();
        }
      },
    };
  } catch {
    return null;
  }
}

let native: PhotoNative | null | undefined;
function getNative(): PhotoNative | null {
  if (native === undefined) native = loadNative();
  return native;
}

/** Tests only: stand in for the native modules (`undefined` = load them again). */
export function setPhotoNativeForTests(value: PhotoNative | null | undefined): void {
  native = value;
}

/** False on a binary built before the picker was added: the photo button says so. */
export function photosAvailable(): boolean {
  return getNative() !== null;
}

/** The resize that fits a width × height image inside MAX_EDGE, or null when it already fits. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_EDGE,
): { width: number } | { height: number } | null {
  if (!(width > max || height > max)) return null;
  return width >= height ? { width: max } : { height: max };
}

/** The slot extension for a mime type the bucket accepts. */
export function extFor(mime: string): 'jpg' | 'png' | 'webp' {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Take or choose one photo. Resolves null when the person cancels; throws
 * PhotoError('unavailable') on a binary without the picker and
 * PhotoError('permission') when the camera is switched off. The library needs
 * no permission (the system photo picker on both platforms).
 */
export async function pickPhoto(source: PhotoSource): Promise<PickedPhoto | null> {
  const n = getNative();
  if (!n) throw new PhotoError('unavailable');
  if (source === 'camera') {
    const permission = await n.picker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PhotoError('permission');
  }
  const result =
    source === 'camera'
      ? await n.picker.launchCameraAsync(PICK_OPTIONS)
      : await n.picker.launchImageLibraryAsync(PICK_OPTIONS);
  const asset: ImagePickerAsset | undefined = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const out = await n.reencode(asset.uri, fitWithin(asset.width, asset.height), JPEG_QUALITY);
  return { uri: out.uri, width: out.width, height: out.height, mime: 'image/jpeg' };
}

export interface PhotoDeps {
  client: Client;
  fetch: (uri: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
}

// The app's client, resolved on first use rather than imported, so loading this
// module never loads react-native (see the header).
function appDeps(): PhotoDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { supabase } = require('../../lib/supabase') as typeof AppClient;
  return { client: supabase, fetch: (uri) => fetch(uri) };
}

/**
 * Upload one picked photo and return its storage path, for the recording RPC
 * to claim. The slot is minted first; the RPC is called with the path only
 * after this resolves. Server refusals (FORBIDDEN, UPLOAD_LIMIT) and storage
 * errors are thrown as they come, for mapErrorToKey.
 */
export async function uploadStaffPhoto(
  venueId: string,
  folder: PhotoFolder,
  photo: PickedPhoto,
  deps: PhotoDeps = appDeps(),
): Promise<string> {
  const { data, error } = await deps.client.schema('app').rpc('staff_media_slot', {
    p_venue_id: venueId,
    p_folder: folder,
    p_ext: extFor(photo.mime),
  });
  if (error) throw error;
  const path = (data as { path?: unknown } | null)?.path;
  if (typeof path !== 'string') throw new Error('staff_media_slot returned no path');

  const body = await (await deps.fetch(photo.uri)).arrayBuffer();
  const upload = await deps.client.storage
    .from(STAFF_MEDIA_BUCKET)
    .upload(path, body, { contentType: photo.mime, upsert: false });
  if (upload.error) throw upload.error;
  return path;
}

/** A 10-minute signed URL to show a stored work photo (§2.3). */
export async function staffPhotoUrl(
  path: string,
  client: Client = appDeps().client,
): Promise<string> {
  const { data, error } = await client.storage.from(STAFF_MEDIA_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
