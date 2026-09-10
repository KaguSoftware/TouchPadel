import { describe, expect, it } from 'vitest';
import { reportCsv, reportFilename } from './reportCsv';
import { normalizeColumns } from './reportTypes';

describe('reportCsv', () => {
  const cols = normalizeColumns(['court', 'revenue_iqd', 'occupancy_pct'], [{ court: 'A', revenue_iqd: 1, occupancy_pct: 2 }]);
  const label = (c: { key: string }) => c.key.toUpperCase();

  it('writes localised headers, raw numbers and a totals row', () => {
    const csv = reportCsv(cols, [{ court: 'A', revenue_iqd: 15000, occupancy_pct: 42.5 }], { revenue_iqd: 15000, occupancy_pct: 42.5 }, label, 'Total');
    expect(csv.slice(1)).toBe('COURT,REVENUE_IQD,OCCUPANCY_PCT\r\nA,15000,42.5\r\nTotal,15000,42.5\r\n');
  });
  it('omits the totals row when there are no totals', () => {
    const csv = reportCsv(cols, [{ court: 'A', revenue_iqd: 1, occupancy_pct: null }], null, label, 'Total');
    expect(csv.slice(1).split('\r\n')).toHaveLength(3);
    expect(csv.slice(1)).toContain('A,1,\r\n');
  });
  it('keeps a server-provided totals label in the first column', () => {
    const csv = reportCsv(cols, [], { court: 'All', revenue_iqd: 3 }, label, 'Total');
    expect(csv.slice(1)).toContain('All,3,');
  });
});

describe('reportFilename', () => {
  const period = { from: '2026-09-01', to: '2026-09-30' };
  it('names the report, the range and every active filter', () => {
    expect(reportFilename('courts', period, { view: 'byHour', court: '1a2b3c4d-0000-4000-8000-000000000000', pay: undefined })).toBe(
      'courts_2026-09-01_2026-09-30_view-byHour_court-1a2b3c4d.csv',
    );
  });
  it('strips characters that do not belong in a filename', () => {
    expect(reportFilename('cafe', period, { cat: 'hot drinks/tea' })).toBe('cafe_2026-09-01_2026-09-30_cat-hotdrinkstea.csv');
  });
});
