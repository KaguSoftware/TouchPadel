import { describe, expect, it } from 'vitest';
import {
  canTransition,
  openCount,
  ticketTag,
  ticketViewFromRow,
  ticketViews,
  type TicketRow,
} from './ticketView';

const T0 = Date.parse('2026-09-03T10:00:00Z');

function row(over: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 't1',
    status: 'queued',
    target_seconds: 600,
    created_at: new Date(T0 - 60_000).toISOString(),
    completed_at: null,
    last_actor_label: null,
    order: {
      id: 'o1',
      source: 'guest_web',
      status: 'sent',
      tab: {
        id: 'tab1',
        label: null,
        table: { table_number: '9' },
        reservation: null,
      },
      order_items: [
        {
          id: 'i1',
          qty: 2,
          notes: 'no sugar',
          voided: false,
          ready_at: null,
          menu_item: { name_en: 'Espresso', name_ar: 'إسبريسو' },
          variant: { name_en: 'Regular', name_ar: 'عادي' },
          order_item_modifiers: [
            { qty: 2, modifier: { name_en: 'Extra shot', name_ar: 'جرعة إضافية' } },
            { qty: 1, modifier: { name_en: 'Oat milk', name_ar: 'حليب شوفان' } },
          ],
        },
        {
          id: 'i2',
          qty: 1,
          notes: null,
          voided: true,
          ready_at: null,
          menu_item: { name_en: 'Karak', name_ar: 'كرك' },
          variant: null,
          order_item_modifiers: [],
        },
      ],
    },
    ...over,
  };
}

describe('ticketTag', () => {
  it('prefers the table, then the court reservation, then the tab label', () => {
    expect(ticketTag(row())).toEqual({ kind: 'table', number: '9' });
    const court = row({
      order: {
        ...row().order!,
        tab: { id: 'tab1', label: 'x', table: null, reservation: { id: 'r1', guest_name: 'Ahmed' } },
      },
    });
    expect(ticketTag(court)).toEqual({ kind: 'court', guest: 'Ahmed' });
    const named = row({
      order: { ...row().order!, tab: { id: 'tab1', label: 'Walk-in', table: null, reservation: null } },
    });
    expect(ticketTag(named)).toEqual({ kind: 'label', label: 'Walk-in' });
    expect(ticketTag(row({ order: null }))).toEqual({ kind: 'label', label: null });
  });
});

describe('ticketViewFromRow', () => {
  it('localises names and modifiers, drops voided lines, keeps the ready mark', () => {
    const v = ticketViewFromRow(row(), T0, false, 'en');
    expect(v.source).toBe('web');
    expect(v.ageSeconds).toBe(60);
    expect(v.ageState).toBe('fresh');
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({
      id: 'i1',
      qty: 2,
      name: 'Espresso',
      variant: 'Regular',
      modifiers: ['2× Extra shot', 'Oat milk'],
      notes: 'no sugar',
      ready: false,
    });
    expect(v.canMarkItems).toBe(true);

    const ar = ticketViewFromRow(row(), T0, false, 'ar');
    expect(ar.items[0]?.name).toBe('إسبريسو');
    expect(ar.items[0]?.modifiers[1]).toBe('حليب شوفان');
  });

  it('goes late at the ticket target and carries the stale flag through', () => {
    const late = row({ created_at: new Date(T0 - 700_000).toISOString() });
    const v = ticketViews([late], T0, new Set(['t1']), 'en');
    expect(v[0]?.ageState).toBe('late');
    expect(v[0]?.stale).toBe(true);
  });

  it('tags till orders as till', () => {
    const v = ticketViewFromRow(row({ order: { ...row().order!, source: 'till' } }), T0, false, 'en');
    expect(v.source).toBe('till');
  });
});

describe('lifecycle', () => {
  it('mirrors set_ticket_status: queued→preparing|ready, preparing→ready, ready→completed', () => {
    expect(canTransition('queued', 'preparing')).toBe(true);
    expect(canTransition('queued', 'ready')).toBe(true);
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('preparing', 'preparing')).toBe(false);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'completed')).toBe(true);
    expect(canTransition('completed', 'completed')).toBe(false);
  });

  it('counts only tickets the kitchen still owns', () => {
    expect(
      openCount([{ status: 'queued' }, { status: 'ready' }, { status: 'completed' }]),
    ).toBe(2);
  });
});
