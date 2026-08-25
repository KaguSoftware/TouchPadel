/**
 * Supabase Storage helpers for the public `menu-media` bucket (db-slice.md
 * §0031). Path conventions: `items/{item_id}/{uuid}.webp`,
 * `categories/{category_id}/{uuid}.webp`, `hero/{uuid}.webp|mp4|webm`.
 * Every upload gets a NEW name (no cache-busting); the caller removes the old
 * object after the matching `set_*_photo` / `set_cafe_setting` RPC succeeds.
 */
import { supabase } from './supabase';

export const MEDIA_BUCKET = 'menu-media';
/** One month — objects are immutable (new name per upload). */
export const MEDIA_CACHE_CONTROL = '2592000';

export type MediaFolder = 'items' | 'categories' | 'hero';
export type MediaExt = 'webp' | 'jpg' | 'png' | 'mp4' | 'webm';

const CONTENT_TYPES: Record<MediaExt, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** Build a bucket path; `ownerId` is the item/category id (ignored for `hero`). */
export function mediaPath(folder: MediaFolder, ownerId: string | null, ext: MediaExt): string {
  const name = `${crypto.randomUUID()}.${ext}`;
  if (folder === 'hero') return `hero/${name}`;
  if (!ownerId) throw new Error(`ownerId is required for ${folder} media`);
  return `${folder}/${ownerId}/${name}`;
}

/** True for paths shaped like our conventions (mirrors `app.is_media_path`). */
export function isMediaPath(path: string): boolean {
  return /^(items|categories)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$|^hero\/[0-9a-f-]{36}\.(webp|jpg|png|mp4|webm)$/i.test(
    path,
  );
}

export function isVideoPath(path: string | null | undefined): boolean {
  return !!path && /\.(mp4|webm)$/i.test(path);
}

/** Upload a blob; resolves to the stored path (store THAT, not the URL). */
export async function uploadMedia(
  folder: MediaFolder,
  ownerId: string | null,
  blob: Blob,
  ext: MediaExt,
): Promise<string> {
  const path = mediaPath(folder, ownerId, ext);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    cacheControl: MEDIA_CACHE_CONTROL,
    contentType: blob.type || CONTENT_TYPES[ext],
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Public URL for a stored path (bucket is public-read; no image transforms — Pro feature). */
export function publicUrl(path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Best-effort delete — never blocks a save; a stale object is only wasted space. */
export async function removeMedia(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  } catch {
    /* orphaned objects are harmless; a later sweep can reclaim them */
  }
}
