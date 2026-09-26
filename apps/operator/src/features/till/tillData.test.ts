import { describe, expect, it } from 'vitest';
import { bookingTakesNewTab, canReadBookings, mergeDonorLabel, tabIsRemovable, tabRemovalBlocker, type TabListRow } from './tillData';

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

  it('names WHICH thing holds the tab, not just that something does', () => {
    // The board renders one sentence per cause; a tab held by an order used to
    // be described as owing a payment, which is a different thing to go and do.
    expect(tabRemovalBlocker(bare)).toBeNull();
    expect(tabRemovalBlocker({ ...bare, status: 'awaiting_payment' })).toBe('settling');
    expect(tabRemovalBlocker({ ...bare, orders: [{ source: 'till', status: 'sent', order_items: [] }] })).toBe('orders');
    expect(tabRemovalBlocker({ ...bare, payments: [{ amount_iqd: 5000 }] })).toBe('payments');
    expect(tabRemovalBlocker({ ...bare, tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 500 }] })).toBe('adjustments');
    expect(tabRemovalBlocker({ ...bare, reservation: { guest_name: 'Ali', court: null } })).toBe('reservation');
    expect(tabRemovalBlocker({ ...bare, orders: undefined } as unknown as TabListRow)).toBe('unknown');
  });

  it('answers in app.cancel_tab’s own order, so the board and the server agree', () => {
    // A tab with both an order and a payment is refused for the ORDER by the
    // server (its first branch); the board has to name the same one, or the
    // sentence changes when the press lands.
    const both = { ...bare, orders: [{ source: 'till', status: 'sent', order_items: [] }], payments: [{ amount_iqd: 5000 }] };
    expect(tabRemovalBlocker(both)).toBe('orders');
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

describe('canReadBookings — the mirror of the reservations read policies', () => {
  it('lets the cashier see tonight’s bookings (0106 reservations_cashier_read)', () => {
    expect(canReadBookings('cashier')).toBe(true);
  });

  it('keeps the roles that already could', () => {
    expect(canReadBookings('court_desk')).toBe(true);
    expect(canReadBookings('manager')).toBe(true);
    expect(canReadBookings('owner')).toBe(true);
  });

  it('refuses kitchen staff and a missing role', () => {
    expect(canReadBookings('prep')).toBe(false);
    // 0155: the bar and kitchen roles hold exactly what prep held, and driver
    // and marketing hold no reservations read at all.
    for (const role of ['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'marketing']) {
      expect(canReadBookings(role)).toBe(false);
    }
    expect(canReadBookings(null)).toBe(false);
    expect(canReadBookings(undefined)).toBe(false);
  });
});

describe('bookingTakesNewTab — the till picker hides only bookings with a live tab', () => {
  it('offers a booking with no tab', () => {
    expect(bookingTakesNewTab({ tabs: [] })).toBe(true);
  });

  it('offers a booking whose court was paid on a settled tab (drinks after the court)', () => {
    expect(bookingTakesNewTab({ tabs: [{ status: 'settled' }] })).toBe(true);
    expect(bookingTakesNewTab({ tabs: [{ status: 'void' }, { status: 'settled' }] })).toBe(true);
  });

  it('hides a booking that already has an open or settling tab', () => {
    expect(bookingTakesNewTab({ tabs: [{ status: 'open' }] })).toBe(false);
    expect(bookingTakesNewTab({ tabs: [{ status: 'settled' }, { status: 'awaiting_payment' }] })).toBe(false);
  });
});

describe('mergeDonorLabel', () => {
  const WORDS = { table: 'Table', reservation: 'Reservation' };
  const tab = (over: Partial<{ table: { table_number: string } | null; reservation: { guest_name: string | null } | null; label: string | null }> = {}) => ({
    table: null,
    reservation: null,
    label: null,
    ...over,
  });

  it('names a cafe tab by its table, with no court or time bolted on', () => {
    expect(mergeDonorLabel(tab({ table: { table_number: 'T4' } }), WORDS, null, null)).toBe('Table T4');
  });

  it('names a booking tab by its guest, court and time', () => {
    const row = tab({ reservation: { guest_name: 'Sara Ahmed' } });
    expect(mergeDonorLabel(row, WORDS, 'Court 1', '19:00')).toBe('Sara Ahmed · Court 1 · 19:00');
  });

  it('still says something useful when the booking has no guest name', () => {
    // THE BUG: a booking made by a signed-in account has guest_name = null,
    // and this used to render a UUID fragment.
    const row = tab({ reservation: { guest_name: null } });
    expect(mergeDonorLabel(row, WORDS, 'Court 2', '20:30')).toBe('Reservation · Court 2 · 20:30');
  });

  it('falls back to the free label, then to a dash — never to an id', () => {
    expect(mergeDonorLabel(tab({ label: 'Birthday party' }), WORDS, null, null)).toBe('Birthday party');
    expect(mergeDonorLabel(tab(), WORDS, null, null)).toBe('—');
  });

  it('drops an absent court or time rather than leaving a dangling separator', () => {
    const row = tab({ reservation: { guest_name: 'Sara Ahmed' } });
    expect(mergeDonorLabel(row, WORDS, 'Court 1', null)).toBe('Sara Ahmed · Court 1');
    expect(mergeDonorLabel(row, WORDS, null, '19:00')).toBe('Sara Ahmed · 19:00');
    expect(mergeDonorLabel(row, WORDS, '', '')).toBe('Sara Ahmed');
  });
});
