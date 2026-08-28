import { describe, it, expect } from 'vitest';
import { resolveSupabaseEnv } from './supabase';

// The fallback to the local demo stack used to be unconditional. On a packaged
// station a missing env var would then boot the till against
// 127.0.0.1:54321, find nothing, and look exactly like a network outage — the
// most expensive possible way to be wrong on the one machine whose entire
// degraded-mode story is about telling a real outage from a configuration
// mistake.

describe('resolveSupabaseEnv', () => {
  it('uses the configured values when both are present', () => {
    expect(
      resolveSupabaseEnv({
        VITE_SUPABASE_URL: 'https://abc.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'key-1',
        DEV: false,
      }),
    ).toEqual({ url: 'https://abc.supabase.co', anonKey: 'key-1' });
  });

  it('trims whitespace, which is how a pasted env var usually breaks', () => {
    // The web app lost a whole production evening to a dashboard variable with
    // a second line glued on (HANDOFF gotchas, 2026-08-24).
    expect(
      resolveSupabaseEnv({
        VITE_SUPABASE_URL: '  https://abc.supabase.co  ',
        VITE_SUPABASE_ANON_KEY: ' key-1 ',
        DEV: false,
      }),
    ).toEqual({ url: 'https://abc.supabase.co', anonKey: 'key-1' });
  });

  it('falls back to the local demo stack in a dev build', () => {
    const { url, anonKey } = resolveSupabaseEnv({ DEV: true });
    expect(url).toBe('http://127.0.0.1:54321');
    expect(anonKey.startsWith('eyJ')).toBe(true);
  });

  it('throws in a production build when the url is missing', () => {
    expect(() => resolveSupabaseEnv({ VITE_SUPABASE_ANON_KEY: 'key-1', DEV: false })).toThrow(
      /VITE_SUPABASE_URL/,
    );
  });

  it('throws in a production build when the key is missing', () => {
    expect(() =>
      resolveSupabaseEnv({ VITE_SUPABASE_URL: 'https://abc.supabase.co', DEV: false }),
    ).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it('names both variables when both are missing', () => {
    expect(() => resolveSupabaseEnv({ DEV: false })).toThrow(
      /VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY/,
    );
  });

  it('treats an empty string as missing, not as a value', () => {
    expect(() =>
      resolveSupabaseEnv({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_ANON_KEY: 'key-1', DEV: false }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });
});
