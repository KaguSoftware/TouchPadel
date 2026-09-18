import { describe, expect, it } from 'vitest';
import { COURT_SLOTS, HEARTBEAT_STALE_MS, TABLE_SLOTS, composeSnapshot, countsOf, roomForRole, type FloorRaw } from './floorModel';

// Every claim the plan makes is derived here, so every claim is pinned here:
// what makes a court in play or merely booked, a table occupied, a person at a
// station or on a break — and, as important, what the model refuses to invent.

const NOW = Date.parse('2026-09-18T18:00:00Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

function raw(partial: Partial<FloorRaw> = {}): FloorRaw {
  return {
    courts: [
      { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', sort_order: 0 },
      { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب ٢', sort_order: 1 },
    ],
    bookings: [],
    tables: [
      { id: 't1', table_number: '1' },
      { id: 't2', table_number: '2' },
    ],
    tabs: [],
    staff: [
      { id: 's1', display_name: 'Zainab', role: 'court_desk' },
      { id: 's2', display_name: 'Omar', role: 'cashier' },
      { id: 's3', display_name: 'Hassan', role: 'prep' },
    ],
    stationStaff: [],
    heartbeats: [],
    breaks: [],
    ...partial,
  };
}

describe('courts', () => {
  it('is in play when an arrived booking has not ended, with the booking’s own player count', () => {
    const s = composeSnapshot(
      raw({ bookings: [{ id: 'b1', court_id: 'c1', status: 'arrived', start_at: iso(-30), end_at: iso(60), guest_name: 'Ahmed K.', players: 4 }] }),
      NOW,
    );
    expect(s.courts[0]).toMatchObject({ id: 'c1', slot: 0, status: 'in_play', guest: 'Ahmed K.', players: 4, until: iso(60), nextAt: null });
    expect(s.courts[1]).toMatchObject({ id: 'c2', slot: 1, status: 'free' });
  });

  it('is booked, not in play, while a confirmed booking’s window contains now and nobody was marked arrived', () => {
    const s = composeSnapshot(
      raw({ bookings: [{ id: 'b1', court_id: 'c1', status: 'confirmed', start_at: iso(-10), end_at: iso(50), guest_name: 'Sara M.', players: null }] }),
      NOW,
    );
    expect(s.courts[0]).toMatchObject({ status: 'booked', guest: 'Sara M.', players: null, until: iso(50) });
  });

  it('never invents a player count: null when the desk recorded none or zero', () => {
    const s = composeSnapshot(
      raw({ bookings: [{ id: 'b1', court_id: 'c1', status: 'arrived', start_at: iso(-5), end_at: iso(55), guest_name: null, players: 0 }] }),
      NOW,
    );
    expect(s.courts[0]!.players).toBeNull();
  });

  it('a free court names its next confirmed booking within the lookahead, and ignores ended ones', () => {
    const s = composeSnapshot(
      raw({
        bookings: [
          { id: 'old', court_id: 'c1', status: 'arrived', start_at: iso(-120), end_at: iso(-60), guest_name: null, players: null },
          { id: 'later', court_id: 'c1', status: 'confirmed', start_at: iso(90), end_at: iso(150), guest_name: null, players: null },
          { id: 'soon', court_id: 'c1', status: 'confirmed', start_at: iso(40), end_at: iso(100), guest_name: null, players: null },
        ],
      }),
      NOW,
    );
    expect(s.courts[0]).toMatchObject({ status: 'free', nextAt: iso(40), until: null });
  });

  it('courts beyond the plan’s two slots are kept and counted, but have no slot', () => {
    const s = composeSnapshot(
      raw({
        courts: [
          { id: 'c3', name_en: 'Court 3', name_ar: '', sort_order: 2 },
          { id: 'c1', name_en: 'Court 1', name_ar: '', sort_order: 0 },
          { id: 'c2', name_en: 'Court 2', name_ar: '', sort_order: 1 },
        ],
      }),
      NOW,
    );
    expect(s.courts.map((c) => [c.id, c.slot])).toEqual([
      ['c1', 0],
      ['c2', 1],
      ['c3', null],
    ]);
    expect(countsOf(s)).toMatchObject({ courtsTotal: 3, courtsNotDrawn: 1 });
    expect(COURT_SLOTS).toBe(2);
  });
});

describe('tables', () => {
  it('is occupied by the earliest open tab on it, and says whether that tab awaits payment', () => {
    const s = composeSnapshot(
      raw({
        tabs: [
          { id: 'tab2', status: 'awaiting_payment', table_id: 't1', label: 'T-2', opened_at: iso(-20), reservation: null },
          { id: 'tab1', status: 'open', table_id: 't1', label: 'T-1', opened_at: iso(-40), reservation: { guest_name: 'Ali' } },
          { id: 'tab3', status: 'open', table_id: null, label: 'walk-in', opened_at: iso(-5), reservation: null },
        ],
      }),
      NOW,
    );
    expect(s.tables[0]).toMatchObject({ number: '1', status: 'occupied', tab: { id: 'tab1', guest: 'Ali', state: 'open', openedAt: iso(-40) } });
    expect(s.tables[1]).toMatchObject({ number: '2', status: 'free', tab: null });
    expect(countsOf(s)).toMatchObject({ tablesOccupied: 1, tablesTotal: 2 });
  });

  it('orders tables like a numbered list and drops the overflow off the plan', () => {
    const tables = Array.from({ length: 11 }, (_, i) => ({ id: `t${i + 1}`, table_number: String(i + 1) })).reverse();
    const s = composeSnapshot(raw({ tables }), NOW);
    expect(s.tables.map((t) => t.number)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    expect(s.tables.filter((t) => t.slot !== null)).toHaveLength(TABLE_SLOTS);
    expect(countsOf(s).tablesNotDrawn).toBe(2);
  });
});

describe('staff', () => {
  it('is at a station when assigned to one whose device beat inside the stale window', () => {
    const s = composeSnapshot(
      raw({
        stationStaff: [
          { station_id: 'TILL-01', staff_id: 's2' },
          { station_id: 'DESK-01', staff_id: 's1' },
        ],
        heartbeats: [
          { device_id: 'TILL-01', last_seen_at: new Date(NOW - HEARTBEAT_STALE_MS + 1000).toISOString(), staff_id: null },
          { device_id: 'DESK-01', last_seen_at: new Date(NOW - HEARTBEAT_STALE_MS - 1000).toISOString(), staff_id: null },
        ],
      }),
      NOW,
    );
    expect(s.staff).toEqual([expect.objectContaining({ id: 's2', name: 'Omar', room: 'bar', status: 'working', stationId: 'TILL-01', coveringFor: null })]);
  });

  it('is on a break when a break is open, whatever the station is doing', () => {
    const s = composeSnapshot(
      raw({
        stationStaff: [{ station_id: 'TILL-01', staff_id: 's2' }],
        heartbeats: [{ device_id: 'TILL-01', last_seen_at: iso(0), staff_id: null }],
        breaks: [{ staff_id: 's2', station_id: 'TILL-01', started_at: iso(-12), covered_by: null, cover_started_at: null }],
      }),
      NOW,
    );
    expect(s.staff).toEqual([expect.objectContaining({ id: 's2', status: 'break', since: iso(-12), stationId: 'TILL-01' })]);
    expect(countsOf(s)).toMatchObject({ staffWorking: 0, staffOnBreak: 1 });
  });

  it('whoever covers a break is at that station, named as covering, even with no assignment or heartbeat', () => {
    const s = composeSnapshot(
      raw({
        breaks: [{ staff_id: 's2', station_id: 'TILL-01', started_at: iso(-12), covered_by: 's3', cover_started_at: iso(-8) }],
      }),
      NOW,
    );
    const hassan = s.staff.find((p) => p.id === 's3');
    expect(hassan).toMatchObject({ status: 'working', stationId: 'TILL-01', coveringFor: 'Omar', since: iso(-8), room: 'kitchen' });
  });

  it('a signed-in beat places anyone, jokers included, at that device — and in the office for a manager or owner', () => {
    const s = composeSnapshot(
      raw({
        staff: [
          { id: 'm1', display_name: 'Yusuf', role: 'manager' },
          { id: 'o1', display_name: 'Parsa', role: 'owner' },
          { id: 's2', display_name: 'Omar', role: 'cashier' },
        ],
        heartbeats: [
          { device_id: 'DEV-DEV1', last_seen_at: iso(0), staff_id: 'm1' },
          { device_id: 'LAPTOP-02', last_seen_at: new Date(NOW - 30_000).toISOString(), staff_id: 'o1' },
          { device_id: 'TILL-01', last_seen_at: iso(0), staff_id: 's2' },
        ],
      }),
      NOW,
    );
    expect(s.staff.map((p) => [p.id, p.room, p.status, p.stationId])).toEqual([
      ['s2', 'bar', 'working', 'TILL-01'],
      ['o1', 'office', 'working', 'LAPTOP-02'],
      ['m1', 'office', 'working', 'DEV-DEV1'],
    ]);
  });

  it('a beat older than the window, or one that names nobody, places no one', () => {
    const s = composeSnapshot(
      raw({
        staff: [{ id: 'm1', display_name: 'Yusuf', role: 'manager' }],
        heartbeats: [
          { device_id: 'DEV-DEV1', last_seen_at: new Date(NOW - HEARTBEAT_STALE_MS - 1).toISOString(), staff_id: 'm1' },
          { device_id: 'TILL-01', last_seen_at: iso(0), staff_id: null },
        ],
      }),
      NOW,
    );
    expect(s.staff).toEqual([]);
  });

  it('draws nobody who is neither at a live station nor on a break', () => {
    const s = composeSnapshot(raw(), NOW);
    expect(s.staff).toEqual([]);
    expect(countsOf(s)).toMatchObject({ staffWorking: 0, staffOnBreak: 0 });
  });

  it('places roles in the rooms of the plan', () => {
    expect(['court_desk', 'cashier', 'prep', 'manager', 'owner', 'other'].map(roomForRole)).toEqual(['reception', 'bar', 'kitchen', 'office', 'office', 'floor']);
  });
});
