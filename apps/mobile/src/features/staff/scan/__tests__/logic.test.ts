import { describe, expect, it } from 'vitest';
import { RECEIPT_ROLES, SLIP_ROLES, readMyReceipts, readMySlips, scanTone } from '../logic';

describe('scan pages', () => {
  it('names who may use each page, as the server does', () => {
    expect([...SLIP_ROLES]).toEqual(['waiter', 'cashier', 'manager', 'owner']);
    expect([...RECEIPT_ROLES]).toEqual(['driver', 'manager', 'owner']);
  });

  it('reads the slip log defensively; the table resolved beats the one read', () => {
    expect(readMySlips(null)).toEqual([]);
    expect(
      readMySlips({
        slips: [
          { id: 'a', status: 'sent', created_at: 't', table_number: 'T5', table_number_read: '5', line_count: 3 },
          { id: 'b', status: 'odd', table_number_read: '9', rejected_reason: 'dup' },
          'junk',
        ],
      }),
    ).toEqual([
      { id: 'a', status: 'sent', created_at: 't', table_number: 'T5', line_count: 3, rejected_reason: null },
      { id: 'b', status: 'uploaded', created_at: '', table_number: '9', line_count: 0, rejected_reason: 'dup' },
    ]);
  });

  it('reads the receipt log defensively', () => {
    expect(readMyReceipts({ receipts: [{ id: 'r', status: 'confirmed', total_iqd_read: 58000 }] })).toEqual([
      { id: 'r', status: 'confirmed', created_at: '', supplier_name_read: null, total_iqd_read: 58000, rejected_reason: null },
    ]);
    expect(readMyReceipts({})).toEqual([]);
  });

  it('tones each row', () => {
    expect(scanTone('sent')).toBe('good');
    expect(scanTone('confirmed')).toBe('good');
    expect(scanTone('rejected')).toBe('warn');
    expect(scanTone('reading')).toBe('plain');
  });
});
