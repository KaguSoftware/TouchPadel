import { describe, expect, it } from 'vitest';
import type { CustomerSearchRow } from '../deskTypes';
import { filterCustomers, nameKey, phoneKey } from './customerDirectoryLogic';

function row(id: string, full_name: string, phone: string | null, bookings = 0, email: string | null = null): CustomerSearchRow {
  return { id, full_name, phone, email, preferred_lang: null, flags: [], counts: { bookings, cancellations: 0, noShows: 0 } };
}

const BOOK = [
  row('a', 'Zainab Ali', '+964 770 111 2233', 2),
  row('b', 'Abdulrahman Saeed', '07801234567', 9, 'abdul@example.com'),
  row('c', 'أحمد كريم', '+964 750 999 8877', 5),
  row('d', 'Sara Mahdi', null, 0, 'sara.m@example.com'),
];

describe('keys mirror the server search', () => {
  it('nameKey lower-cases, folds hamza and taa marbuta, drops harakat and every space', () => {
    expect(nameKey('  Abdul  Rahman ')).toBe('abdulrahman');
    expect(nameKey('أَحمد')).toBe('احمد');
    expect(nameKey('فاطمة')).toBe('فاطمه');
  });

  it('phoneKey keeps digits only and folds Arabic-Indic digits', () => {
    expect(phoneKey('+964 (770) 111-2233')).toBe('9647701112233');
    expect(phoneKey('٠٧٧٠')).toBe('0770');
    expect(phoneKey(null)).toBe('');
  });
});

describe('filterCustomers', () => {
  it('no query: everyone, by name or by most bookings', () => {
    expect(filterCustomers(BOOK, '', 'name').map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(filterCustomers(BOOK, ' ', 'bookings').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('puts accounts with no name last', () => {
    const rows = [row('n', '  ', null), row('m', 'Mona', null)];
    expect(filterCustomers(rows, '', 'name').map((r) => r.id)).toEqual(['m', 'n']);
  });

  it('a one-character query is not a filter yet', () => {
    expect(filterCustomers(BOOK, 'z', 'name')).toHaveLength(4);
  });

  it('matches a name with the space in a different place, and an Arabic name without the hamza', () => {
    expect(filterCustomers(BOOK, 'abdul rah', 'name').map((r) => r.id)).toEqual(['b']);
    expect(filterCustomers(BOOK, 'احمد', 'name').map((r) => r.id)).toEqual(['c']);
  });

  it('matches phone digits typed with spaces or in Arabic-Indic digits', () => {
    expect(filterCustomers(BOOK, '111 22', 'name').map((r) => r.id)).toEqual(['a']);
    expect(filterCustomers(BOOK, '٠٧٨٠١', 'name').map((r) => r.id)).toEqual(['b']);
  });

  it('matches an email fragment', () => {
    expect(filterCustomers(BOOK, 'sara.m@', 'name').map((r) => r.id)).toEqual(['d']);
  });

  it('puts name-prefix hits before substring hits', () => {
    const rows = [row('x', 'Mali Hassan', null), row('y', 'Ali Hassan', null)];
    expect(filterCustomers(rows, 'ali', 'name').map((r) => r.id)).toEqual(['y', 'x']);
  });
});
