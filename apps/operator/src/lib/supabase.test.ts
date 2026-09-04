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

// The guard that runs the other way. A dev build pointed at a real project
// heartbeats as a till, and app.is_degraded() is "a till row exists AND none is
// fresh" — so a backgrounded dev window flips the LIVE venue into degraded mode
// for every guest. Measured on hosted 2026-09-04: 10s beats, a 48s gap while
// backgrounded, is_degraded() true for the tail of it. Three occurrences to date.
describe('resolveSupabaseEnv — hosted-in-dev guard', () => {
  const HOSTED = 'https://lczijabnorujcgmbuqlw.supabase.co';

  it('refuses a dev build pointed at a hosted project', () => {
    expect(() =>
      resolveSupabaseEnv({ VITE_SUPABASE_URL: HOSTED, VITE_SUPABASE_ANON_KEY: 'key-1', DEV: true }),
    ).toThrow(/Refusing to run a dev build/);
  });

  it('names the offending url and the escape hatch, so the fix needs no docs', () => {
    // The message IS the documentation: .env.local is gitignored, so whoever
    // hits this has no comment to read.
    let message = "";
    try {
      resolveSupabaseEnv({ VITE_SUPABASE_URL: HOSTED, VITE_SUPABASE_ANON_KEY: "key-1", DEV: true });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(HOSTED);
    expect(message).toContain("VITE_ALLOW_HOSTED=1");
    expect(message).toContain("degraded");
  });

  it('allows it when opted in deliberately', () => {
    expect(
      resolveSupabaseEnv({
        VITE_SUPABASE_URL: HOSTED,
        VITE_SUPABASE_ANON_KEY: 'key-1',
        VITE_ALLOW_HOSTED: '1',
        DEV: true,
      }),
    ).toEqual({ url: HOSTED, anonKey: 'key-1' });
  });

  it('does not fire for the local stack, in any of the forms people write it', () => {
    for (const url of [
      'http://127.0.0.1:54321',
      'http://localhost:54321',
      'http://LOCALHOST:54321',
      'http://[::1]:54321',
    ]) {
      expect(
        resolveSupabaseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'key-1', DEV: true }),
      ).toEqual({ url, anonKey: 'key-1' });
    }
  });

  it('never fires in a production build — a real station IS meant to be hosted', () => {
    expect(
      resolveSupabaseEnv({ VITE_SUPABASE_URL: HOSTED, VITE_SUPABASE_ANON_KEY: 'key-1', DEV: false }),
    ).toEqual({ url: HOSTED, anonKey: 'key-1' });
  });

  it('treats a whitespace-only opt-in as not opted in', () => {
    expect(() =>
      resolveSupabaseEnv({
        VITE_SUPABASE_URL: HOSTED,
        VITE_SUPABASE_ANON_KEY: 'key-1',
        VITE_ALLOW_HOSTED: '  ',
        DEV: true,
      }),
    ).toThrow(/Refusing to run a dev build/);
  });
});
