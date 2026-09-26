import { describe, expect, it } from 'vitest';
import {
  MAX_COUNT_IQD,
  closeRpc,
  closeState,
  gateBlocks,
  handoverIsMine,
  handoverPrefill,
  holdersWithoutPin,
  outcomeOf,
  railShift,
  readShiftList,
  readShiftStatus,
  shiftBeatIdentity,
  shiftGate,
  shiftKey,
  shiftsWithDifference,
  startBlock,
  type CloseInput,
  type GateInput,
  type ListShift,
  type ShiftStatus,
  type StatusShift,
} from './tillShiftLogic';

// ---------------------------------------------------------------------------
// Fixtures: the shapes app.till_shift_status and app.till_shift_list return
// (packages/db/supabase/migrations/…0205_till_shifts.sql).
// ---------------------------------------------------------------------------

const DAY = { id: 'd1', business_date: '2026-09-26', opening_float_iqd: 100_000 };

const mine: StatusShift = {
  id: 's-mine',
  staff_id: 'maha',
  staff_name: 'Maha',
  is_mine: true,
  opened_at: '2026-09-26T06:02:00Z',
  opening_float_iqd: 100_000,
  payment_count: 4,
  refund_count: 0,
  drawer_open_count: 1,
};
const ali: StatusShift = { ...mine, id: 's-ali', staff_id: 'ali', staff_name: 'Ali', is_mine: false };

function status(over: Partial<ShiftStatus> = {}): ShiftStatus {
  return { station_id: 'TILL-01', day: DAY, shift: null, last_closed: null, mine_elsewhere: null, queue_depth: 0, ...over };
}

const CASHIER = { holdsShift: true, payOnOthersShift: false };
const MANAGER = { holdsShift: true, payOnOthersShift: true };
const BARISTA = { holdsShift: false, payOnOthersShift: false };

const gate = (over: Partial<GateInput>): GateInput => ({ ...CASHIER, mode: 'till', status: status(), ...over });

function listShift(over: Partial<ListShift> = {}): ListShift {
  return {
    id: 'x',
    day_session_id: 'd1',
    business_date: '2026-09-26',
    station_id: 'TILL-01',
    staff_id: 'maha',
    staff_name: 'Maha',
    opened_at: '2026-09-26T06:02:00Z',
    closed_at: '2026-09-26T13:02:00Z',
    closed_via: 'own_pin',
    closed_by_name: 'Maha',
    authorized_by_name: 'Maha',
    opening_float_iqd: 100_000,
    handover_difference_iqd: null,
    cash_payments_iqd: 250_000,
    cash_refunds_iqd: 0,
    cash_expected_iqd: 350_000,
    cash_counted_iqd: 345_000,
    cash_variance_iqd: -5_000,
    card_payments_iqd: 80_000,
    card_refunds_iqd: 0,
    payment_count: 12,
    refund_count: 0,
    drawer_open_count: 1,
    open_note: null,
    close_note: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('readShiftStatus', () => {
  it('reads the station, the day, the open shift and the last counted one', () => {
    const s = readShiftStatus({
      station_id: 'TILL-01',
      day: DAY,
      shift: { ...mine },
      last_closed: { id: 's0', staff_name: 'Ali', closed_at: '2026-09-26T06:00:00Z', left_in_drawer_iqd: 1_250_000, outside_cash_since_iqd: 0 },
      mine_elsewhere: null,
      queue_depth: 0,
    });
    expect(s?.shift?.is_mine).toBe(true);
    expect(s?.last_closed?.left_in_drawer_iqd).toBe(1_250_000);
    expect(s?.day?.opening_float_iqd).toBe(100_000);
  });

  it('keeps the running expected cash absent unless the server sent it (the blind count, Q29)', () => {
    const cashier = readShiftStatus({ station_id: 'TILL-01', day: DAY, shift: { ...mine }, queue_depth: 0 });
    expect(cashier?.shift && 'cash_expected_iqd' in cashier.shift).toBe(false);
    const manager = readShiftStatus({ station_id: 'TILL-01', day: DAY, shift: { ...ali, cash_expected_iqd: '350000' }, queue_depth: 0 });
    expect(manager?.shift?.cash_expected_iqd).toBe(350_000);
  });

  it('reads anything that is not the RPC payload as not known, so the gate fails open', () => {
    expect(readShiftStatus(null)).toBeNull();
    expect(readShiftStatus('TILL-01')).toBeNull();
    expect(readShiftStatus({ day: DAY })).toBeNull();
    expect(readShiftStatus({ station_id: 'TILL-01', day: 'x', shift: [], queue_depth: 'n' })).toEqual({
      station_id: 'TILL-01',
      day: null,
      shift: null,
      last_closed: null,
      mine_elsewhere: null,
      queue_depth: 0,
    });
  });
});

describe('readShiftList', () => {
  it('reads shifts, money outside a shift and the cross-day refunds', () => {
    const l = readShiftList({
      from: '2026-09-26',
      to: '2026-09-26',
      shifts: [listShift(), { id: 7 }, null],
      outside: [{ day_session_id: 'd1', business_date: '2026-09-26', station_id: null, cash_payments_iqd: 20_000, payment_count: 1 }],
      cross_day: [{ day_session_id: 'd1', business_date: '2026-09-26', earlier_days_cash_refunds_iqd: 30_000 }],
    });
    expect(l.shifts.map((s) => s.id)).toEqual(['x']);
    expect(l.outside[0]).toMatchObject({ station_id: null, cash_payments_iqd: 20_000, cash_refunds_iqd: 0, payment_count: 1 });
    expect(l.cross_day[0]).toMatchObject({ earlier_days_cash_refunds_iqd: 30_000, later_cash_refunds_iqd: 0 });
  });

  it('keeps an open shift open and an unknown way of closing as none', () => {
    const l = readShiftList({ shifts: [listShift({ closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null }), { ...listShift({ id: 'y' }), closed_via: 'magic' }] });
    expect(l.shifts[0]).toMatchObject({ closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null });
    expect(l.shifts[1]!.closed_via).toBeNull();
  });

  it('reads a malformed payload as an empty list, never a crash', () => {
    expect(readShiftList(undefined)).toEqual({ from: null, to: null, shifts: [], outside: [], cross_day: [] });
    expect(readShiftList({ shifts: 'no' }).shifts).toEqual([]);
  });
});

describe('shiftGate (§8 Q30)', () => {
  it('asks a cashier with no shift here to start one before the tender', () => {
    expect(shiftGate(gate({}))).toEqual({ kind: 'start' });
    expect(gateBlocks(shiftGate(gate({})))).toBe(true);
  });

  it('lets the holder of the open shift take payment', () => {
    expect(shiftGate(gate({ status: status({ shift: mine }) }))).toEqual({ kind: 'ok', banner: null });
  });

  it('holds a cashier at someone else’s open shift: it is closed first', () => {
    const g = shiftGate(gate({ status: status({ shift: ali }) }));
    expect(g).toEqual({ kind: 'othersShift', shiftId: 's-ali', name: 'Ali', openedAt: ali.opened_at });
    expect(gateBlocks(g)).toBe(true);
  });

  it('lets a manager work anyone’s drawer, with a banner saying whose (payOnOthersShift)', () => {
    expect(shiftGate(gate({ ...MANAGER, status: status({ shift: ali }) }))).toEqual({ kind: 'ok', banner: { kind: 'othersDrawer', name: 'Ali' } });
  });

  it('never asks a manager to hold a shift: with none open, the money lands outside one', () => {
    const g = shiftGate(gate({ ...MANAGER }));
    expect(g).toEqual({ kind: 'ok', banner: { kind: 'noShift' } });
    expect(gateBlocks(g)).toBe(false);
  });

  it('gates the desk exactly like the till: the desk counts its own cash box (§2.9.9)', () => {
    expect(shiftGate(gate({ mode: 'desk' }))).toEqual({ kind: 'start' });
    expect(shiftGate(gate({ mode: 'desk', status: status({ shift: mine }) }))).toEqual({ kind: 'ok', banner: null });
  });

  it('FAILS OPEN when the status is not known: loading, a failed read, offline', () => {
    for (const who of [CASHIER, MANAGER]) {
      const g = shiftGate(gate({ ...who, status: null }));
      expect(g).toEqual({ kind: 'ok', banner: null });
      expect(gateBlocks(g)).toBe(false);
    }
  });

  it('FAILS OPEN while sales wait to send from here: no shift could open until they land (V13)', () => {
    expect(shiftGate(gate({ status: status({ queue_depth: 3 }) }))).toEqual({ kind: 'ok', banner: null });
    // Someone else's open shift still has to be closed first.
    expect(shiftGate(gate({ status: status({ queue_depth: 3, shift: ali }) })).kind).toBe('othersShift');
  });

  it('does not gate with no business day: the settle’s own NO_OPEN_DAY says why', () => {
    const g = shiftGate(gate({ status: status({ day: null }) }));
    expect(g).toEqual({ kind: 'noDay' });
    expect(gateBlocks(g)).toBe(false);
  });

  it('says where the person’s shift is when it is open on another till', () => {
    const g = shiftGate(gate({ status: status({ mine_elsewhere: { id: 's9', station_id: 'TILL-02', opened_at: '' } }) }));
    expect(g).toEqual({ kind: 'mineElsewhere', stationId: 'TILL-02' });
    expect(gateBlocks(g)).toBe(true);
  });

  it('never gates a role that holds no shift, or a station with no drawer', () => {
    expect(shiftGate(gate({ ...BARISTA }))).toEqual({ kind: 'ok', banner: null });
    expect(shiftGate(gate({ mode: 'kds' }))).toEqual({ kind: 'ok', banner: null });
  });
});

describe('railShift', () => {
  it('draws nothing it cannot know: no drawer, no shift role, no status yet', () => {
    expect(railShift(gate({ mode: 'kds' }))).toBeNull();
    expect(railShift(gate({ ...BARISTA }))).toBeNull();
    expect(railShift(gate({ status: null }))).toBeNull();
  });

  it('shows my shift with its start time, or someone else’s to close', () => {
    expect(railShift(gate({ status: status({ shift: mine }) }))).toEqual({ kind: 'mine', shiftId: 's-mine', openedAt: mine.opened_at });
    expect(railShift(gate({ status: status({ shift: ali }) }))).toEqual({ kind: 'others', shiftId: 's-ali', name: 'Ali', openedAt: ali.opened_at });
    // A manager may close it too (with a PIN), so the row is there for them.
    expect(railShift(gate({ ...MANAGER, status: status({ shift: ali }) }))?.kind).toBe('others');
  });

  it('offers Start, and says why when it cannot be pressed yet', () => {
    expect(railShift(gate({}))).toEqual({ kind: 'start', blocked: null });
    expect(railShift(gate({ status: status({ day: null }) }))).toEqual({ kind: 'start', blocked: 'noDay' });
    expect(railShift(gate({ status: status({ mine_elsewhere: { id: 's9', station_id: 'DESK-01', opened_at: '' } }) }))).toEqual({
      kind: 'start',
      blocked: { elsewhere: 'DESK-01' },
    });
  });

  it('draws nothing for a manager with no shift here: never asked to hold one', () => {
    expect(railShift(gate({ ...MANAGER }))).toBeNull();
  });
});

describe('handoverIsMine', () => {
  const h = { kind: 'handover' as const, from: 'Maha', closedAt: '2026-09-26T13:02:00Z', leftIqd: 98_000, outsideIqd: 0, prefillIqd: 98_000 };
  it('says "You left" only when the last shift was the viewer’s own', () => {
    expect(handoverIsMine(h, 'Maha')).toBe(true);
    expect(handoverIsMine(h, ' Maha ')).toBe(true);
    expect(handoverIsMine(h, 'Ali')).toBe(false);
    expect(handoverIsMine(h, null)).toBe(false);
    expect(handoverIsMine({ kind: 'dayFloat', prefillIqd: 100_000 }, 'Maha')).toBe(false);
  });
});

describe('handoverPrefill (V18)', () => {
  const last = { id: 's0', staff_name: 'Ali', closed_at: '2026-09-26T13:02:00Z', left_in_drawer_iqd: 1_250_000, outside_cash_since_iqd: 0 };

  it('prefills what the last shift left in the drawer', () => {
    expect(handoverPrefill(status({ last_closed: last }), 'till')).toEqual({
      kind: 'handover',
      from: 'Ali',
      closedAt: last.closed_at,
      leftIqd: 1_250_000,
      outsideIqd: 0,
      prefillIqd: 1_250_000,
    });
  });

  it('adds the cash taken, and takes off the cash paid out, with no shift open since', () => {
    expect(handoverPrefill(status({ last_closed: { ...last, outside_cash_since_iqd: 30_000 } }), 'till')).toMatchObject({ prefillIqd: 1_280_000 });
    expect(handoverPrefill(status({ last_closed: { ...last, outside_cash_since_iqd: -50_000 } }), 'till')).toMatchObject({ prefillIqd: 1_200_000 });
    // Never below nothing: a float is not negative, and the server would refuse it.
    expect(handoverPrefill(status({ last_closed: { ...last, left_in_drawer_iqd: 10_000, outside_cash_since_iqd: -50_000 } }), 'till')).toMatchObject({ prefillIqd: 0 });
  });

  it('prefills the day’s float on the first till shift of the day', () => {
    expect(handoverPrefill(status(), 'till')).toEqual({ kind: 'dayFloat', prefillIqd: 100_000 });
  });

  it('asks the desk to count its own box on its first shift: the day’s float is the till’s', () => {
    expect(handoverPrefill(status(), 'desk')).toEqual({ kind: 'count' });
    // A later desk shift hands over like the till's.
    expect(handoverPrefill(status({ last_closed: last }), 'desk').kind).toBe('handover');
  });

  it('opens nothing with no day, or with no status', () => {
    expect(handoverPrefill(status({ day: null }), 'till')).toEqual({ kind: 'noDay' });
    expect(handoverPrefill(null, 'till')).toEqual({ kind: 'noDay' });
  });
});

describe('startBlock', () => {
  it('says why a start would be refused before the server does', () => {
    expect(startBlock(status())).toBeNull();
    expect(startBlock(status({ day: null }))).toBe('noDay');
    expect(startBlock(status({ mine_elsewhere: { id: 's9', station_id: 'TILL-02', opened_at: '' } }))).toEqual({ elsewhere: 'TILL-02' });
    expect(startBlock(status({ shift: ali }))).toEqual({ busy: 'Ali' });
    expect(startBlock(status({ queue_depth: 2 }))).toBe('unsynced');
  });

  it('knows nothing when the status is not known, and lets the server answer', () => {
    expect(startBlock(null)).toBeNull();
  });
});

describe('closeState (Q29: blind, then signed, then the difference)', () => {
  const base: CloseInput = { isMine: true, hasOwnPin: true, counted: null, countConfirmed: false, chosen: null, result: null };

  it('counts first, and only a typed count moves on; zero is a count', () => {
    expect(closeState(base)).toMatchObject({ step: 'count', canConfirmCount: false });
    expect(closeState({ ...base, counted: 0 })).toMatchObject({ step: 'count', canConfirmCount: true });
    expect(closeState({ ...base, counted: 0, countConfirmed: true })).toMatchObject({ step: 'sign' });
  });

  it('signs my own shift with my PIN, or a manager’s when I choose it', () => {
    const at = { ...base, counted: 345_000, countConfirmed: true };
    expect(closeState(at)).toMatchObject({ step: 'sign', signWith: 'own', ownOffered: true });
    expect(closeState({ ...at, chosen: 'manager' })).toMatchObject({ signWith: 'manager', ownOffered: true });
    // Before has_own_pin answers, the own PIN is still offered.
    expect(closeState({ ...at, hasOwnPin: null })).toMatchObject({ signWith: 'own', ownOffered: true });
  });

  it('sends a person with no PIN, and anyone else’s shift, to a manager’s PIN', () => {
    const at = { ...base, counted: 345_000, countConfirmed: true };
    expect(closeState({ ...at, hasOwnPin: false })).toMatchObject({ signWith: 'manager', ownOffered: false });
    expect(closeState({ ...at, isMine: false, chosen: 'own' })).toMatchObject({ signWith: 'manager', ownOffered: false });
  });

  it('shows the result once the server answered', () => {
    const result = { ok: true as const } as Parameters<typeof closeState>[0]['result'];
    expect(closeState({ ...base, counted: 1, countConfirmed: true, result }).step).toBe('done');
  });

  it('names the RPC each PIN goes through', () => {
    expect(closeRpc('own')).toBe('close_till_shift');
    expect(closeRpc('manager')).toBe('close_till_shift_for');
  });

  it('accepts counts up to the server’s bound', () => {
    expect(MAX_COUNT_IQD).toBe(999_999_999_999);
  });
});

describe('outcomeOf', () => {
  it('reads a stamped variance as a sign word and its size', () => {
    expect(outcomeOf(-5_000)).toEqual({ sign: 'short', magnitude: 5_000 });
    expect(outcomeOf(2_000)).toEqual({ sign: 'over', magnitude: 2_000 });
    expect(outcomeOf(0)).toEqual({ sign: 'exact', magnitude: 0 });
  });

  it('has no outcome for a shift that was never counted', () => {
    expect(outcomeOf(null)).toBeNull();
    expect(outcomeOf(undefined)).toBeNull();
  });
});

describe('shiftKey', () => {
  it('mints `${intent}:${uuid}` keys (§2.9.4)', () => {
    expect(shiftKey('till_shift.open', 'u1')).toBe('till_shift.open:u1');
    expect(shiftKey('till_shift.close', 'u2')).toBe('till_shift.close:u2');
  });
});

describe('shiftBeatIdentity', () => {
  it('beats as the station itself in production, a till only in till mode', () => {
    expect(shiftBeatIdentity('TILL-01', 'till', false)).toEqual({ deviceId: 'TILL-01', isTill: true });
    expect(shiftBeatIdentity('DESK-01', 'desk', false)).toEqual({ deviceId: 'DESK-01', isTill: false });
  });

  it('never beats as a till in development, and not at all as a TILL-named station', () => {
    expect(shiftBeatIdentity('DEV1', 'till', true)).toEqual({ deviceId: 'DEV1', isTill: false });
    expect(shiftBeatIdentity('TILL-01', 'till', true)).toBeNull();
  });
});

describe('holdersWithoutPin (Setup)', () => {
  const holds = (r: string) => ['cashier', 'court_desk', 'manager', 'owner'].includes(r);
  const approves = (r: string) => r === 'manager' || r === 'owner';

  it('counts active shift holders with no PIN of their own, but never the PIN approvers', () => {
    const rows = [
      { is_active: true, has_pin: false, role: 'cashier' },
      { is_active: true, has_pin: false, role: 'court_desk' },
      { is_active: true, has_pin: true, role: 'cashier' },
      { is_active: false, has_pin: false, role: 'cashier' },
      { is_active: true, has_pin: false, role: 'barista' },
      { is_active: true, has_pin: false, role: 'manager' },
    ];
    expect(holdersWithoutPin(rows, holds, approves)).toBe(2);
  });
});

describe('shiftsWithDifference (/ops, Q27)', () => {
  it('counts the closed shifts whose count differs, by any amount', () => {
    const list = readShiftList({
      shifts: [
        listShift({ id: 'a', cash_variance_iqd: -5_000 }),
        listShift({ id: 'b', cash_variance_iqd: 0 }),
        listShift({ id: 'c', cash_variance_iqd: 250 }),
        listShift({ id: 'd', closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null }),
        listShift({ id: 'e', closed_via: 'day_close', cash_counted_iqd: null, cash_variance_iqd: null }),
      ],
    });
    expect(shiftsWithDifference(list)).toBe(2);
  });
});
