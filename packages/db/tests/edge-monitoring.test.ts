/**
 * The edge functions' dev-monitoring seam (supabase/functions/_shared/monitoring.ts,
 * 0393): the body it sends, that it never throws or hangs, that handle() reports
 * an escaped throw, and that the email seam sends nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MONITORING_EMAIL_TO,
  notifyByEmail,
  reportBody,
  reportEvent,
  reportUnhandled,
  scrubDetail,
} from '../supabase/functions/_shared/monitoring.ts';
import { handle } from '../supabase/functions/_shared/http.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDeno(env: Record<string, string>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
}

describe('edge monitoring', () => {
  it('builds an edge-source body with a scrubbed detail', () => {
    const body = reportBody({ level: 'error', kind: 'edge_error', message: 'x for a@b.com', detail: { pin: '1', fn: 'replay', phone: '+9647701234567' } });
    expect(body).toMatchObject({ p_source: 'edge', p_level: 'error', p_kind: 'edge_error', p_message: 'x for [email]', p_user_reported: false });
    expect(body.p_detail).toEqual({ fn: 'replay' });
    expect(reportBody({ level: 'bad' as never, kind: 'NOPE', message: '' }).p_kind).toBe('edge_error');
  });

  it('keeps UUIDs whole and masks the phone, as the server does', () => {
    expect(reportBody({ level: 'error', kind: 'edge_error', message: 'c0000000-0000-4000-8000-000000000001 / 07701234567' }).p_message).toBe(
      'c0000000-0000-4000-8000-000000000001 / [number]',
    );
  });

  it('caps a huge detail', () => {
    const out = scrubDetail(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v'.repeat(400)])));
    expect(out.truncated).toBe(true);
  });

  it('sends nothing and answers false without the service env (Node, tests)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(reportEvent({ level: 'error', kind: 'edge_error', message: 'x' })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts with the service role and never throws on a network failure', async () => {
    stubDeno({ SUPABASE_URL: 'http://kong:8000', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(reportEvent({ level: 'warn', kind: 'edge_error', message: 'x' })).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://kong:8000/rest/v1/rpc/report_event');
    expect(init.headers).toMatchObject({ apikey: 'svc', 'content-profile': 'app' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    await expect(reportEvent({ level: 'warn', kind: 'edge_error', message: 'x' })).resolves.toBe(false);
  });

  it('handle() reports a throw that escaped the handler, and still answers 500', async () => {
    stubDeno({ SUPABASE_URL: 'http://kong:8000', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = handle('demo-fn', () => {
      throw new Error('kaboom');
    });
    const res = await fn(new Request('http://x/functions/v1/demo-fn', { method: 'POST' }));
    expect(res.status).toBe(500);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ p_kind: 'edge_error', p_message: 'demo-fn: Error: kaboom' });
    expect(body.p_detail).toMatchObject({ function: 'demo-fn', method: 'POST', path: '/functions/v1/demo-fn' });
  });

  it('reportUnhandled never throws on odd input', async () => {
    await expect(reportUnhandled('f', Symbol('s'))).resolves.toBe(false);
  });

  it('the email seam is a stub to contact@kagusoftware.com that sends nothing', async () => {
    expect(MONITORING_EMAIL_TO).toBe('contact@kagusoftware.com');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(notifyByEmail({ level: 'error', kind: 'crash', message: 'x' })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
