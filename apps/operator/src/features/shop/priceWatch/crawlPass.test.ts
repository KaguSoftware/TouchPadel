import { describe, expect, it, vi } from 'vitest';
import type { SupplierPageResult } from '../../../ipc/bridge';
import { runCrawlPass, type CrawlPorts } from './crawlPass';
import { PAGE_GAP_MS, PASS_INTERVAL_MS, type PriceWatchRow } from './priceWatchLogic';

const NOW = new Date('2026-10-08T12:00:00Z');

const watch = (variant_id: string, checked_at: string | null = null): PriceWatchRow => ({
  variant_id,
  url: `https://supplier.example.iq/p/${variant_id}`,
  supplier_price_iqd: null,
  previous_price_iqd: null,
  price_changed_at: null,
  checked_at,
  read_ok_at: null,
  last_error: null,
});

const priced = (price: string): SupplierPageResult => ({
  ok: true,
  html: `<meta property="product:price:amount" content="${price}"><meta property="product:price:currency" content="IQD">`,
  finalUrl: 'https://supplier.example.iq/p',
});

function ports(watches: PriceWatchRow[], pages: Record<string, SupplierPageResult>, part: Partial<CrawlPorts> = {}) {
  const p = {
    listWatches: vi.fn(async () => watches),
    fetchPage: vi.fn(async (url: string) => pages[url] ?? { ok: false as const, error: 'fetch_failed' as const }),
    report: vi.fn(async () => ({ status: 'same' })),
    sleep: vi.fn(async () => {}),
    now: () => NOW,
    stopped: () => false,
    skipRefusal: (e: unknown) => e instanceof Error && e.message === 'VENUE_MISMATCH',
    ...part,
  };
  return p;
}

describe('runCrawlPass', () => {
  it('reads each due link in turn, a gap between pages, and reports a price or a read error', async () => {
    const p = ports([watch('a'), watch('fresh', '2026-10-08T11:50:00Z'), watch('b')], {
      'https://supplier.example.iq/p/a': priced('45,000'),
      'https://supplier.example.iq/p/b': { ok: false, error: 'http_error', status: 404 },
    });
    expect(await runCrawlPass(p)).toEqual({ ran: true, reported: 2, stoppedEarly: false });
    expect(vi.mocked(p.fetchPage).mock.calls.map((c) => c[0])).toEqual(['https://supplier.example.iq/p/a', 'https://supplier.example.iq/p/b']);
    expect(vi.mocked(p.report).mock.calls).toEqual([
      [{ p_variant_id: 'a', p_url: 'https://supplier.example.iq/p/a', p_price_iqd: 45000 }],
      [{ p_variant_id: 'b', p_url: 'https://supplier.example.iq/p/b', p_error: 'http_error' }],
    ]);
    expect(vi.mocked(p.sleep).mock.calls).toEqual([[PAGE_GAP_MS]]);
  });

  it('ends the pass without reporting when this is not a shop desk', async () => {
    const p = ports([watch('a'), watch('b')], {
      'https://supplier.example.iq/p/a': { ok: false, error: 'not_shop_station' },
    });
    expect(await runCrawlPass(p)).toEqual({ ran: true, reported: 0, stoppedEarly: true });
    expect(p.report).not.toHaveBeenCalled();
    expect(p.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops between pages once told to (signed out, offline, unmounted)', async () => {
    let stop = false;
    const p = ports([watch('a'), watch('b')], { 'https://supplier.example.iq/p/a': priced('1000'), 'https://supplier.example.iq/p/b': priced('2000') }, {
      stopped: () => stop,
      report: vi.fn(async () => {
        stop = true;
      }),
    });
    expect(await runCrawlPass(p)).toEqual({ ran: true, reported: 1, stoppedEarly: true });
    expect(p.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reads past a refusal about one watch, then throws it', async () => {
    const p = ports([watch('bad'), watch('good')], { 'https://supplier.example.iq/p/bad': priced('1000'), 'https://supplier.example.iq/p/good': priced('2000') }, {
      report: vi.fn(async (args: { p_variant_id: string }) => {
        if (args.p_variant_id === 'bad') throw new Error('VENUE_MISMATCH');
        return { status: 'same' };
      }),
    });
    await expect(runCrawlPass(p)).rejects.toThrow('VENUE_MISMATCH');
    expect(vi.mocked(p.report).mock.calls.map((c) => c[0].p_variant_id)).toEqual(['bad', 'good']);
  });

  it('ends the pass on any other report failure', async () => {
    const p = ports([watch('a'), watch('b')], { 'https://supplier.example.iq/p/a': priced('1000'), 'https://supplier.example.iq/p/b': priced('2000') }, {
      report: vi.fn(async () => Promise.reject(new Error('offline'))),
    });
    await expect(runCrawlPass(p)).rejects.toThrow('offline');
    expect(p.fetchPage).toHaveBeenCalledTimes(1);
  });

  /**
   * Two hourly passes over a long catalogue on a fake clock: every page costs
   * the gap plus a 2 s fetch (5 s), and the server stamps checked_at when each
   * report lands. `behindMs`: how far the PC's clock runs behind the server's.
   */
  async function twoPasses(links: number, behindMs: number) {
    let serverMs = NOW.getTime();
    const rows = Array.from({ length: links }, (_, i) => watch(`v${String(i).padStart(3, '0')}`));
    const read: string[][] = [];
    const pass = async () => {
      const urls: string[] = [];
      await runCrawlPass(
        ports(rows, {}, {
          listWatches: vi.fn(async () => rows.map((r) => ({ ...r }))),
          fetchPage: vi.fn(async (url: string) => {
            serverMs += 2_000;
            urls.push(url);
            return priced('1000');
          }),
          report: vi.fn(async (args: { p_variant_id: string }) => {
            rows.find((r) => r.variant_id === args.p_variant_id)!.checked_at = new Date(serverMs).toISOString();
            return { status: 'same' };
          }),
          sleep: vi.fn(async (ms: number) => {
            serverMs += ms;
          }),
          now: () => new Date(serverMs - behindMs),
        }),
      );
      read.push(urls);
    };
    const firstStart = serverMs;
    await pass();
    serverMs = firstStart + PASS_INTERVAL_MS;
    await pass();
    return read;
  }

  it('reads every link every hour, even when a pass runs for minutes', async () => {
    const [first, second] = await twoPasses(100, 0);
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
  });

  it('reads every link every hour on a PC whose clock runs 10 minutes behind', async () => {
    const [first, second] = await twoPasses(100, 10 * 60_000);
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
  });

  it('is single-flight: a second start while one runs does nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = ports([watch('a')], { 'https://supplier.example.iq/p/a': priced('1000') }, {
      fetchPage: vi.fn(async () => {
        await gate;
        return priced('1000');
      }),
    });
    const first = runCrawlPass(slow);
    const second = ports([watch('a')], {});
    expect(await runCrawlPass(second)).toEqual({ ran: false });
    expect(second.listWatches).not.toHaveBeenCalled();
    release();
    expect(await first).toEqual({ ran: true, reported: 1, stoppedEarly: false });
    // And free again once it is done, even after a failure.
    const failing = ports([watch('a')], { 'https://supplier.example.iq/p/a': priced('1000') }, { report: vi.fn(async () => Promise.reject(new Error('offline'))) });
    await expect(runCrawlPass(failing)).rejects.toThrow('offline');
    expect(await runCrawlPass(ports([], {}))).toEqual({ ran: true, reported: 0, stoppedEarly: false });
  });
});
