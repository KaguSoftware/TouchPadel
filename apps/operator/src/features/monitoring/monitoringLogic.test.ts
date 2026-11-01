import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  barShare,
  bucketFor,
  detailEntries,
  fillBuckets,
  filterArgs,
  levelTone,
  readEventsPage,
  readSummary,
} from './monitoringLogic';

const NOW = new Date('2026-11-01T10:30:00Z');

describe('monitoring logic', () => {
  it('sends "all" filters as null and the period as a range', () => {
    const args = filterArgs(DEFAULT_FILTERS, NOW);
    expect(args).toEqual({
      p_from: '2026-10-31T10:30:00.000Z',
      p_to: '2026-11-01T10:30:00.000Z',
      p_source: null,
      p_level: null,
      p_kind: null,
      p_user_reported: null,
    });
    const narrow = filterArgs({ period: '7d', source: 'edge', level: 'error', kind: 'crash', userReported: true }, NOW);
    expect(narrow).toMatchObject({ p_source: 'edge', p_level: 'error', p_kind: 'crash', p_user_reported: true });
  });

  it('buckets by the hour for a day, by the day beyond', () => {
    expect(bucketFor('24h')).toBe('hour');
    expect(bucketFor('7d')).toBe('day');
  });

  it('reads the events page defensively', () => {
    const page = readEventsPage({
      rows: [{ id: 3, at: '2026-11-01T10:00:00Z', source: 'mobile', level: 'warn', kind: 'crash', message: 'm', detail: { a: 1 }, userReported: true }],
      nextBeforeId: 3,
    });
    expect(page.rows[0]).toMatchObject({ id: 3, source: 'mobile', level: 'warn', userReported: true, signedIn: false, venueName: null });
    expect(page.nextBeforeId).toBe(3);
    expect(readEventsPage(null)).toEqual({ rows: [], nextBeforeId: null });
    expect(readEventsPage({ rows: [{ source: 'mars', level: 'loud' }] }).rows[0]).toMatchObject({ source: 'web', level: 'error' });
  });

  it('reads the summary defensively', () => {
    const s = readSummary({ bucket: 'day', totals: { total: '4', error: 3 }, counts: [{ bucket: 'x', total: 4 }] });
    expect(s.bucket).toBe('day');
    expect(s.totals).toEqual({ total: 4, error: 3, warn: 0, info: 0, userReported: 0 });
    expect(readSummary(undefined).counts).toEqual([]);
  });

  it('fills every hour of the last day, quiet ones as zero, in Baghdad hours', () => {
    const filled = fillBuckets([{ bucket: '2026-11-01T09:00:00Z', error: 1, warn: 0, info: 0, total: 1 }], '24h', NOW);
    expect(filled).toHaveLength(24);
    expect(filled.at(-1)!.total).toBe(0);
    expect(filled.at(-2)).toMatchObject({ bucket: '2026-11-01T09:00:00Z', total: 1 });
  });

  it('places a Baghdad-midnight day bucket on today', () => {
    // Baghdad's 1 November starts at 21:00 UTC on 31 October.
    const filled = fillBuckets([{ bucket: '2026-10-31T21:00:00Z', error: 0, warn: 2, info: 0, total: 2 }], '7d', NOW);
    expect(filled).toHaveLength(7);
    expect(filled.at(-1)).toMatchObject({ total: 2 });
  });

  it('bar heights and tones', () => {
    expect(barShare(0, 10)).toBe(0);
    expect(barShare(5, 0)).toBe(0);
    expect(barShare(10, 10)).toBe(1);
    expect(barShare(1, 1000)).toBe(0.04);
    expect(levelTone('error')).toBe('danger');
    expect(levelTone('warn')).toBe('warn');
    expect(levelTone('info')).toBe('info');
  });

  it('lists the detail with the stack last', () => {
    expect(detailEntries({ stack: 's', route: '/till', n: { a: 1 } }).map((e) => e.key)).toEqual(['route', 'n', 'stack']);
  });
});
