import { createClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

/**
 * Cookie-free, session-free Supabase client for STATIC/ISR server rendering
 * (public pages: landing, /menu). Using next/headers cookies() would force
 * dynamic rendering; the public pages only read anon-visible rows
 * (venue_settings_public, active menu tables, menu_item_availability).
 */
export function createStaticSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
