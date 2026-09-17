import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));

import { matchesTable } from './QrPage';

describe('matchesTable', () => {
  const t5 = { table_number: 'T5', zone: 'Terrace' };
  it('finds a table by number or zone, ignoring case and spaces around the query', () => {
    expect(matchesTable(t5, '')).toBe(true);
    expect(matchesTable(t5, ' t5 ')).toBe(true);
    expect(matchesTable(t5, 'terr')).toBe(true);
    expect(matchesTable(t5, 'T6')).toBe(false);
    expect(matchesTable({ table_number: 'T5', zone: null }, 'terr')).toBe(false);
  });
});
