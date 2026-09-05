import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { Locale } from '@touch/i18n';

type Client = SupabaseClient<Database>;

export interface ProfileRow {
  id: string;
  full_name: string;
  phone: string | null;
  preferred_lang: string;
  expo_push_token: string | null;
}

export async function fetchOwnProfile(client: Client): Promise<ProfileRow | null> {
  const { data: userData } = await client.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, phone, preferred_lang, expo_push_token')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export async function updatePreferredLang(client: Client, uid: string, lang: Locale) {
  const { error } = await client.from('profiles').update({ preferred_lang: lang }).eq('id', uid);
  if (error) throw error;
}

export async function updatePushToken(client: Client, uid: string, token: string) {
  const { error } = await client.from('profiles').update({ expo_push_token: token }).eq('id', uid);
  if (error) throw error;
}

/**
 * Settings > "Send a test notification": app.send_test_push (migration 0070)
 * queues a real push for the caller's own token and nudges the sender. Raises
 * NO_PUSH_TOKEN / RATE_LIMITED / AUTH_REQUIRED as P0001 — mapped by the screen.
 */
export async function sendTestPush(client: Client): Promise<{ queued: boolean; id: number }> {
  const { data, error } = await client.schema('app').rpc('send_test_push');
  if (error) throw error;
  return data as { queued: boolean; id: number };
}

/** Own contact details (design 2026-08-31: Edit profile). RLS: own row only. */
export async function updateOwnProfile(
  client: Client,
  uid: string,
  fields: { full_name?: string; phone?: string | null; preferred_lang?: Locale },
) {
  const { error } = await client.from('profiles').update(fields).eq('id', uid);
  if (error) throw error;
}

/** Change password for the signed-in guest (design 2026-08-31). */
export async function changePassword(client: Client, newPassword: string) {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
