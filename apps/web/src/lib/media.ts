import { supabaseEnv } from './supabase/env';

/**
 * Public URLs for the `menu-media` storage bucket (0027 / 0031). Paths are
 * storage keys like `items/{uuid}/{version}.jpg` or `hero/{name}.mp4`; every
 * segment is URI-encoded so Arabic filenames and spaces survive the round trip.
 */

const BUCKET = 'menu-media';

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.replace(/^\/+/, '');
  if (trimmed === '') return null;
  let base: string;
  try {
    base = supabaseEnv().url;
  } catch {
    return null; // no env → no media (never throw during render)
  }
  const encoded = trimmed.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

export function isVideoPath(path: string | null | undefined): boolean {
  return Boolean(path && VIDEO_EXT.test(path));
}
