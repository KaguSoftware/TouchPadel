/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Guest site origin printed into table QR cards (e.g. https://touchcafe.iq); unset → no printing. */
  readonly VITE_GUEST_SITE_URL?: string;
  /** Bare semver stamped by operator-release.yml from the tag; unset under vite dev → 'dev'. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
