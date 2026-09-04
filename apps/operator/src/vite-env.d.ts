/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Opt in to running a DEV build against a hosted project — see lib/supabase.ts. */
  readonly VITE_ALLOW_HOSTED?: string;
  /** Guest site origin printed into table QR cards (e.g. https://touchcafe.iq); unset → no printing. */
  readonly VITE_GUEST_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
