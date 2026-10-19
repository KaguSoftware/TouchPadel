import { describe, expect, it, vi } from 'vitest';
import { makeT, type MessageKey } from '@touch/i18n';

vi.mock('../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));

import { canAccess, type StaffRole } from '../lib/auth';
import { buildGoToEntries, normalizeQuery, rankEntries } from './GoToPalette';
import { rowShown, type NavItem, type NavTab } from '../lib/workspaces';

const en = makeT('en') as (k: MessageKey) => string;
const ar = makeT('ar') as (k: MessageKey) => string;

function entriesFor(role: StaffRole, live = true) {
  const canOpenTab = (tab: NavTab) => canAccess(role, tab.to) && (tab.when !== 'onlinePaymentsLive' || live);
  return buildGoToEntries(
    'management',
    en,
    [en, ar],
    (row: NavItem) => rowShown(row, (p) => canAccess(role, p), canOpenTab),
    canOpenTab,
  );
}

describe('normalizeQuery', () => {
  it('folds case, Arabic letter forms, diacritics and punctuation', () => {
    expect(normalizeQuery('  Late & Early ')).toBe('late early');
    expect(normalizeQuery('أسعار الملاعب')).toBe('اسعار الملاعب');
    expect(normalizeQuery('القاصَة')).toBe('القاصه');
    expect(normalizeQuery('Who’s on now')).toBe('who s on now');
  });
});

describe('buildGoToEntries', () => {
  it('lists every page and tab of Management, each with where it lives', () => {
    const entries = entriesFor('owner');
    const safe = entries.find((e) => e.to === '/safe')!;
    expect(safe.label).toBe('Main cash');
    expect(safe.trail).toBe('Financial › Cash');
    // The same page showing what was paid out is Pay's.
    expect(entries.find((e) => e.to === '/safe' && e.search?.show === 'payments')?.trail).toBe('Financial › Pay');
    expect(entries.find((e) => e.to === '/admin/settings/deposit')?.trail).toBe('Courts › Court settings');
    expect(entries.find((e) => e.to === '/panel')?.trail).toBe('Management');
    // The manager's versions of the owner's pages are not offered to the owner.
    expect(entries.map((e) => e.to)).not.toContain('/ops');
    expect(entries.map((e) => e.to)).not.toContain('/desk');
    expect(entries.map((e) => e.to)).not.toContain('/till/tabs');
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('offers only what the person may open', () => {
    const manager = entriesFor('manager').map((e) => e.to);
    expect(manager).not.toContain('/observation/requests');
    // Today, the desk calendar and the open tabs stand in for the owner's Overview and boards.
    expect(manager).toEqual(expect.arrayContaining(['/ops', '/desk', '/till/tabs']));
    expect(manager).not.toContain('/panel');
    expect(manager).not.toContain('/observation/courts');
    expect(manager).not.toContain('/wages');
    expect(manager).toContain('/safe');
    expect(manager).toContain('/stock/counts');
    // Conditional tabs follow their condition.
    expect(entriesFor('owner', false).map((e) => e.to)).not.toContain('/admin/settings/deposit');
  });

  it('keeps one entry for a page reached twice, answering to both names', () => {
    const entries = entriesFor('manager');
    const stock = entries.filter((e) => e.to === '/stock');
    expect(stock).toHaveLength(1);
    expect(rankEntries(entries, 'on hand')[0]?.to).toBe('/stock');
  });
});

describe('rankEntries', () => {
  const entries = entriesFor('owner');

  it('finds a page by its name, its place or another word for it, in either language', () => {
    expect(rankEntries(entries, 'deposit')[0]?.to).toBe('/admin/settings/deposit');
    expect(rankEntries(entries, 'عربون')[0]?.to).toBe('/admin/settings/deposit');
    expect(rankEntries(entries, 'late')[0]?.to).toBe('/attendance');
    expect(rankEntries(entries, 'kitchen')[0]?.to).toBe('/admin/settings/kitchen');
    expect(rankEntries(entries, 'القاصة')[0]?.to).toBe('/safe');
    expect(rankEntries(entries, 'opening hours')[0]?.to).toBe('/admin/hours');
  });

  it('puts a name that starts with the query first', () => {
    const results = rankEntries(entries, 'stock');
    expect(results[0]?.label.toLowerCase().startsWith('stock')).toBe(true);
  });

  it('shows everything for an empty query and nothing for nonsense', () => {
    expect(rankEntries(entries, '   ')).toHaveLength(entries.length);
    expect(rankEntries(entries, 'zzqx')).toEqual([]);
  });
});
