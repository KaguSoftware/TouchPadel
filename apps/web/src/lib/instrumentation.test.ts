import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maskPath, onRequestError } from '../../instrumentation';

/**
 * Server errors reach dev monitoring (F-43) without the credentials some addresses carry.
 */
const reports = vi.hoisted(() => [] as { kind: string; detail?: Record<string, unknown> }[]);
vi.mock('@/lib/monitoring', () => ({
  reportError: (kind: string, _e: unknown, opts: { detail?: Record<string, unknown> } = {}) => {
    reports.push({ kind, detail: opts.detail });
    return Promise.resolve('sent');
  },
}));

beforeEach(() => {
  reports.length = 0;
});

describe('instrumentation onRequestError', () => {
  it('masks table and match tokens and drops the query', () => {
    expect(maskPath('/t/abc123')).toBe('/t/[token]');
    expect(maskPath('/en/t/abc123?x=1')).toBe('/en/t/[token]');
    expect(maskPath('/ar/m/tok-9/')).toBe('/ar/m/[token]/');
    expect(maskPath('/en/pay/return?ref=7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30')).toBe('/en/pay/return');
    expect(maskPath('/ar/menu')).toBe('/ar/menu');
  });

  it('reports a server render error as web_error, with the route and the digest', async () => {
    const err = Object.assign(new Error('boom'), { digest: 'dg-1' });
    await onRequestError(
      err,
      { path: '/ar/t/secret-token?y=2', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/[locale]/menu',
        routeType: 'render',
        renderSource: 'server-rendering',
        revalidateReason: undefined,
        renderType: 'dynamic',
      } as Parameters<typeof onRequestError>[2],
    );
    expect(reports).toEqual([
      {
        kind: 'web_error',
        detail: {
          where: 'server',
          path: '/ar/t/[token]',
          method: 'GET',
          routePath: '/[locale]/menu',
          routeType: 'render',
          digest: 'dg-1',
        },
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain('secret-token');
  });
});
