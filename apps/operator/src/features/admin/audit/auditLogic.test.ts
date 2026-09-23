import { describe, it, expect } from 'vitest';
import { makeT } from '@touch/i18n';
import {
  EMPTY_FILTER,
  actionFamilies,
  actionFamily,
  ACTION_KEYS,
  FAMILY_KEYS,
  actorLabel,
  auditCsv,
  codeToKey,
  familyOptions,
  humanizeField,
  isActionCode,
  isTechnicalField,
  knownActionKey,
  knownFamilyKey,
  recordName,
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
    // The audit log RENDERS this role name — a row written by a backend job has
    // actor_role = 'service_role', and the till shows it as such. It is display
    // data, not a credential, so the client-secret guard is suppressed here and
    // nowhere else in this app.
    // eslint-disable-next-line no-restricted-syntax -- role name shown in the audit UI, not a key
    expect(actorLabel(null, 'service_role', names)).toBe('service_role');
  });
});

describe('periodBounds / inPeriod', () => {
  // Baghdad (UTC+3), business days starting at 04:00 as app.business_date counts them.
  const TZ = 'Asia/Baghdad';
  it('turns an inclusive range of business days into a half-open instant range', () => {
    const b = periodBounds({ from: '2026-09-01', to: '2026-09-03' }, 4, TZ);
    expect(b.fromIso).toBe('2026-09-01T01:00:00.000Z'); // 04:00 on the 1st, venue time
    expect(b.toExclusiveIso).toBe('2026-09-04T01:00:00.000Z'); // 04:00 on the 4th
  });
  it("keeps a night's after-midnight tail with its night", () => {
    const b = periodBounds({ from: '2026-09-01', to: '2026-09-01' }, 4, TZ);
    // 22:00 and 01:30 (next calendar day) venue time are both the night of the 1st.
    expect(inPeriod({ at: '2026-09-01T19:00:00.000Z' }, b)).toBe(true);
    expect(inPeriod({ at: '2026-09-01T22:30:00.000Z' }, b)).toBe(true);
    // 04:30 on the 2nd is the next business day.
    expect(inPeriod({ at: '2026-09-02T01:30:00.000Z' }, b)).toBe(false);
  });
});

describe('auditCsv', () => {
  const labels = {
    date: 'Date', time: 'Time', who: 'Who', role: 'Role', authoriser: 'Authorised by',
    what: 'What happened', record: 'Record', field: 'Field changed', was: 'Was', became: 'Became',
    reason: 'Reason', station: 'Station', actionCode: 'Action code', recordType: 'Record type', recordId: 'Record id',
  };
  const words = {
    actor: () => 'Dev Owner',
    authoriser: () => null,
    role: (r: string | null) => (r === 'manager' ? 'Manager' : r),
    action: (a: string) => (a === 'menu.item.sold_out' ? 'Item sold out or back on sale' : a),
    record: () => 'Iced Latte',
    reason: (c: string) => (c === 'comp' ? 'Complimentary' : c),
    yes: 'Yes',
    no: 'No',
  };

  it('gives every changed field its own row instead of one cell holding the list', () => {
    const { headers, rows } = auditCsv(
      labels,
      [row({ action: 'menu.item.sold_out', entity: 'menu_items', before: { sold_out: false, price_iqd: 5000 }, after: { sold_out: true, price_iqd: 6000 } })],
      words,
    );
    expect(headers).toEqual(['Date', 'Time', 'Who', 'Role', 'Authorised by', 'What happened', 'Record', 'Field changed', 'Was', 'Became', 'Reason', 'Station', 'Action code', 'Record type', 'Record id']);
    expect(rows).toHaveLength(2);
    // The entry's columns repeat; Field / Was / Became hold one fact each.
    expect(rows.map((r) => [r[7], r[8], r[9]])).toEqual([
      ['Price (IQD)', '5000', '6000'],
      ['Sold out', 'No', 'Yes'],
    ]);
    expect(rows[0]!.slice(2, 7)).toEqual(['Dev Owner', 'Manager', null, 'Item sold out or back on sale', 'Iced Latte']);
    expect(rows[0]!.slice(10)).toEqual(['Complimentary', 'TILL-01', 'menu.item.sold_out', 'Menu items', 'tab-1']);
  });

  it('writes the date and the time in their own columns, not an ISO instant', () => {
    const at = new Date(2026, 7, 28, 9, 5).toISOString();
    const { rows } = auditCsv(labels, [row({ at })], words);
    expect(rows[0]!.slice(0, 2)).toEqual(['2026-08-28', '09:05']);
  });

  it('keeps an entry that changed nothing, as one row', () => {
    const { rows } = auditCsv(labels, [row({ before: null, after: null })], words);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slice(7, 10)).toEqual([null, null, null]);
  });

  it('puts the fields worth reading before the ids and the timestamps', () => {
    const { rows } = auditCsv(
      labels,
      [row({ before: { updated_at: '2026-01-01T00:00:00Z', tab_id: 'x', name_en: 'Old' }, after: { updated_at: '2026-01-02T00:00:00Z', tab_id: 'y', name_en: 'New' } })],
      words,
    );
    expect(rows.map((r) => r[7])).toEqual(['Name en', 'Updated at', 'Tab id']);
  });

  it('cuts a value that would otherwise spill across the sheet', () => {
    const long = 'x'.repeat(400);
    const { rows } = auditCsv(labels, [row({ before: { note: '' }, after: { note: long } })], words);
    const became = rows[0]![9] as string;
    expect(became.length).toBeLessThanOrEqual(160);
    expect(became.endsWith('…')).toBe(true);
  });
});

describe('plain language', () => {
  it('turns a stored code into a catalog key segment', () => {
    expect(codeToKey('menu.item.sold_out')).toBe('menuItemSoldOut');
    expect(codeToKey('table_token.prev_secret_cleared')).toBe('tableTokenPrevSecretCleared');
    expect(codeToKey('telegram.w.ack')).toBe('telegramWAck');
  });

  it('knows the actions the server writes and says so for a new one', () => {
    expect(knownActionKey('tab.settle')).toBe('tabSettle');
    expect(knownActionKey('brand.new_thing')).toBeNull();
    expect(knownFamilyKey('order_item')).toBe('orderItem');
    expect(knownFamilyKey('zzz')).toBeNull();
  });

  it('has words in both languages for every known action and area', () => {
    // A key in the list with no catalog entry would print the raw key path.
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      for (const a of ACTION_KEYS) {
        const key = `ws.manager.audit.actions.${codeToKey(a)}`;
        expect(t(key as never), `${locale} ${a}`).not.toBe(key);
      }
      for (const f of FAMILY_KEYS) {
        const key = `ws.manager.audit.families.${codeToKey(f)}`;
        expect(t(key as never), `${locale} ${f}`).not.toBe(key);
      }
    }
  });

  it('offers every known area in the filter, plus any new one in the data', () => {
    // The area filter now runs on the server; options built from the loaded
    // page alone collapsed to the chosen area the moment it was chosen.
    const options = familyOptions([row({ action: 'menu.item.update' }), row({ action: 'zzz.new' })]);
    expect(options).toContain('reservation');
    expect(options).toContain('zzz');
  });

  it('only treats an exact known action as a server filter', () => {
    expect(isActionCode('discount.apply')).toBe(true);
    expect(isActionCode(' discount.apply ')).toBe(true);
    expect(isActionCode('discount')).toBe(false);
    expect(isActionCode('refund')).toBe(false);
  });

  it('leaves ids, keys and secrets out of the on-screen change list', () => {
    for (const f of ['id', 'day_session_id', 'idempotency_key', 'table_token', 'secret', 'photo_blur']) {
      expect(isTechnicalField(f), f).toBe(true);
    }
    for (const f of ['sold_out', 'name_en', 'price_iqd', 'status', 'settled_at']) {
      expect(isTechnicalField(f), f).toBe(false);
    }
  });

  it('humanizes a column name', () => {
    expect(humanizeField('sold_out')).toBe('Sold out');
    expect(humanizeField('total_iqd')).toBe('Total (IQD)');
  });

  it('names the record from the row itself, in the reader\'s language', () => {
    expect(recordName(null, { name_en: 'Latte', name_ar: 'لاتيه' }, 'ar')).toBe('لاتيه');
    expect(recordName({ guest_name: 'Omar' }, null, 'en')).toBe('Omar');
    expect(recordName({ id: 'x' }, { id: 'x', status: 'settled' }, 'en')).toBeNull();
  });

  it('searches the words the screen shows as well as the codes', () => {
    expect(matchesAudit(row(), { ...EMPTY_FILTER, query: 'discount given' }, ['Discount given'])).toBe(true);
    expect(matchesAudit(row({ actor_name: 'Sara' }), { ...EMPTY_FILTER, query: 'sara' })).toBe(true);
  });

  it('finds a person as the PIN holder too, as the server filter does', () => {
    const r = row({ actor_id: 'cashier-1', authorizer_id: 'manager-1' });
    expect(matchesAudit(r, { ...EMPTY_FILTER, actorId: 'manager-1' })).toBe(true);
  });
});
