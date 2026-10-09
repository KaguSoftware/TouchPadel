import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';
import {
  checkSupplierUrl,
  decodeHtml,
  fetchSupplierPage,
  isBlockedAddress,
  pinnedLookup,
  type PinnedRequest,
  type RawResponse,
  type ResolvedAddress,
  type SupplierFetchDeps,
} from './supplier-fetch';

// No real network anywhere in this file: DNS and the transport are injected.
// What is under test is the policy between them — which URLs and addresses are
// refused, how redirects are re-vetted, and the caps.

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };

function page(
  body: Buffer | string,
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' },
  status = 200,
): RawResponse {
  return { status, headers, body: Readable.from([typeof body === 'string' ? Buffer.from(body) : body]) };
}

function redirect(location: string, status = 302): RawResponse {
  return { status, headers: { location }, body: Readable.from([]) };
}

interface Harness {
  deps: SupplierFetchDeps;
  requests: PinnedRequest[];
  lookups: string[];
}

function harness(
  respond: (req: PinnedRequest) => RawResponse | Promise<RawResponse>,
  dnsTable: Record<string, ResolvedAddress[]> = {},
  over: Partial<SupplierFetchDeps> = {},
): Harness {
  const requests: PinnedRequest[] = [];
  const lookups: string[] = [];
  return {
    requests,
    lookups,
    deps: {
      appVersion: '1.2.3',
      lookup: async (host) => {
        lookups.push(host);
        return dnsTable[host] ?? [PUBLIC];
      },
      request: async (req) => {
        requests.push(req);
        return respond(req);
      },
      ...over,
    },
  };
}

describe('checkSupplierUrl (mirrors app.set_shop_price_watch)', () => {
  it('accepts an ordinary https product page', () => {
    expect(checkSupplierUrl('https://shop.example.com/p/racket-123?size=m')?.hostname).toBe('shop.example.com');
    expect(checkSupplierUrl('https://shop.example.com:443/p')).not.toBeNull();
  });

  it.each([
    ['http, not https', 'http://shop.example.com/p'],
    ['another scheme', 'ftp://shop.example.com/p'],
    ['a port', 'https://shop.example.com:8443/p'],
    ['userinfo', 'https://user:pw@shop.example.com/p'],
    ['a bare username', 'https://admin@shop.example.com/p'],
    ['an IPv4 literal', 'https://93.184.216.34/p'],
    ['an IPv4 literal in decimal', 'https://2130706433/p'],
    ['an IPv4 literal in hex', 'https://0x7f.0.0.1/p'],
    ['an IPv6 literal', 'https://[2606:4700::1]/p'],
    ['localhost', 'https://localhost/p'],
    ['localhost with a trailing dot', 'https://localhost./p'],
    ['.local', 'https://printer.local/p'],
    ['.localhost', 'https://app.localhost/p'],
    ['.internal', 'https://db.corp.internal/p'],
    ['.lan', 'https://router.lan/p'],
    ['.home.arpa', 'https://nas.home.arpa/p'],
    ['an undotted name', 'https://intranet/p'],
    ['whitespace', 'https://shop.example.com/p q'],
    ['a control character', 'https://shop.example.com/p\u0000'],
    ['not a URL', 'not a url'],
    ['empty', ''],
    ['over 2000 characters', `https://shop.example.com/${'a'.repeat(2000)}`],
  ])('refuses %s', (_why, url) => {
    expect(checkSupplierUrl(url)).toBeNull();
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.251',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.1.10',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    '64:ff9b::808:808',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%en0',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    '2002:c0a8:101::1',
    '3fff::1',
    'not-an-address',
  ])('refuses %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '100.63.255.255', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(false);
    },
  );
});

describe('fetchSupplierPage', () => {
  it('fetches a page: pinned to the vetted address, with the shop user agent', async () => {
    const h = harness(() => page('<html><body>15,000 IQD</body></html>'));
    const r = await fetchSupplierPage('https://shop.example.com/p/1', h.deps);
    expect(r).toEqual({ ok: true, html: '<html><body>15,000 IQD</body></html>', finalUrl: 'https://shop.example.com/p/1' });
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.addresses).toEqual([PUBLIC]);
    expect(h.requests[0]!.url.hostname).toBe('shop.example.com');
    expect(h.requests[0]!.headers).toMatchObject({
      'User-Agent': 'TouchPadelShop/1.2.3 (supplier price check)',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Encoding': 'gzip, deflate, br',
    });
  });

  it('refuses a bad URL before any DNS or connection', async () => {
    const h = harness(() => page('x'));
    expect(await fetchSupplierPage('http://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'blocked_url' });
    expect(h.lookups).toEqual([]);
    expect(h.requests).toEqual([]);
  });

  it('refuses a name whose DNS answer is private, without connecting', async () => {
    const h = harness(() => page('x'), { 'rebind.example.com': [{ address: '192.168.1.1', family: 4 }] });
    expect(await fetchSupplierPage('https://rebind.example.com/p', h.deps)).toEqual({ ok: false, error: 'blocked_url' });
    expect(h.requests).toEqual([]);
  });

  it('refuses when ANY answer is private, even if another is public', async () => {
    const h = harness(() => page('x'), {
      'mixed.example.com': [PUBLIC, { address: '::1', family: 6 }],
    });
    expect(await fetchSupplierPage('https://mixed.example.com/p', h.deps)).toEqual({ ok: false, error: 'blocked_url' });
    expect(h.requests).toEqual([]);
  });

  it('a DNS failure or an empty answer is fetch_failed', async () => {
    const h = harness(() => page('x'), { 'empty.example.com': [] }, {});
    expect(await fetchSupplierPage('https://empty.example.com/p', h.deps)).toEqual({ ok: false, error: 'fetch_failed' });
    const h2 = harness(() => page('x'), {}, {
      lookup: async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      },
    });
    expect(await fetchSupplierPage('https://gone.example.com/p', h2.deps)).toEqual({ ok: false, error: 'fetch_failed' });
  });

  it('follows a relative redirect and reports where it landed', async () => {
    const h = harness((req) =>
      req.url.pathname === '/old' ? redirect('/new?x=1', 301) : page('<html>moved</html>'),
    );
    const r = await fetchSupplierPage('https://shop.example.com/old', h.deps);
    expect(r).toEqual({ ok: true, html: '<html>moved</html>', finalUrl: 'https://shop.example.com/new?x=1' });
    expect(h.lookups).toEqual(['shop.example.com', 'shop.example.com']);
  });

  it('re-resolves every hop and refuses a redirect to a host that resolves private', async () => {
    const h = harness(
      (req) => (req.url.hostname === 'shop.example.com' ? redirect('https://inside.example.net/admin') : page('x')),
      { 'inside.example.net': [{ address: '10.0.0.5', family: 4 }] },
    );
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'blocked_url' });
    expect(h.lookups).toEqual(['shop.example.com', 'inside.example.net']);
    expect(h.requests).toHaveLength(1);
  });

  it.each([
    ['plain http', 'http://shop.example.com/p'],
    ['an IP literal', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', 'https://localhost/p'],
    ['a LAN name', 'https://router.lan/'],
    ['another port', 'https://shop.example.com:8080/p'],
  ])('refuses a redirect to %s', async (_why, location) => {
    const h = harness(() => redirect(location, 307));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'blocked_url' });
    expect(h.requests).toHaveLength(1);
  });

  it('gives up after four redirects', async () => {
    let n = 0;
    const h = harness(() => redirect(`/hop-${++n}`, 308));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'fetch_failed' });
    expect(h.requests).toHaveLength(5);
  });

  it('a redirect with no Location is fetch_failed', async () => {
    const h = harness(() => ({ status: 302, headers: {}, body: Readable.from([]) }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'fetch_failed' });
  });

  it('an HTTP error carries its status', async () => {
    const h = harness(() => page('gone', { 'content-type': 'text/html' }, 404));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({
      ok: false,
      error: 'http_error',
      status: 404,
    });
  });

  it('refuses a body that is not HTML', async () => {
    const h = harness(() => page('{"price":1}', { 'content-type': 'application/json' }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'not_html' });
    const h2 = harness(() => page('x', {}));
    expect(await fetchSupplierPage('https://shop.example.com/p', h2.deps)).toEqual({ ok: false, error: 'not_html' });
  });

  it('accepts xhtml', async () => {
    const h = harness(() => page('<html/>', { 'content-type': 'application/xhtml+xml' }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toMatchObject({ ok: true });
  });

  it('caps the body: too_large past the limit', async () => {
    const h = harness(() => page('x'.repeat(2048)), {}, { maxBytes: 1024 });
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'too_large' });
  });

  it('refuses up front when Content-Length is already over the cap', async () => {
    const h = harness(() => page('small', { 'content-type': 'text/html', 'content-length': '99999' }), {}, {
      maxBytes: 1024,
    });
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'too_large' });
  });

  it('caps AFTER decompression, so a gzip bomb is too_large', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(64 * 1024, 0x61));
    expect(bomb.length).toBeLessThan(1024);
    const h = harness(() => page(bomb, { 'content-type': 'text/html', 'content-encoding': 'gzip' }), {}, {
      maxBytes: 4096,
    });
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'too_large' });
  });

  it.each([
    ['gzip', zlib.gzipSync],
    ['deflate', zlib.deflateSync],
    ['br', zlib.brotliCompressSync],
  ] as const)('decompresses %s', async (encoding, compress) => {
    const html = '<html><span itemprop="price">25000</span></html>';
    const h = harness(() => page(compress(Buffer.from(html)), { 'content-type': 'text/html', 'content-encoding': encoding }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toMatchObject({ ok: true, html });
  });

  it('a corrupt or unknown encoding is fetch_failed', async () => {
    const h = harness(() => page('not gzip at all', { 'content-type': 'text/html', 'content-encoding': 'gzip' }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'fetch_failed' });
    const h2 = harness(() => page('x', { 'content-type': 'text/html', 'content-encoding': 'zstd' }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h2.deps)).toEqual({ ok: false, error: 'fetch_failed' });
  });

  it('decodes with the declared charset', async () => {
    // "سعر" in windows-1256, the charset older Arabic shop sites still serve.
    const bytes = Buffer.from([0xd3, 0xda, 0xd1]);
    const h = harness(() => page(bytes, { 'content-type': 'text/html; charset=windows-1256' }));
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toMatchObject({ ok: true, html: 'سعر' });
  });

  it('times out the whole fetch and aborts the request', async () => {
    let seen: AbortSignal | undefined;
    const h = harness(() => page('never'), {}, {
      timeoutMs: 30,
      request: (req) => {
        seen = req.signal;
        return new Promise<RawResponse>((_resolve, reject) => {
          req.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    });
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'timeout' });
    expect(seen?.aborted).toBe(true);
  });

  it('a transport error is fetch_failed', async () => {
    const h = harness(() => page('x'), {}, {
      request: async () => {
        throw Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
      },
    });
    expect(await fetchSupplierPage('https://shop.example.com/p', h.deps)).toEqual({ ok: false, error: 'fetch_failed' });
  });

  it('runs one fetch at a time', async () => {
    let active = 0;
    let peak = 0;
    const h = harness(() => page('x'), {}, {
      request: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return page('<html>ok</html>');
      },
    });
    const results = await Promise.all(
      ['a', 'b', 'c'].map((p) => fetchSupplierPage(`https://shop.example.com/${p}`, h.deps)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(1);
  });
});

describe('decodeHtml', () => {
  it('falls back to UTF-8 for an unknown or missing charset', () => {
    const buf = Buffer.from('سعر', 'utf8');
    expect(decodeHtml(buf, 'text/html; charset=no-such-charset')).toBe('سعر');
    expect(decodeHtml(buf, 'text/html')).toBe('سعر');
  });

  it('reads a quoted charset', () => {
    expect(decodeHtml(Buffer.from([0xe9]), 'text/html; charset="iso-8859-1"')).toBe('é');
  });
});

describe('pinnedLookup', () => {
  const V6: ResolvedAddress = { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 };
  const lookup = pinnedLookup([V6, PUBLIC]) as unknown as (
    host: string,
    opts: { all?: boolean },
    cb: (err: Error | null, address: unknown, family?: number) => void,
  ) => void;

  it('answers every connect-time lookup with the vetted address, whatever the name', () => {
    const plain: unknown[] = [];
    lookup('rebind.example.com', {}, (...a) => plain.push(...a));
    expect(plain).toEqual([null, V6.address, 6]);
  });

  it('answers the happy-eyeballs form (all: true) with every vetted address, so IPv4 is a fallback', () => {
    const all: unknown[] = [];
    lookup('rebind.example.com', { all: true }, (...a) => all.push(...a));
    expect(all).toEqual([null, [V6, PUBLIC]]);
  });
});
