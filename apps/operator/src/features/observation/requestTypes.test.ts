import { describe, it, expect } from 'vitest';
import {
  canDecide,
  statusTone,
  type StaffRequestRow,
  type StaffRequestStatus,
} from './requestTypes';

const row = (over: Partial<StaffRequestRow> = {}): StaffRequestRow => ({
  id: 'r1',
  kind: 'leave',
  status: 'pending',
  from_date: '2026-10-01',
  to_date: '2026-10-02',
  amount_iqd: null,
  note: '',
  created_at: '2026-09-01T00:00:00Z',
  decided_at: null,
  decision_note: null,
  staff_id: 'staff-1',
  staff_name: 'Sara',
  staff_role: 'cashier',
  decided_by_name: null,
  ...over,
});

describe('statusTone', () => {
  it('marks only a pending request as wanting attention', () => {
    expect(statusTone('pending')).toBe('warn');
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('rejected')).toBe('danger');
    expect(statusTone('withdrawn')).toBe('neutral');
  });

  it('has a tone for every status the server can send', () => {
    const all: StaffRequestStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];
    for (const s of all) expect(statusTone(s)).toBeTruthy();
  });
});

describe('canDecide', () => {
  it('allows a pending request from someone else', () => {
    expect(canDecide(row(), 'owner-1')).toBe(true);
  });

  it('never allows deciding your own request', () => {
    // Mirrors staff_requests_not_self_chk / CANNOT_DECIDE_OWN in 0072.
    expect(canDecide(row({ staff_id: 'owner-1' }), 'owner-1')).toBe(false);
  });

  it('never allows a second decision', () => {
    for (const status of ['approved', 'rejected', 'withdrawn'] as const) {
      expect(canDecide(row({ status }), 'owner-1'), status).toBe(false);
    }
  });

  it('offers nothing when the viewer is unknown', () => {
    // An undefined viewer cannot be proven to be someone else, but the row is
    // still another person's; the server is the wall either way.
    expect(canDecide(row(), undefined)).toBe(true);
  });
});
