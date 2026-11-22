import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { bpToPercentText, isBanned, parseCustomerRules, percentTextToBp, ruleWords } from './customerRules';

const tr = makeT('en');

describe('customerRules (0449)', () => {
  it('reads the server answer and drops anything malformed', () => {
    const r = parseCustomerRules({
      ban: { reason: 'Fought', by: { id: 's1', name: 'Ali' }, at: '2026-11-21T10:00:00Z' },
      tags: [{ id: 't1', name: 'Family', cafe_bp: 1500, court_bp: 1500, set_by: { id: 's2', name: 'Noor' }, set_at: 'x' }, { name: 'no id' }],
      effective: { cafe: { kind: 'percent', value: 1500, tag: 'Family' }, court: { kind: 'bogus', value: 1 }, reason: 'tag' },
      coming: { bookings: 2, seats: 1 },
      is_staff: false,
      catalog: [{ id: 't1', name: 'Family', cafe_bp: 1500, court_bp: 1500, members: 3 }, 7],
      can_manage: true,
    });
    expect(r.ban).toEqual({ reason: 'Fought', by: { id: 's1', name: 'Ali' }, at: '2026-11-21T10:00:00Z' });
    expect(r.tags).toHaveLength(1);
    expect(r.effective).toEqual({ cafe: { kind: 'percent', value: 1500, tag: 'Family' }, court: null, reason: 'tag' });
    expect(r.coming).toEqual({ bookings: 2, seats: 1 });
    expect(r.catalog).toEqual([{ id: 't1', name: 'Family', cafe_bp: 1500, court_bp: 1500, members: 3 }]);
    expect(r.canManage).toBe(true);
    expect(parseCustomerRules(null)).toMatchObject({ ban: null, tags: [], effective: null, catalog: [], canManage: false });
  });

  it('turns typed percents into basis points and back', () => {
    expect(percentTextToBp('')).toBeNull();
    expect(percentTextToBp(' 15 ')).toBe(1500);
    expect(percentTextToBp('12.5%')).toBe(1250);
    expect(percentTextToBp('12,5')).toBe(1250);
    expect(percentTextToBp('100')).toBe(10_000);
    expect(percentTextToBp('0')).toBe('invalid');
    expect(percentTextToBp('101')).toBe('invalid');
    expect(percentTextToBp('abc')).toBe('invalid');
    expect(bpToPercentText(1500)).toBe('15');
    expect(bpToPercentText(1250)).toBe('12.5');
    expect(bpToPercentText(null)).toBe('');
  });

  it('says a rule in words', () => {
    expect(ruleWords({ cafe_bp: 1500, court_bp: 1500 }, tr, 'en')).toBe('15% off everything');
    expect(ruleWords({ cafe_bp: 1000, court_bp: 3000 }, tr, 'en')).toBe('10% off café & shop · 30% off court fee');
    expect(ruleWords({ cafe_bp: null, court_bp: 3000 }, tr, 'en')).toBe('30% off court fee');
    expect(ruleWords({ cafe_bp: null, court_bp: null }, tr, 'en')).toBe('No discount');
  });

  it('finds the full ban in any flag list, not the open-match ban', () => {
    expect(isBanned([{ type: 'vip' }, { type: 'ban' }])).toBe(true);
    expect(isBanned([{ type: 'match_ban' }])).toBe(false);
    expect(isBanned(undefined)).toBe(false);
  });
});
