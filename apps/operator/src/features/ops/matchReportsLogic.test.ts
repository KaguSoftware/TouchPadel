import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import { REPORT_REASONS, reportActions, reportCategoryKey, reportReasonKey, reportRefusalRefetches, showReportsPanel, sortReports } from './matchReportsLogic';

describe('reportReasonKey', () => {
  it('words every match_reports.reason, and an unknown one as Other', () => {
    expect(REPORT_REASONS.map((r) => t('en', reportReasonKey(r)))).toEqual(['Offensive name', 'Abusive behaviour', 'Harassment', 'Unsafe play', 'No-show', 'Other']);
    expect(reportReasonKey('spam')).toBe('ws.matches.ops.reason.other');
    expect(reportReasonKey(null)).toBe('ws.matches.ops.reason.other');
  });
});

describe('sortReports', () => {
  it('oldest first, stable by id, a report with no time last', () => {
    const rows = [
      { report_id: 'c', created_at: '2026-09-28T10:00:00Z' },
      { report_id: 'none', created_at: null },
      { report_id: 'b', created_at: '2026-09-27T10:00:00Z' },
      { report_id: 'a', created_at: '2026-09-27T10:00:00Z' },
    ];
    expect(sortReports(rows).map((r) => r.report_id)).toEqual(['a', 'b', 'c', 'none']);
  });
});

describe('reportActions (ban visibility)', () => {
  const who = (over: Record<string, unknown> = {}) => ({
    customer_id: 'c1',
    full_name: 'Omar Khalid',
    phone: null,
    flags: [],
    banned: false,
    reports_90d: 2,
    no_shows: 1,
    ...over,
  });

  it('offers Ban until the player is banned; Close always', () => {
    expect(reportActions({ reported: who() })).toEqual({ close: true, ban: true });
    expect(reportActions({ reported: who({ banned: true }) })).toEqual({ close: true, ban: false });
  });

  it('a report whose player is gone can only be closed', () => {
    expect(reportActions({ reported: null })).toEqual({ close: true, ban: false });
    expect(reportActions({ reported: who({ customer_id: null }) })).toEqual({ close: true, ban: false });
  });
});

describe('showReportsPanel', () => {
  it('on Today: only when a report waits', () => {
    expect(showReportsPanel({ rows: 1, hideWhenEmpty: true })).toBe(true);
    expect(showReportsPanel({ rows: 0, hideWhenEmpty: true })).toBe(false);
    expect(showReportsPanel({ rows: null, hideWhenEmpty: true })).toBe(false);
  });

  it('elsewhere: the empty state too, but never on a server without matches', () => {
    expect(showReportsPanel({ rows: 0, hideWhenEmpty: false })).toBe(true);
    expect(showReportsPanel({ rows: null, hideWhenEmpty: false })).toBe(false);
  });
});

describe('refusals and words', () => {
  it('refetches after someone else dealt with the report', () => {
    expect(reportRefusalRefetches('REPORT_CLOSED')).toBe(true);
    expect(reportRefusalRefetches('REPORT_NOT_FOUND')).toBe(true);
    expect(reportRefusalRefetches('FORBIDDEN')).toBe(false);
  });

  it('words the match category', () => {
    expect(t('en', reportCategoryKey('women')!)).toBe('Women');
    expect(reportCategoryKey('mixed')).toBeNull();
  });
});
