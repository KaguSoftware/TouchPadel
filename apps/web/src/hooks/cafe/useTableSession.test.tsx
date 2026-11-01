import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { forgetTableBoot, useTableSession } from './useTableSession';

/**
 * The café table binding in the browser (F-42). The hook never holds the token: it signs in
 * anonymously, then asks `/{locale}/menu/table` (with the `x-tp-table` header) to open the
 * session from the HttpOnly cookie on the server. When the session runs out it asks the same
 * route to clear the cookie, so a later visit to the menu is a walk-in's.
 */
const auth = vi.hoisted(() => ({
  session: null as object | null,
  signIns: 0,
}));

// One client for the page, as the real hook's module-scope cache gives.
const client = vi.hoisted(() => ({
  auth: {
    getSession: () => Promise.resolve({ data: { session: auth.session } }),
    signInAnonymously: () => {
      auth.signIns += 1;
      auth.session = { user: { id: 'anon' } };
      return Promise.resolve({ error: null });
    },
  },
}));

vi.mock('./useSupabase', () => ({ useSupabase: () => client }));

type Call = { url: string; method: string; header: string | null };
let calls: Call[] = [];
let postBody: unknown;

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, method: init.method ?? 'GET', header: headers.get('x-tp-table') });
      if (init.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(JSON.stringify(postBody), { status: 200 }));
    }),
  );
}

const bound = (expiresAt: string) => ({
  name: 'bound',
  session: {
    sessionId: 's1',
    tableId: 't1',
    tableNumber: '4',
    expiresAt,
    bellEnabled: true,
    venueId: 'v1',
  },
});

beforeEach(() => {
  auth.session = null;
  auth.signIns = 0;
  calls = [];
  forgetTableBoot();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each(['en', 'ar'])('useTableSession (%s)', (locale) => {
  it('stays a walk-in with no table cookie, and calls nothing', () => {
    const { result } = renderHook(() => useTableSession(false, locale));
    expect(result.current.state).toBe('none');
    expect(calls).toEqual([]);
  });

  it('signs in anonymously, then has the server bind the table: no token in the browser', async () => {
    postBody = bound(new Date(Date.now() + 60 * 60_000).toISOString());
    const { result } = renderHook(() => useTableSession(true, locale));
    await waitFor(() => expect(result.current.state).toBe('bound'));

    expect(auth.signIns).toBe(1);
    expect(calls).toEqual([{ url: `/${locale}/menu/table`, method: 'POST', header: '1' }]);
    expect(result.current.session?.tableNumber).toBe('4');
    expect(result.current.bellEnabled).toBe(true);
  });

  it('shows the dead-QR state when the server refused the token', async () => {
    postBody = { name: 'invalid' };
    const { result } = renderHook(() => useTableSession(true, locale));
    await waitFor(() => expect(result.current.state).toBe('invalid'));
  });

  it('becomes a walk-in when the cookie aged out before the bind', async () => {
    postBody = { name: 'none' };
    const { result } = renderHook(() => useTableSession(true, locale));
    await waitFor(() => expect(result.current.state).toBe('none'));
  });

  it('is an error, with a working retry, when the route fails', async () => {
    postBody = 'garbage';
    const { result } = renderHook(() => useTableSession(true, locale));
    await waitFor(() => expect(result.current.state).toBe('error'));

    postBody = bound(new Date(Date.now() + 60 * 60_000).toISOString());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('bound'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('clears the table cookie on the server when the session runs out', async () => {
    postBody = bound(new Date(Date.now() - 1_000).toISOString());
    const { result } = renderHook(() => useTableSession(true, locale));
    await waitFor(() => expect(result.current.state).toBe('expired'));
    expect(calls).toContainEqual({ url: `/${locale}/menu/table`, method: 'DELETE', header: '1' });
  });

  it('markExpired (a write the server refused as expired) clears the cookie too', async () => {
    postBody = bound(new Date(Date.now() + 60 * 60_000).toISOString());
    const { result } = renderHook(() => useTableSession(true, locale));
    await waitFor(() => expect(result.current.state).toBe('bound'));
    act(() => result.current.markExpired());
    expect(result.current.state).toBe('expired');
    expect(calls.at(-1)).toEqual({ url: `/${locale}/menu/table`, method: 'DELETE', header: '1' });
  });
});
