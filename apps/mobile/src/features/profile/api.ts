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
