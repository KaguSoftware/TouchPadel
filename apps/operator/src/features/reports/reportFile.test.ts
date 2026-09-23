import { describe, expect, it } from 'vitest';
import { reportFilename } from './reportFile';

describe('reportFilename', () => {
  const period = { from: '2026-09-01', to: '2026-09-30' };
  // No extension: the exporter adds one, so the rule is about the name alone.
  it('names the report, the range and every active filter', () => {
    expect(reportFilename('courts', period, { view: 'byHour', court: '1a2b3c4d-0000-4000-8000-000000000000', pay: undefined })).toBe(
      'courts_2026-09-01_2026-09-30_view-byHour_court-1a2b3c4d',
    );
  });
  it('strips characters that do not belong in a filename', () => {
    expect(reportFilename('cafe', period, { cat: 'hot drinks/tea' })).toBe('cafe_2026-09-01_2026-09-30_cat-hotdrinkstea');
  });
});
