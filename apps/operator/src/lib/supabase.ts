import { createClient } from '@supabase/supabase-js';

// Renderer Supabase client is for READS + REALTIME ONLY (design-arch.md §2.1).
// Every durable write goes through the IPC bridge (src/ipc/bridge.ts) to the
// main-process SQLite queue — even when online.
// TODO: type as createClient<Database> once @touch/db types.gen.ts is generated.

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // TODO: shared zod env loader (design-arch.md §7). In Electron the station signs in
  // once with its station account (role 'station' — design-arch.md §4).
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env');
}

export const supabase = createClient(url, anonKey);
