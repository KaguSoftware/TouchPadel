import { describe, expect, it } from 'vitest';
import {
  blockLines,
  boardCounts,
  dayBounds,
  distanceParts,
  personStatus,
  readClockDay,
  refusalWord,
  sortForBoard,
  type DayEvent,
  type DayPerson,
  type DayShift,
} from './dayStatus';

// Times are UTC instants on 2026-11-15; the branch's clock does not matter to the words.
const T = (hhmm: string) => `2026-11-15T${hhmm}:00.000Z`;

function shift(starts: string, ends: string, blockStarts = starts, blockEnds = ends, role: DayShift['role'] = null): DayShift {
  return { starts: T(starts), ends: T(ends), role, blockStarts: T(blockStarts), blockEnds: T(blockEnds) };
}

function ev(kind: 'in' | 'out', at: string, extra: Partial<DayEvent> = {}): DayEvent {
  return {
    id: `${kind}-${at}`,
    kind,
    status: 'accepted',
    refusal: null,
    at: T(at),
    lateMinutes: 0,
    earlyMinutes: 0,
    distanceM: null,
    accuracyM: null,
    mocked: false,
    stationId: 'DESK1',
    ...extra,
  };
}

function person(p: Partial<DayPerson>): DayPerson {
  return { staffId: 's1', displayName: 'Ali', role: 'waiter', shifts: [], events: [], inSince: null, attendance: null, deviceBound: true, ...p };
}

const words = (p: DayPerson, now: string) => personStatus(p, T(now)).words.map((w) => w.word);

describe('readClockDay', () => {
  it('reads the server payload', () => {
    const d = readClockDay({
      date: '2026-11-15',
      today: '2026-11-15',
      now: T('10:00'),
      people: [
        {
          staff_id: 's1',
          display_name: 'Ali',
          role: 'waiter',
          shifts: [{ starts: T('09:00'), ends: T('14:00'), role: null, block_starts: T('09:00'), block_ends: T('18:00') }],
          events: [{ id: 'e1', kind: 'in', status: 'refused', refusal: 'NOT_HERE', at: T('08:55'), late_minutes: 0, early_minutes: 0, distance_m: 4200, accuracy_m: 12, mocked: false, station_id: null }],
          in_since: null,
          attendance: { id: 'a1', late_minutes: 5, early_leave_minutes: 0, penalty_iqd: 0, source: 'clock' },
          device_bound: true,
        },
        { display_name: 'no id' },
      ],
    });
    expect(d.people).toHaveLength(1);
    expect(d.people[0]!.shifts[0]!.blockEnds).toBe(T('18:00'));
    expect(d.people[0]!.events[0]).toMatchObject({ refusal: 'NOT_HERE', distanceM: 4200, status: 'refused' });
    expect(d.people[0]!.attendance?.source).toBe('clock');
    expect(readClockDay(null)).toEqual({ date: null, today: null, now: null, people: [] });
  });
});

describe('personStatus', () => {
  it('Off today: no hours, no scans', () => {
    expect(words(person({}), '10:00')).toEqual(['off']);
  });

  it('Not in yet, then Late not in, then Missed', () => {
    const p = person({ shifts: [shift('09:00', '14:00')] });
    expect(words(p, '08:00')).toEqual(['notInYet']);
    expect(words(p, '09:10')).toEqual(['lateNotIn']);
    expect(words(p, '15:00')).toEqual(['missed']);
  });

  it('At work, in the job of the running shift, with the late minutes', () => {
    const p = person({
      shifts: [shift('09:00', '14:00', '09:00', '18:00'), shift('14:00', '18:00', '09:00', '18:00', 'cashier')],
      events: [ev('in', '09:12', { lateMinutes: 12 })],
      inSince: T('09:12'),
    });
    const st = personStatus(p, T('15:00'));
    expect(st.words[0]).toEqual({ word: 'atWork', since: T('09:12'), role: 'cashier' });
    expect(st.words.map((w) => w.word)).toEqual(['atWork', 'late']);
    expect(st.words[1]).toEqual({ word: 'late', minutes: 12 });
  });

  it('a log-in up to three hours early counts for the shift', () => {
    const p = person({ shifts: [shift('09:00', '14:00')], events: [ev('in', '07:00')], inSince: T('07:00') });
    expect(words(p, '08:00')).toEqual(['atWork']);
  });

  it('two shifts with an hour off: time off is never missed', () => {
    const p = person({
      shifts: [shift('09:00', '13:00'), shift('14:00', '18:00')],
      events: [ev('in', '09:00'), ev('out', '13:00')],
    });
    expect(words(p, '13:30')).toEqual(['notInYet']);
    expect(words(p, '14:20')).toEqual(['lateNotIn']);
    expect(words(p, '19:00')).toEqual(['missed', 'finished']);
  });

  it('Finished, with minutes left early', () => {
    const p = person({ shifts: [shift('09:00', '14:00')], events: [ev('in', '09:00'), ev('out', '13:40', { earlyMinutes: 20 })] });
    const st = personStatus(p, T('15:00'));
    expect(st.words).toEqual([{ word: 'finished', at: T('13:40') }, { word: 'leftEarly', minutes: 20 }]);
  });

  it('No log-out four hours after the block ended, or once the server let it go', () => {
    const p = person({ shifts: [shift('09:00', '14:00')], events: [ev('in', '09:00')], inSince: T('09:00') });
    expect(words(p, '17:00')).toEqual(['atWork']);
    expect(words(p, '18:30')).toEqual(['noLogout']);
    expect(words({ ...p, inSince: null }, '16:00')).toEqual(['noLogout']);
  });

  it('refused attempts are counted and listed, even on a day off', () => {
    const far = ev('in', '08:50', { status: 'refused', refusal: 'NOT_HERE', distanceM: 4200 });
    const off = personStatus(person({ events: [far] }), T('10:00'));
    expect(off.words).toEqual([{ word: 'refused', count: 1 }]);
    expect(off.refused).toHaveLength(1);
    const p = person({ shifts: [shift('09:00', '14:00')], events: [far] });
    expect(words(p, '09:30')).toEqual(['lateNotIn', 'refused']);
  });

  it('puts the most urgent first on the board', () => {
    const rows = [
      person({ staffId: 'a', displayName: 'Zed' }),
      person({ staffId: 'b', displayName: 'Bara', shifts: [shift('09:00', '14:00')] }),
      person({ staffId: 'c', displayName: 'Ali', shifts: [shift('09:00', '14:00')], events: [ev('in', '09:00')], inSince: T('09:00') }),
    ].map((p) => ({ person: p, status: personStatus(p, T('10:00')) }));
    expect(sortForBoard(rows).map((r) => r.person.staffId)).toEqual(['b', 'c', 'a']);
    expect(boardCounts(rows.map((r) => r.status))).toEqual({ atWork: 1, lateNotIn: 1, notInYet: 0, noLogout: 0, missed: 0 });
  });
});

describe('refusals in plain words', () => {
  it('names each reason, a fake location first', () => {
    expect(refusalWord({ refusal: 'NOT_HERE', distanceM: 4200, mocked: false })).toBe('far');
    expect(refusalWord({ refusal: 'NOT_HERE', distanceM: null, mocked: false })).toBe('farUnknown');
    expect(refusalWord({ refusal: 'NOT_HERE', distanceM: 4200, mocked: true })).toBe('fake');
    expect(refusalWord({ refusal: 'MOCK_LOCATION', distanceM: null, mocked: false })).toBe('fake');
    expect(refusalWord({ refusal: 'WRONG_DEVICE', distanceM: null, mocked: false })).toBe('otherPhone');
    expect(refusalWord({ refusal: 'CODE_WRONG', distanceM: null, mocked: false })).toBe('code');
    expect(refusalWord({ refusal: 'NO_STATION', distanceM: null, mocked: false })).toBe('notSetUp');
  });

  it('says a distance in metres or kilometres', () => {
    expect(distanceParts(180.4)).toEqual({ unit: 'm', value: 180 });
    expect(distanceParts(4249)).toEqual({ unit: 'km', value: 4.2 });
    expect(distanceParts(12_960)).toEqual({ unit: 'km', value: 13 });
  });
});

describe('blockLines and dayBounds', () => {
  it('lists blocks with the job switches inside them', () => {
    const p = person({ shifts: [shift('09:00', '14:00', '09:00', '18:00'), shift('14:00', '18:00', '09:00', '18:00', 'cashier'), shift('19:00', '22:00')] });
    const lines = blockLines(p);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.parts.map((x) => x.role)).toEqual(['waiter', 'cashier']);
    expect(lines[1]!.starts).toBe(T('19:00'));
  });

  it('goes back 60 days', () => {
    expect(dayBounds('2026-11-15')).toEqual({ min: '2026-09-16', max: '2026-11-15' });
  });
});
