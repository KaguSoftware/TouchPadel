import { describe, expect, it } from 'vitest';
import { tabIsRemovable, type TabListRow } from './tillData';

/** A tab as the board sees it: opened, never touched. */
const bare: TabListRow = {
  id: 't1',
  status: 'open',
  label: null,
  opened_at: '2026-09-03T11:00:00Z',
  total_iqd: null,
  table: { table_number: 'T4' },
  reservation: null,
  orders: [],
  tab_adjustments: [],
  payments: [],
};

describe('tabIsRemovable — the mirror of app.cancel_tab', () => {
  it('an untouched open tab can go', () => {
    expect(tabIsRemovable(bare)).toBe(true);
  });

  it('anything that has to be reconciled keeps it', () => {
    expect(tabIsRemovable({ ...bare, status: 'awaiting_payment' })).toBe(false);
    expect(tabIsRemovable({ ...bare, orders: [{ source: 'till', status: 'sent', order_items: [] }] })).toBe(false);
    expect(tabIsRemovable({ ...bare, payments: [{ amount_iqd: 5000 }] })).toBe(false);
    expect(tabIsRemovable({ ...bare, tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 500 }] })).toBe(false);
  });

  it('a voided order still keeps it — the server counts rows, not live lines', () => {
    // The client must not be laxer than app.cancel_tab, which refuses on the
    // existence of any orders row. Reading `voided: true` as "empty" here
    // would offer a confirm the server then refuses.
    const voided: TabListRow['orders'] = [
      { source: 'till', status: 'voided', order_items: [{ line_total_iqd: 4000, voided: true, menu_item: null }] },
    ];
    expect(tabIsRemovable({ ...bare, orders: voided })).toBe(false);
  });

  it('a booking keeps it: the court fee is owed with nothing ordered', () => {
    // The board's own total cannot see court_iqd, so this cannot be decided
    // from the money — only from the anchor.
    expect(tabIsRemovable({ ...bare, reservation: { guest_name: 'Ali', court: null } })).toBe(false);
  });

  it('a row missing an embed keeps it — absent evidence is not evidence of absence', () => {
    // These rows come out of the persisted cache; one written before an embed
    // existed must not read as an empty tab.
    const stale = { ...bare, orders: undefined } as unknown as TabListRow;
    expect(tabIsRemovable(stale)).toBe(false);
  });
});
