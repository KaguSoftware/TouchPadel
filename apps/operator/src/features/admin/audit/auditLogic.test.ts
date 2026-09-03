import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  actionFamilies,
  actionFamily,
  actorLabel,
  auditCsv,
  diffFields,
  formatValue,
  inPeriod,
  matchesAudit,
  periodBounds,
  missingReason,
  reasonRequired,
  type AuditRow,
} from './auditLogic';

// SOW L241-243 promises an append-only audit log with actor, action, before,
// after and a reason code on the sensitive actions; L434-439 makes "every
// discount, void and refund traceable to a named actor" an acceptance test.
// The log has been written correctly since day 1 and read by nothing.

function row(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 1,
    at: '2026-08-28T09:00:00.000Z',
    actor_id: 'a0000000-0000-4000-8000-000000000001',
    actor_role: 'manager',
    authorizer_id: null,
    action: 'discount.apply',
    entity: 'tabs',
    entity_id: 'tab-1',
    before: null,
    after: null,
    reason_code: 'comp',
    device_id: 'TILL-01',
    ...over,
  };
}

describe('actionFamily', () => {
  it('takes the dotted prefix', () => {
    expect(actionFamily('reservation.move')).toBe('reservation');
    expect(actionFamily('menu.item.reorder')).toBe('menu');
  });

  it('falls back to the whole action when there is no dot', () => {
    expect(actionFamily('login')).toBe('login');
  });

  it('derives the filter options from the data, not a hard-coded list', () => {
    // A new server-side action must appear in the filter the day it first
    // fires, not when someone remembers to add it here.
    const rows = [row({ action: 'zzz.new' }), row({ action: 'discount.apply' }), row()];
    expect(actionFamilies(rows)).toEqual(['discount', 'zzz']);
  });
});

describe('reason codes', () => {
  it('knows which actions the contract requires a reason for', () => {
    expect(reasonRequired('discount.apply')).toBe(true);
    expect(reasonRequired('order_item.void')).toBe(true);
    expect(reasonRequired('payment.refund')).toBe(true);
    expect(reasonRequired('menu.item.reorder')).toBe(false);
  });

  it('flags a sensitive row that carries no reason', () => {
    // This is the whole reason the column is shown: today `reservation.move`
    // and `reservation.extend` write audit rows with NO reason code, against
    // SOW L313. The viewer must make that visible rather than hide it.
    expect(missingReason(row({ action: 'reservation.move', reason_code: null }))).toBe(true);
    expect(missingReason(row({ action: 'reservation.move', reason_code: 'staff_error' }))).toBe(
      false,
    );
  });

  it('does not flag an action that never needed a reason', () => {
    expect(missingReason(row({ action: 'day.open', reason_code: null }))).toBe(false);
  });
});

describe('matchesAudit', () => {
  it('passes everything through an empty filter', () => {
    expect(matchesAudit(row(), EMPTY_FILTER)).toBe(true);
  });

  it('filters by family', () => {
    expect(matchesAudit(row(), { ...EMPTY_FILTER, family: 'discount' })).toBe(true);
    expect(matchesAudit(row(), { ...EMPTY_FILTER, family: 'reservation' })).toBe(false);
  });

  it('filters by actor', () => {
    expect(matchesAudit(row(), { ...EMPTY_FILTER, actorId: 'someone-else' })).toBe(false);
  });

  it('searches action, entity, entity id, reason, device and role', () => {
    for (const q of ['discount', 'tabs', 'tab-1', 'comp', 'TILL', 'manager']) {
      expect(matchesAudit(row(), { ...EMPTY_FILTER, query: q }), q).toBe(true);
    }
    expect(matchesAudit(row(), { ...EMPTY_FILTER, query: 'nothing-like-this' })).toBe(false);
  });

  it('searches case-insensitively and ignores surrounding space', () => {
    expect(matchesAudit(row(), { ...EMPTY_FILTER, query: '  till-01  ' })).toBe(true);
  });

  it('survives null columns', () => {
    const sparse = row({ reason_code: null, device_id: null, actor_role: null });
    expect(matchesAudit(sparse, { ...EMPTY_FILTER, query: 'tabs' })).toBe(true);
  });

  it('can show only the rows missing a required reason', () => {
    const bad = row({ action: 'order_item.void', reason_code: null });
    const good = row({ action: 'order_item.void', reason_code: 'spill' });
    const irrelevant = row({ action: 'day.open', reason_code: null });
    const filter = { ...EMPTY_FILTER, onlyMissingReason: true };
    expect(matchesAudit(bad, filter)).toBe(true);
    expect(matchesAudit(good, filter)).toBe(false);
    expect(matchesAudit(irrelevant, filter)).toBe(false);
  });
});

describe('diffFields', () => {
  it('lists only what changed', () => {
    // menu_items has eighteen columns; a sold-out toggle changes one. Printing
    // both jsonb blobs is not "before and after values" in any useful sense.
    const changes = diffFields(
      { id: 'i1', name_en: 'Latte', sold_out: false, price: 5000 },
      { id: 'i1', name_en: 'Latte', sold_out: true, price: 5000 },
    );
    expect(changes).toEqual([{ field: 'sold_out', before: 'false', after: 'true' }]);
  });

  it('reports an added field and a removed one', () => {
    expect(diffFields({ a: 1 }, { b: 2 })).toEqual([
      { field: 'a', before: '1', after: '—' },
      { field: 'b', before: '—', after: '2' },
    ]);
  });

  it('treats an insert as every field appearing', () => {
    const changes = diffFields(null, { id: 'i1', name_en: 'Latte' });
    expect(changes.map((c) => c.field)).toEqual(['id', 'name_en']);
    expect(changes.every((c) => c.before === '—')).toBe(true);
  });

  it('returns nothing when both sides are absent', () => {
    expect(diffFields(null, null)).toEqual([]);
  });

  it('compares nested values structurally, not by reference', () => {
    expect(diffFields({ opts: [1, 2] }, { opts: [1, 2] })).toEqual([]);
    expect(diffFields({ opts: [1, 2] }, { opts: [2, 1] })).toHaveLength(1);
  });

  it('sorts fields so the same change always reads the same way', () => {
    expect(diffFields({ z: 1, a: 1 }, { z: 2, a: 2 }).map((c) => c.field)).toEqual(['a', 'z']);
  });
});

describe('formatValue', () => {
  it('renders leaves plainly and absence as an em dash', () => {
    expect(formatValue('Latte')).toBe('Latte');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(false)).toBe('false');
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
  });

  it('falls back to JSON for a structure', () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('actorLabel', () => {
  const names = new Map([['a0000000-0000-4000-8000-000000000001', 'Dev Owner']]);

  it('names a known actor', () => {
    expect(actorLabel('a0000000-0000-4000-8000-000000000001', 'owner', names)).toBe('Dev Owner');
  });

  it('keeps a correlatable id for a guest or a removed staff row', () => {
    // "unknown" alone would make the row untraceable, which is the one thing
    // this log exists to prevent.
    expect(actorLabel('b1111111-2222-4000-8000-000000000009', 'guest', names)).toBe(
      'guest b1111111',
    );
  });

  it('calls an actorless row what it is', () => {
    expect(actorLabel(null, null, names)).toBe('system');
    expect(actorLabel(null, 'service_role', names)).toBe('service_role');
  });
});

describe('periodBounds / inPeriod', () => {
  it('turns an inclusive date range into a half-open instant range', () => {
    const b = periodBounds({ from: '2026-09-01', to: '2026-09-03' });
    expect(new Date(b.fromIso).getDate()).toBe(1);
    // Exclusive upper bound is the START of the 4th, so the whole 3rd is inside.
    expect(new Date(b.toExclusiveIso).getDate()).toBe(4);
    expect(new Date(b.toExclusiveIso).getHours()).toBe(0);
  });
  it('checks a row against the bounds', () => {
    const b = periodBounds({ from: '2026-09-01', to: '2026-09-01' });
    expect(inPeriod({ at: new Date(2026, 8, 1, 12).toISOString() }, b)).toBe(true);
    expect(inPeriod({ at: new Date(2026, 8, 2, 0, 0, 1).toISOString() }, b)).toBe(false);
  });
});

describe('auditCsv', () => {
  it('names the actor and flattens the change list into one cell', () => {
    const names = new Map([['a0000000-0000-4000-8000-000000000001', 'Dev Owner']]);
    const labels = { when: 'When', actor: 'Actor', role: 'Role', authoriser: 'Auth', action: 'Action', entity: 'Record', entityId: 'Id', reason: 'Reason', device: 'Station', changes: 'Changes' };
    const { headers, rows } = auditCsv(labels, [row({ before: { sold_out: false }, after: { sold_out: true } })], names);
    expect(headers).toHaveLength(10);
    expect(rows[0]![1]).toBe('Dev Owner');
    expect(rows[0]![9]).toBe('sold_out: false → true');
  });
});
