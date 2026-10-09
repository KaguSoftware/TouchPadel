import { describe, expect, it } from 'vitest';
import {
  READ_ERRORS,
  RECHECK_AFTER_MS,
  SUPPLIER_URL_MAX,
  alertsFor,
  checkSupplierUrl,
  crawlOrder,
  crawlerRuns,
  isDue,
  isNewPriceToApply,
  pageOutcome,
  reportArgs,
  type PriceWatchRow,
} from './priceWatchLogic';

const watch = (variant_id: string, part: Partial<PriceWatchRow> = {}): PriceWatchRow => ({
  variant_id,
  url: `https://supplier.example.iq/p/${variant_id}`,
  supplier_price_iqd: null,
  previous_price_iqd: null,
  price_changed_at: null,
  checked_at: null,
  read_ok_at: null,
  last_error: null,
  ...part,
});

describe('checkSupplierUrl (mirrors app.set_shop_price_watch)', () => {
  it('takes a public https product page, trimmed', () => {
    expect(checkSupplierUrl('  https://shop.example.iq/products/vertex-04?variant=1  ')).toEqual({ ok: true, url: 'https://shop.example.iq/products/vertex-04?variant=1' });
    expect(checkSupplierUrl('https://www.padel-store.com:443/p/1')).toEqual({ ok: true, url: 'https://www.padel-store.com:443/p/1' });
  });

  it('tidies an upper-case scheme', () => {
    expect(checkSupplierUrl('HTTPS://shop.example.iq/x')).toEqual({ ok: true, url: 'https://shop.example.iq/x' });
  });

  it('reads a blank field as "remove the link"', () => {
    expect(checkSupplierUrl('')).toEqual({ ok: true, url: null });
    expect(checkSupplierUrl('   ')).toEqual({ ok: true, url: null });
  });

  it.each([
    ['http://shop.example.iq/p/1', 'https'],
    ['shop.example.iq/p/1', 'https'],
    ['ftp://shop.example.iq/p/1', 'https'],
    ['https://shop.example.iq/a b', 'invalid'],
    ['https://shop.example.iq/a\tb', 'invalid'],
    ['https://user:pw@shop.example.iq/p', 'invalid'],
    ['https://shop@evil.example/p', 'invalid'],
    ['https://intranet/p/1', 'invalid'],
    ['https://a.b', 'invalid'],
    ['https://shop..example.iq/p', 'invalid'],
    ['https://127.0.0.1/p/1', 'privateHost'],
    ['https://10.0.0.5:8443/p', 'privateHost'],
    ['https://[::1]/p', 'privateHost'],
    ['https://0x7f000001/p', 'privateHost'],
    ['https://0x7f.0.0.1/p', 'privateHost'],
    ['https://127.1/p', 'privateHost'],
    ['https://localhost./p', 'privateHost'],
    ['https://printer.local./p', 'privateHost'],
    ['https://shop.example.iq\\@evil/p', 'invalid'],
    ['https://shop.example.iq%2f@x/p', 'invalid'],
    ['https://%31%32%37.0.0.1/p', 'invalid'],
    ['https://shop.example.iq:443:1/p', 'invalid'],
    ['https://localhost/p/1', 'privateHost'],
    ['https://printer.local/p', 'privateHost'],
    ['https://nas.home.arpa/p', 'privateHost'],
    ['https://api.internal/p', 'privateHost'],
    ['https://router.lan/p', 'privateHost'],
    ['https://dev.localhost/p', 'privateHost'],
  ])('refuses %s (%s)', (raw, error) => {
    expect(checkSupplierUrl(raw)).toEqual({ ok: false, error });
  });

  it('refuses a link longer than 2000 characters', () => {
    const base = 'https://shop.example.iq/p?q=';
    expect(checkSupplierUrl(base + 'x'.repeat(SUPPLIER_URL_MAX - base.length))).toMatchObject({ ok: true });
    expect(checkSupplierUrl(base + 'x'.repeat(SUPPLIER_URL_MAX - base.length + 1))).toEqual({ ok: false, error: 'tooLong' });
  });
});

describe('isDue / crawlOrder', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('is due when never checked, or checked 30 minutes ago or more', () => {
    // Half the hour: room for a long pass and a PC clock behind the server's.
    expect(RECHECK_AFTER_MS).toBe(30 * 60_000);
    expect(isDue({ checked_at: null }, now)).toBe(true);
    expect(isDue({ checked_at: ago(RECHECK_AFTER_MS) }, now)).toBe(true);
    expect(isDue({ checked_at: ago(RECHECK_AFTER_MS - 1) }, now)).toBe(false);
    expect(isDue({ checked_at: ago(5 * 60_000) }, now)).toBe(false);
    expect(isDue({ checked_at: 'not a date' }, now)).toBe(true);
  });

  it('reads never-checked links first, then the longest unread, and skips fresh ones', () => {
    const order = crawlOrder(
      [
        watch('b', { checked_at: ago(2 * 60 * 60_000) }),
        watch('fresh', { checked_at: ago(10 * 60_000) }),
        watch('new2'),
        watch('a', { checked_at: ago(3 * 60 * 60_000) }),
        watch('new1'),
      ],
      now,
    ).map((w) => w.variant_id);
    expect(order).toEqual(['new1', 'new2', 'a', 'b']);
  });
});

describe('crawlerRuns', () => {
  it('runs only on a configured shop desk with someone signed in', () => {
    expect(crawlerRuns({ mode: 'shop', configured: true }, true)).toBe(true);
    expect(crawlerRuns({ mode: 'shop', configured: true }, false)).toBe(false);
    expect(crawlerRuns({ mode: 'shop', configured: false }, true)).toBe(false);
    expect(crawlerRuns({ mode: 'till', configured: true }, true)).toBe(false);
    expect(crawlerRuns({ mode: 'desk', configured: true }, true)).toBe(false);
  });
});

describe('pageOutcome / reportArgs', () => {
  const productPage = '<script type="application/ld+json">{"@type":"Product","offers":{"price":"45000","priceCurrency":"IQD"}}</script>';

  it('turns a page into a price', () => {
    const outcome = pageOutcome({ ok: true, html: productPage, finalUrl: 'https://s.example.iq/p' });
    expect(outcome).toEqual({ kind: 'price', priceIqd: 45000 });
    expect(reportArgs(watch('v1'), outcome as { kind: 'price'; priceIqd: number })).toEqual({
      p_variant_id: 'v1',
      p_url: 'https://supplier.example.iq/p/v1',
      p_price_iqd: 45000,
    });
  });

  it('turns an unreadable page into its read error', () => {
    expect(pageOutcome({ ok: true, html: '<html></html>', finalUrl: 'https://s.example.iq/p' })).toEqual({ kind: 'error', error: 'no_price' });
    const outcome = pageOutcome({ ok: false, error: 'timeout' });
    expect(outcome).toEqual({ kind: 'error', error: 'timeout' });
    expect(reportArgs(watch('v1'), outcome as { kind: 'error'; error: 'timeout' })).toEqual({ p_variant_id: 'v1', p_url: 'https://supplier.example.iq/p/v1', p_error: 'timeout' });
  });

  it('picks the watched link’s variant on a page that lists every variant', () => {
    const variants =
      '<script type="application/ld+json">{"@type":"Product","offers":[' +
      '{"price":"90000","priceCurrency":"IQD","url":"https://s.example.iq/p?variant=1"},' +
      '{"price":"95000","priceCurrency":"IQD","url":"https://s.example.iq/p?variant=2"}]}</script>';
    expect(pageOutcome({ ok: true, html: variants, finalUrl: 'https://s.example.iq/p' }, 'https://s.example.iq/p?variant=2')).toEqual({ kind: 'price', priceIqd: 95000 });
    // No watched link: the final URL decides (here it names no variant).
    expect(pageOutcome({ ok: true, html: variants, finalUrl: 'https://s.example.iq/p' })).toEqual({ kind: 'error', error: 'ambiguous' });
  });

  it('stops on a fetch error that is not about the page', () => {
    expect(pageOutcome({ ok: false, error: 'not_shop_station' })).toEqual({ kind: 'stop' });
    expect(pageOutcome({ ok: false, error: 'unavailable' })).toEqual({ kind: 'stop' });
    // A refusal from main this build does not know is not sent on as a read error.
    expect(pageOutcome({ ok: false, error: 'bad request' } as unknown as Parameters<typeof pageOutcome>[0])).toEqual({ kind: 'stop' });
  });

  it('reports only the closed list of read errors', () => {
    for (const error of ['blocked_url', 'http_error', 'timeout', 'too_large', 'not_html', 'fetch_failed'] as const) {
      const outcome = pageOutcome({ ok: false, error, status: 503 });
      expect(outcome.kind === 'error' && READ_ERRORS.includes(outcome.error)).toBe(true);
    }
  });
});

describe('alertsFor', () => {
  const line = (id: string, price: number) => ({ variant: { id, price_iqd: price } });

  it('lists sizes whose supplier price is not the shop price, latest change first', () => {
    const lines = [line('a', 10_000), line('b', 20_000), line('c', 30_000), line('d', 40_000), line('e', 50_000)];
    const watches = [
      watch('a', { supplier_price_iqd: 12_000, price_changed_at: '2026-10-07T09:00:00Z' }),
      watch('b', { supplier_price_iqd: 20_000, price_changed_at: '2026-10-08T09:00:00Z' }), // same: no alert
      watch('c', { supplier_price_iqd: 33_000, price_changed_at: '2026-10-08T10:00:00Z' }),
      watch('d', { supplier_price_iqd: 41_000 }), // first read already differs: no change time, last
      watch('e'), // never read
    ];
    const alerts = alertsFor(lines, watches);
    expect(alerts.map((a) => [a.line.variant.id, a.supplierPriceIqd])).toEqual([
      ['c', 33_000],
      ['a', 12_000],
      ['d', 41_000],
    ]);
  });

  it('ignores a watch whose size is not on the screen', () => {
    expect(alertsFor([line('a', 1)], [watch('gone', { supplier_price_iqd: 5 })])).toEqual([]);
  });
});

describe('isNewPriceToApply', () => {
  it('is a change the shop does not already sell at, and nothing else', () => {
    expect(isNewPriceToApply({ status: 'changed', supplier_price_iqd: 25_000, shop_price_iqd: 20_000 })).toBe(true);
    expect(isNewPriceToApply({ status: 'changed', supplier_price_iqd: 20_000, shop_price_iqd: 20_000 })).toBe(false);
    expect(isNewPriceToApply({ status: 'first', supplier_price_iqd: 25_000, shop_price_iqd: 20_000 })).toBe(false);
    expect(isNewPriceToApply({ status: 'same', supplier_price_iqd: 25_000, shop_price_iqd: 20_000 })).toBe(false);
    expect(isNewPriceToApply({ status: 'error', supplier_price_iqd: 25_000, shop_price_iqd: 20_000 })).toBe(false);
    expect(isNewPriceToApply({ status: 'stale' })).toBe(false);
    expect(isNewPriceToApply(null)).toBe(false);
  });
});
