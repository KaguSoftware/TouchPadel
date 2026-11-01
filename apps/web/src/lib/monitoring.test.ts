/**
 * Dev monitoring from the web site (F-15, F-43; 0393): one POST to
 * /rest/v1/rpc/report_event with the anon key and the app profile, one retry,
 * and never a throw: not on a network failure, not on missing env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportError, reportEvent } from './monitoring';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe('web reportEvent', () => {
  it('posts the event to app.report_event as the web source, scrubbed', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const out = await settle(
      reportEvent({ level: 'error', kind: 'web_error', message: 'menu failed for a@b.com', detail: { token: 't', table: 4 } }),
    );
    expect(out).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/report_event');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', 'content-profile': 'app' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ p_source: 'web', p_kind: 'web_error', p_message: 'menu failed for [email]', p_user_reported: false });
    expect(body.p_detail).toMatchObject({ table: 4, side: 'server' });
    expect(body.p_detail).not.toHaveProperty('token');
  });

  it('retries once after a failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true });
    await expect(settle(reportEvent({ level: 'error', kind: 'crash', message: 'x' }))).resolves.toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws: two failures answer failed', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(settle(reportEvent({ level: 'error', kind: 'crash', message: 'x' }))).resolves.toBe('failed');
  });

  it('never throws when the env is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(settle(reportError('crash', new Error('boom'), { userReported: true }))).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
