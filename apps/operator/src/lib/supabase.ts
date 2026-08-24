import { createClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

// Renderer Supabase client. In browser mode (this session) it carries both
// reads AND writes (writes go through app.* RPCs — see lib/appRpc.ts).
// TODO(Electron): durable writes move to the IPC bridge -> SQLite queue; this
// client then returns to READS + REALTIME only (design-arch.md §2.1).

// Local `supabase start` demo defaults so `vite dev` works with zero setup.
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const url = import.meta.env.VITE_SUPABASE_URL ?? LOCAL_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY;

export const supabase = createClient<Database>(url, anonKey);
