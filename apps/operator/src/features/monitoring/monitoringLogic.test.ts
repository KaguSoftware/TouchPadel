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
  DASH,
  assistantWeekRows,
  failedCodesTitle,
  noAssistantQuestions,
  readAssistantWeekly,
  weekDate,
  type WeekFormatters,
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

describe('the Assistant table', () => {
  const raw = {
    weeks: [
      {
        weekStart: '2026-11-02',
        weekEnd: '2026-11-08',
        level: 'warn',
        figures: {
          questions: 6,
          answers: 4,
          failed: 2,
          failedByCode: { UPSTREAM: 1, NOT_CONFIGURED: 1 },
          notSaved: 1,
          marked: 1,
          secondsToAnswerP50: 20,
          secondsToAnswerP95: 29,
          costMicros: 4700,
          costPerQuestionMicros: 783,
          thumbsUp: 1,
          thumbsDown: 1,
          rated: 2,
        },
      },
      { weekStart: '2026-10-26', weekEnd: '2026-11-01', level: 'info', figures: { questions: 0, secondsToAnswerP50: null, costPerQuestionMicros: null, rated: 0 } },
    ],
    timezone: 'Asia/Baghdad',
  };
  const fmt: WeekFormatters = {
    number: (n) => String(n),
    date: (d) => d.toISOString().slice(0, 10),
    usd: (m) => `$${(m / 1e6).toFixed(4)}`,
    thumbsOf: (n, rated) => `${n} of ${rated}`,
    range: (from, to) => `${from} to ${to}`,
  };

  it('reads the weeks newest first, nulls kept as null', () => {
    const weeks = readAssistantWeekly(raw);
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-10-26']);
    expect(weeks[0]).toMatchObject({ level: 'warn', questions: 6, failed: 2, notSaved: 1, marked: 1, thumbsDown: 1, rated: 2, secondsP50: 20, costPerQuestionMicros: 783 });
    expect(weeks[1]).toMatchObject({ level: 'info', questions: 0, secondsP50: null, costPerQuestionMicros: null });
    expect(readAssistantWeekly(null)).toEqual([]);
    expect(readAssistantWeekly({ weeks: 'x' })).toEqual([]);
  });

  it('shapes rows: "n of rated", dashes for nothing, the range as the title', () => {
    const rows = assistantWeekRows(readAssistantWeekly(raw), fmt);
    expect(rows[0]).toMatchObject({
      key: '2026-11-02',
      week: '2026-11-02',
      weekTitle: '2026-11-02 to 2026-11-08',
      warn: true,
      questions: '6',
      failed: '2',
      failedTitle: 'UPSTREAM 1, NOT_CONFIGURED 1',
      notSaved: '1',
      marked: '1',
      thumbsDown: '1 of 2',
      median: '20',
      costPerQuestion: '$0.0008',
    });
    expect(rows[1]).toMatchObject({ warn: false, thumbsDown: DASH, median: DASH, costPerQuestion: DASH, failedTitle: '' });
  });

  it('lists the failed codes, most frequent first, ties in the server order', () => {
    expect(failedCodesTitle({ UPSTREAM: 1, NOT_CONFIGURED: 1 })).toBe('UPSTREAM 1, NOT_CONFIGURED 1');
    expect(failedCodesTitle({ TIMEOUT: 1, UPSTREAM: 3, GONE: 0 })).toBe('UPSTREAM 3, TIMEOUT 1');
    expect(failedCodesTitle({})).toBe('');
  });

  it('is empty only when no week had a question', () => {
    const weeks = readAssistantWeekly(raw);
    expect(noAssistantQuestions(weeks)).toBe(false);
    expect(noAssistantQuestions(weeks.slice(1))).toBe(true);
    expect(noAssistantQuestions([])).toBe(true);
  });

  it('reads a week day as that day in Baghdad', () => {
    expect(weekDate('2026-11-02')!.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    expect(weekDate('nope')).toBeNull();
  });

  it('keeps all twelve weeks in the server order (the page caps them at three)', () => {
    const many = { weeks: Array.from({ length: 12 }, (_, i) => ({ weekStart: `2026-08-${String(i + 10).padStart(2, '0')}`, weekEnd: '', level: 'info', figures: { questions: 1 } })) };
    const rows = assistantWeekRows(readAssistantWeekly(many), fmt);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 3).map((r) => r.key)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });
});
