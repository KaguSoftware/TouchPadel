/**
 * The guest's profile photo (Edit profile, 0302).
 *
 * The photo lives in the private `avatars` bucket at `<profile id>/<uuid>.jpg`.
 * The guest uploads into their own folder, then `app.set_my_avatar` points the
 * profile at it and queues the previous photo for removal (protocol-action
 * removes it on its next tick). The guest and staff read it through a signed
 * URL; nothing is public.
 *
 * Picking is src/features/staff/photo.ts's `pickAvatarPhoto` (the only file
 * that may load the picker). This module imports nothing native at load, so it
 * runs under vitest with the client injected.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type * as AppClient from '../../lib/supabase';

type Client = SupabaseClient<Database>;

export const AVATAR_BUCKET = 'avatars';
/** How long a signed avatar URL lives; the query refetches well before it ends. */
export const AVATAR_URL_TTL_S = 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The object name for a new photo, as `app.is_avatar_path` accepts it. */
export function avatarObjectPath(profileId: string, id: string): string {
  if (!UUID_RE.test(profileId) || !UUID_RE.test(id)) throw new Error('AVATAR_PATH_INVALID');
  return `${profileId}/${id}.jpg`;
}

export interface AvatarDeps {
  client: Client;
  fetch: (uri: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  /** A fresh lower-case v4 uuid. */
  uuid: () => string;
}

// The app's client and expo-crypto, resolved on first use so loading this
// module never loads react-native or a native module.
function appDeps(): AvatarDeps {
  /* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose, see the header */
  const { supabase } = require('../../lib/supabase') as typeof AppClient;
  const Crypto = require('expo-crypto') as { randomUUID: () => string };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { client: supabase, fetch: (uri) => fetch(uri), uuid: () => Crypto.randomUUID().toLowerCase() };
}

/**
 * Upload a picked (already re-encoded JPEG) photo and make it the profile's.
 * Returns the new path. When the profile update is refused, the upload is
 * removed again so it never sits in the folder unclaimed.
 */
export async function replaceAvatar(
  profileId: string,
  photoUri: string,
  deps: AvatarDeps = appDeps(),
): Promise<string> {
  const path = avatarObjectPath(profileId, deps.uuid());
  const body = await (await deps.fetch(photoUri)).arrayBuffer();
  const upload = await deps.client.storage
    .from(AVATAR_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (upload.error) throw upload.error;

  const { error } = await deps.client.schema('app').rpc('set_my_avatar', { p_path: path });
  if (error) {
    await deps.client.storage.from(AVATAR_BUCKET).remove([path]);
    throw error;
  }
  return path;
}

/** Back to initials. The old photo is queued for removal by the server. */
export async function removeAvatar(client: Client = appDeps().client): Promise<void> {
  const { error } = await client
    .schema('app')
    // NULL clears it; the generated type only knows a value.
    .rpc('set_my_avatar', { p_path: null as unknown as string });
  if (error) throw error;
}

/** A signed URL to show a stored avatar. */
export async function avatarUrl(path: string, client: Client = appDeps().client): Promise<string> {
  const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrl(path, AVATAR_URL_TTL_S);
  if (error) throw error;
  return data.signedUrl;
}
