import { describe, expect, it } from 'vitest';
import { holdReviewRows, holdStandingActions, parseHoldStanding, showHoldStanding, type HoldStanding } from './holdStandingLogic';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 's-1',
  strikes: 4,
  status: 'suspended',
  last_strike_at: '2026-09-27T10:00:00Z',
  blocked_until: '2026-10-04T10:00:00Z',
  suspended_at: '2026-09-27T10:01:00Z',
  needs_review: true,
  banned_at: null,
  guest_id: 'g-1',
  guest_name: 'Ali',
  guest_phone: '+9647700000001',
  ...over,
});

describe('parseHoldStanding', () => {
  it('reads app.hold_standing_json', () => {
    expect(parseHoldStanding(row())).toEqual({
      id: 's-1',
      strikes: 4,
      status: 'suspended',
      last_strike_at: '2026-09-27T10:00:00Z',
      blocked_until: '2026-10-04T10:00:00Z',
      suspended_at: '2026-09-27T10:01:00Z',
      needs_review: true,
      banned_at: null,
      guest_id: 'g-1',
      guest_name: 'Ali',
      guest_phone: '+9647700000001',
    });
  });

  it('is null for a guest who never struck, and for junk', () => {
    expect(parseHoldStanding(null)).toBeNull();
    expect(parseHoldStanding({})).toBeNull();
    expect(parseHoldStanding('x')).toBeNull();
  });

  it('treats an unknown status as clear rather than inventing one', () => {
    expect(parseHoldStanding(row({ status: 'frozen' }))?.status).toBe('clear');
  });
});

describe('holdReviewRows', () => {
  it('keeps the rows that parse, in order', () => {
    expect(holdReviewRows([row({ id: 'a' }), { nope: true }, row({ id: 'b' })]).map((r) => r.id)).toEqual(['a', 'b']);
    expect(holdReviewRows(null)).toEqual([]);
  });
});

describe('holdStandingActions', () => {
  const s = (status: string) => parseHoldStanding(row({ status })) as HoldStanding;
  it('offers lift for anything but clear, ban for anything but banned', () => {
    expect(holdStandingActions(s('suspended'))).toEqual({ lift: true, ban: true });
    expect(holdStandingActions(s('cooldown'))).toEqual({ lift: true, ban: true });
    expect(holdStandingActions(s('warned'))).toEqual({ lift: true, ban: true });
    expect(holdStandingActions(s('banned'))).toEqual({ lift: true, ban: false });
    expect(holdStandingActions(s('clear'))).toEqual({ lift: false, ban: true });
  });

  it('the customer record hides a clear standing', () => {
    expect(showHoldStanding(null)).toBe(false);
    expect(showHoldStanding(s('clear'))).toBe(false);
    expect(showHoldStanding(s('warned'))).toBe(true);
  });
});
