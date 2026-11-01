import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TABLE_COOKIE } from '@/lib/security/headers';
import { parseBindResult, TABLE_SESSION_HEADER } from '@/lib/cafe/tableSession';
import { DELETE, POST } from './route';

/**
 * `/{locale}/menu/table` (F-42): the café table is bound on the server, so the token in the
 * HttpOnly `tp-table` cookie never reaches page script. What this proves, in both locales:
 * the session comes back without the token, a refused token and a DELETE clear the cookie
 * (with the same attributes it was set with), a missing cookie is a walk-in, a failure is
 * an `error` that keeps the cookie and reports to monitoring, and a call without the
 * `x-tp-table` header or with a foreign locale is refused before the cookie is read.
 */
const state = vi.hoisted(() => ({
  table: null as string | null,
  set: [] as { name: string; value: string; options: Record<string, unknown> }[],
  rpc: [] as { fn: string; args: unknown }[],
  answer: { data: null as unknown, error: null as { message: string } | null },
  throws: false,
  reports: [] as { level: string; kind: string; detail?: Record<string, unknown> | null }[],
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'tp-table' && state.table !== null ? { name, value: state.table } : undefined,
      set: (name: string, value: string, options: Record<string, unknown>) => {
        state.set.push({ name, value, options });
      },
    }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => {
    if (state.throws) return Promise.reject(new Error('Missing NEXT_PUBLIC_SUPABASE_URL'));
    return Promise.resolve({
      schema: () => ({
        rpc: (fn: string, args: unknown) => {
          state.rpc.push({ fn, args });
          return Promise.resolve(state.answer);
        },
      }),
    });
  },
}));

vi.mock('@/lib/monitoring', () => ({
  reportEvent: (input: { level: string; kind: string; detail?: Record<string, unknown> | null }) => {
    state.reports.push(input);
    return Promise.resolve('sent');
  },
}));

const TOKEN = 'tp-secret-table-token';
const ROW = {
  session_id: 'sess-1',
  table_id: 'table-1',
  table_number: '7',
  expires_at: '2026-11-01T20:00:00Z',
  bell_enabled: true,
  venue_id: 'venue-1',
};

function req(locale: string, method: 'POST' | 'DELETE', header = true): NextRequest {
  return new NextRequest(`http://localhost/${locale}/menu/table`, {
    method,
    headers: header ? { [TABLE_SESSION_HEADER]: '1' } : {},
  });
}
const ctx = (locale: string) => ({ params: Promise.resolve({ locale }) });

beforeEach(() => {
  state.table = TOKEN;
  state.set = [];
  state.rpc = [];
  state.answer = { data: ROW, error: null };
  state.throws = false;
  state.reports = [];
});

describe.each(['en', 'ar'])('menu/table route (%s)', (locale) => {
  it('binds the table from the cookie and answers the session, never the token', async () => {
    const res = await POST(req(locale, 'POST'), ctx(locale));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(parseBindResult(JSON.parse(text))).toEqual({
      name: 'bound',
      session: {
        sessionId: 'sess-1',
        tableId: 'table-1',
        tableNumber: '7',
        expiresAt: '2026-11-01T20:00:00Z',
        bellEnabled: true,
        venueId: 'venue-1',
      },
    });
    expect(state.rpc).toEqual([{ fn: 'open_table_session', args: { p_token: TOKEN } }]);
    expect(state.set).toEqual([]);
  });

  it('is a walk-in when there is no cookie, without calling the server', async () => {
    state.table = null;
    const res = await POST(req(locale, 'POST'), ctx(locale));
    expect(await res.json()).toEqual({ name: 'none' });
    expect(state.rpc).toEqual([]);
  });

  it.each(['TOKEN_INVALID', 'TABLE_NOT_FOUND'])('clears the cookie when the server answers %s', async (code) => {
    state.answer = { data: null, error: { message: code } };
    const res = await POST(req(locale, 'POST'), ctx(locale));
    expect(await res.json()).toEqual({ name: 'invalid' });
    expect(state.set).toHaveLength(1);
    expect(state.set[0]).toMatchObject({
      name: TABLE_COOKIE,
      value: '',
      options: { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax' },
    });
    expect(state.reports).toEqual([]);
  });

  it('keeps the cookie on any other failure, and reports it to monitoring without the token', async () => {
    state.answer = { data: null, error: { message: 'TimeoutError: Request timed out' } };
    const res = await POST(req(locale, 'POST'), ctx(locale));
    expect(await res.json()).toEqual({ name: 'error' });
    expect(state.set).toEqual([]);
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).toMatchObject({ level: 'warn', kind: 'web_error' });
    expect(JSON.stringify(state.reports)).not.toContain(TOKEN);
  });

  it('answers error when the deployment has no Supabase env', async () => {
    state.throws = true;
    const res = await POST(req(locale, 'POST'), ctx(locale));
    expect(await res.json()).toEqual({ name: 'error' });
    expect(state.reports[0]).toMatchObject({ level: 'error', kind: 'web_error' });
  });

  it('answers error for a row it cannot read', async () => {
    state.answer = { data: { nope: true }, error: null };
    const res = await POST(req(locale, 'POST'), ctx(locale));
    expect(await res.json()).toEqual({ name: 'error' });
  });

  it('refuses a call without the x-tp-table header before reading the cookie', async () => {
    const res = await POST(req(locale, 'POST', false), ctx(locale));
    expect(res.status).toBe(403);
    expect(state.rpc).toEqual([]);
    expect((await DELETE(req(locale, 'DELETE', false), ctx(locale))).status).toBe(403);
    expect(state.set).toEqual([]);
  });

  it('DELETE clears the cookie (the session ran out)', async () => {
    const res = await DELETE(req(locale, 'DELETE'), ctx(locale));
    expect(res.status).toBe(204);
    expect(state.set).toHaveLength(1);
    expect(state.set[0]).toMatchObject({ name: TABLE_COOKIE, value: '', options: { maxAge: 0, path: '/' } });
  });
});

it('404s a foreign locale', async () => {
  const res = await POST(req('xx', 'POST'), ctx('xx'));
  expect(res.status).toBe(404);
  expect(state.rpc).toEqual([]);
});
