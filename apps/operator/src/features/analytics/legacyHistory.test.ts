import { makeT } from '@touch/i18n';
import { describe, expect, it } from 'vitest';
import { legacyNotices, parseLegacyHistory } from './legacyHistory';

const tr = makeT('en');
const text = (n: { text: unknown }) => String(n.text);

describe('pre-system monthly reports in the figures (0349)', () => {
  it('says nothing when the server sent no history or no report touches the range', () => {
    expect(legacyNotices(parseLegacyHistory(undefined), 'panel', tr, 'en')).toEqual([]);
    expect(legacyNotices(parseLegacyHistory({ included: [], partial: [] }), 'panel', tr, 'en')).toEqual([]);
  });

  it('names the months counted, and flags the money a report calls approximate', () => {
    const h = parseLegacyHistory({
      included: [
        { from: '2026-07-01', to: '2026-07-30', revenueApproximate: false },
        { from: '2026-08-01', to: '2026-08-31', revenueApproximate: true },
      ],
      partial: [],
    });
    const n = legacyNotices(h, 'courts', tr, 'en');
    expect(n.map((x) => x.key)).toEqual(['legacy-included', 'legacy-approx']);
    expect(text(n[0]!)).toContain('July 2026 and August 2026');
    expect(text(n[0]!)).toContain('occupancy');
    expect(text(n[1]!)).toMatch(/^August 2026: .*approximate/);
  });

  it('explains a report month the range cuts instead of splitting it', () => {
    const n = legacyNotices(parseLegacyHistory({ included: [], partial: [{ from: '2026-08-01', to: '2026-08-31' }] }), 'panel', tr, 'en');
    expect(n.map((x) => x.key)).toEqual(['legacy-partial']);
    expect(text(n[0]!)).toMatch(/^August 2026: .*whole month/);
  });

  it('keeps each month\'s own bookings and money (0357), unknown as null', () => {
    const h = parseLegacyHistory({
      included: [
        { from: '2026-08-01', to: '2026-08-31', bookings: 203, revenue: 5087250, revenueApproximate: true },
        { from: '2026-09-01', to: '2026-09-30', bookings: '242', revenue: null },
        { from: '2026-06-01', to: '2026-06-30' },
      ],
      partial: [],
    });
    expect(h?.included.map((m) => [m.bookings, m.revenue])).toEqual([
      [203, 5087250],
      [242, null],
      [null, null],
    ]);
  });

  it('reads Arabic month names in Arabic', () => {
    const n = legacyNotices(parseLegacyHistory({ included: [{ from: '2026-06-01', to: '2026-06-30' }], partial: [] }), 'panel', makeT('ar'), 'ar');
    expect(text(n[0]!)).not.toMatch(/June/);
  });
});
