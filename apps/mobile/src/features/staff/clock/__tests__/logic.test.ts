import { describe, expect, it } from 'vitest';
import { CLOCK_REFUSALS, type MyClock } from '@touch/core/staff/clock';
import { makeT } from '@touch/i18n';
import {
  FIX_FRESH_MS,
  FIX_SETTLE_MS,
  FIX_TIMEOUT_MS,
  acceptedView,
  actionKey,
  chooseFix,
  clockStep,
  clocksIn,
  distanceText,
  keepBest,
  kindParam,
  pickDeviceId,
  punchArgs,
  readMyClock,
  readPunchResult,
  refusalView,
  runningKey,
  titleKey,
  workCard,
  type ClockPermissions,
  type Fix,
} from '../logic';

const NOW = Date.parse('2026-11-15T10:00:00Z');

const base: MyClock = {
  now: '2026-11-15T10:00:00Z',
  today: '2026-11-15',
  ready: true,
  state: 'out',
  since: null,
  device_bound: false,
  shifts: [],
  current: null,
  next: null,
  recent: [],
};

const shift = (starts: string, ends: string, role: string | null = null) => ({ starts, ends, role });

describe('who logs hours and the page param', () => {
  it('is everyone but the owner', () => {
    expect(clocksIn('waiter')).toBe(true);
    expect(clocksIn('manager')).toBe(true);
    expect(clocksIn('owner')).toBe(false);
  });

  it('takes in or out, nothing else', () => {
    expect(kindParam('in')).toBe('in');
    expect(kindParam(['out'])).toBe('out');
    expect(kindParam('IN')).toBeNull();
    expect(kindParam(undefined)).toBeNull();
  });
});

describe('reading my_clock', () => {
  it('reads a full payload and drops broken rows', () => {
    const clock = readMyClock({
      ...base,
      state: 'in',
      since: '2026-11-15T07:04:00Z',
      device_bound: true,
      shifts: [shift('2026-11-15T07:00:00Z', '2026-11-15T12:00:00Z', 'waiter'), { starts: 'x' }, null],
      current: shift('2026-11-15T07:00:00Z', '2026-11-15T12:00:00Z'),
      recent: [
        { kind: 'in', status: 'refused', refusal: 'NOT_HERE', at: '2026-11-15T06:50:00Z', late_minutes: 0, early_minutes: 0 },
        { kind: 'in', status: 'weird', at: 'x' },
      ],
    });
    expect(clock?.state).toBe('in');
    expect(clock?.shifts).toHaveLength(1);
    expect(clock?.current?.role).toBeNull();
    expect(clock?.recent).toEqual([
      { kind: 'in', status: 'refused', refusal: 'NOT_HERE', at: '2026-11-15T06:50:00Z', late_minutes: 0, early_minutes: 0 },
    ]);
  });

  it('is null without ready or state', () => {
    expect(readMyClock(null)).toBeNull();
    expect(readMyClock({ state: 'in' })).toBeNull();
    expect(readMyClock({ ready: true, state: 'maybe' })).toBeNull();
  });
});

describe('reading clock_punch', () => {
  it('reads an accepted punch, minutes never negative', () => {
    expect(
      readPunchResult({ status: 'accepted', kind: 'in', at: '2026-11-15T07:12:00Z', work_date: '2026-11-15', late_minutes: 12, early_minutes: -3 }),
    ).toEqual({ status: 'accepted', kind: 'in', at: '2026-11-15T07:12:00Z', work_date: '2026-11-15', late_minutes: 12, early_minutes: 0 });
  });

  it('reads every refusal with its extra fields', () => {
    for (const reason of CLOCK_REFUSALS) {
      expect(readPunchResult({ status: 'refused', reason })).toEqual({ status: 'refused', reason });
    }
    expect(readPunchResult({ status: 'refused', reason: 'NOT_HERE', distance_m: 3200, radius_m: 120 })).toEqual({
      status: 'refused',
      reason: 'NOT_HERE',
      distance_m: 3200,
      radius_m: 120,
    });
  });

  it('is null for anything else', () => {
    expect(readPunchResult({ status: 'refused', reason: 'NOPE' })).toBeNull();
    expect(readPunchResult({ status: 'accepted', kind: 'in' })).toBeNull();
    expect(readPunchResult('accepted')).toBeNull();
  });
});

describe("Today's work card", () => {
  it('says not set up, with no button, when the branch is not ready', () => {
    expect(workCard({ ...base, ready: false }, 'waiter')).toEqual({ ready: false });
  });

  it('offers Start when out and Finish when in', () => {
    const out = workCard(base, 'waiter');
    expect(out).toMatchObject({ ready: true, state: 'out', action: 'in', since: null, line: { kind: 'noHours' } });
    const inn = workCard({ ...base, state: 'in', since: '2026-11-15T07:04:00Z' }, 'waiter');
    expect(inn).toMatchObject({ state: 'in', action: 'out', since: '2026-11-15T07:04:00Z', line: { kind: 'noShiftNow' } });
    expect(actionKey('in')).toBe('staff.clock.card.start');
    expect(actionKey('out')).toBe('staff.clock.card.finish');
    expect(titleKey('in')).toBe('staff.clock.title.in');
    expect(titleKey('out')).toBe('staff.clock.title.out');
  });

  it('says "On as Waiter until 12:00, then Cashier" when the next shift touches this one in another job', () => {
    const card = workCard(
      {
        ...base,
        state: 'in',
        since: '2026-11-15T07:00:00Z',
        current: shift('2026-11-15T07:00:00Z', '2026-11-15T12:00:00Z'),
        next: shift('2026-11-15T12:00:00.000Z', '2026-11-15T15:00:00Z', 'cashier'),
      },
      'waiter',
    );
    expect(card).toMatchObject({
      line: { kind: 'running', atWork: true, role: 'waiter', until: '2026-11-15T12:00:00Z', next: 'cashier' },
    });
    if (card.ready && card.line.kind === 'running') expect(runningKey(card.line)).toBe('staff.clock.card.onAsThen');
  });

  it('reads touching shifts in the same job as one, and a gap as no next', () => {
    const same = workCard(
      {
        ...base,
        current: shift('2026-11-15T07:00:00Z', '2026-11-15T12:00:00Z', 'waiter'),
        next: shift('2026-11-15T12:00:00Z', '2026-11-15T15:00:00Z'),
      },
      'waiter',
    );
    expect(same).toMatchObject({ line: { kind: 'running', atWork: false, until: '2026-11-15T15:00:00Z', next: null } });
    if (same.ready && same.line.kind === 'running') expect(runningKey(same.line)).toBe('staff.clock.card.shiftNow');
    const gap = workCard(
      {
        ...base,
        current: shift('2026-11-15T07:00:00Z', '2026-11-15T12:00:00Z'),
        next: shift('2026-11-15T13:00:00Z', '2026-11-15T15:00:00Z', 'cashier'),
      },
      'waiter',
    );
    expect(gap).toMatchObject({ line: { kind: 'running', until: '2026-11-15T12:00:00Z', next: null } });
  });

  it("lists today's shifts, the main job filling a null role, when out and nothing is running", () => {
    const card = workCard(
      {
        ...base,
        shifts: [shift('2026-11-15T13:00:00Z', '2026-11-15T16:00:00Z'), shift('2026-11-15T16:00:00Z', '2026-11-15T19:00:00Z', 'cashier')],
      },
      'waiter',
    );
    expect(card).toMatchObject({
      line: {
        kind: 'today',
        shifts: [
          { role: 'waiter', starts: '2026-11-15T13:00:00Z' },
          { role: 'cashier', starts: '2026-11-15T16:00:00Z' },
        ],
      },
    });
  });
});

const granted = { status: 'granted' as const, canAskAgain: true };
const perms = (over: Partial<ClockPermissions> = {}): ClockPermissions => ({
  location: { ...granted, precise: true },
  servicesOn: true,
  camera: granted,
  ...over,
});

describe('the steps before the camera', () => {
  it('asks for location first, only while the prompt can still show', () => {
    expect(clockStep(perms({ location: { status: 'undetermined', canAskAgain: true, precise: true } }))).toBe('location-ask');
    // Android after a plain Deny can still ask.
    expect(clockStep(perms({ location: { status: 'denied', canAskAgain: true, precise: true } }))).toBe('location-ask');
    expect(clockStep(perms({ location: { status: 'denied', canAskAgain: false, precise: true } }))).toBe('location-blocked');
  });

  it('then the phone switch, then precise location, then the camera', () => {
    expect(clockStep(perms({ servicesOn: false }))).toBe('location-off');
    expect(clockStep(perms({ location: { ...granted, precise: false } }))).toBe('location-approx');
    expect(clockStep(perms({ camera: { status: 'undetermined', canAskAgain: true } }))).toBe('camera-ask');
    expect(clockStep(perms({ camera: { status: 'denied', canAskAgain: false } }))).toBe('camera-blocked');
    expect(clockStep(perms())).toBe('ready');
  });

  it('typing the digits needs no camera, but still needs location', () => {
    const noCamera = perms({ camera: { status: 'denied', canAskAgain: false } });
    expect(clockStep(noCamera, true)).toBe('ready');
    expect(clockStep({ ...noCamera, servicesOn: false }, true)).toBe('location-off');
  });
});

const fix = (over: Partial<Fix> = {}): Fix => ({ lat: 33.3, lng: 44.4, accuracy: 20, at: NOW, mocked: false, ...over });

describe('the fix sent', () => {
  it('goes at once when fresh and precise', () => {
    expect(chooseFix(fix({ at: NOW - 5_000 }), NOW, 0)).toEqual({ use: fix({ at: NOW - 5_000 }) });
  });

  it('waits for a better one, then sends the best fresh one', () => {
    const rough = fix({ accuracy: 140 });
    expect(chooseFix(rough, NOW, 1_000)).toBe('wait');
    expect(chooseFix(rough, NOW, FIX_SETTLE_MS)).toEqual({ use: rough });
  });

  it('never sends a stale fix, and gives up after the timeout', () => {
    const old = fix({ at: NOW - FIX_FRESH_MS - 1 });
    expect(chooseFix(old, NOW, FIX_SETTLE_MS)).toBe('wait');
    expect(chooseFix(old, NOW, FIX_TIMEOUT_MS)).toBe('fail');
    expect(chooseFix(null, NOW, FIX_TIMEOUT_MS)).toBe('fail');
    expect(chooseFix(null, NOW, 100)).toBe('wait');
  });

  it('keeps a precise fix over a rough newer one, and replaces a stale one', () => {
    const gps = fix({ accuracy: 12, at: NOW - 2_000 });
    const network = fix({ accuracy: 300, at: NOW });
    expect(keepBest(gps, network, NOW)).toBe(gps);
    expect(keepBest(gps, fix({ accuracy: 15 }), NOW).accuracy).toBe(15);
    const stale = fix({ accuracy: 5, at: NOW - FIX_FRESH_MS - 1 });
    expect(keepBest(stale, network, NOW)).toBe(network);
    expect(keepBest(null, network, NOW)).toBe(network);
  });
});

describe('the punch', () => {
  it('sends every argument, the fix time as ISO and mocked as given', () => {
    expect(
      punchArgs({ venueId: 'v1', kind: 'in', code: '123456', fix: fix({ mocked: true }), deviceId: 'device-id-1', platform: 'android' }),
    ).toEqual({
      p_venue_id: 'v1',
      p_kind: 'in',
      p_code: '123456',
      p_lat: 33.3,
      p_lng: 44.4,
      p_accuracy_m: 20,
      p_fix_at: '2026-11-15T10:00:00.000Z',
      p_mocked: true,
      p_device_id: 'device-id-1',
      p_platform: 'android',
    });
  });

  it('sends a missing accuracy as too rough, never as precise', () => {
    const args = punchArgs({ venueId: 'v', kind: 'out', code: '000000', fix: fix({ accuracy: null }), deviceId: 'abcdefgh', platform: 'ios' });
    expect(args.p_accuracy_m).toBeGreaterThan(1000);
  });

  it("takes the platform's id, else the kept one, else none", () => {
    // The kept id wins, so the phone keeps sending the id it first sent.
    expect(pickDeviceId('ABCDEF12-3456', 'tp-kept-0001')).toBe('tp-kept-0001');
    expect(pickDeviceId(null, 'tp-kept-0001')).toBe('tp-kept-0001');
    expect(pickDeviceId('ABCDEF12-3456', null)).toBe('ABCDEF12-3456');
    expect(pickDeviceId('ABCDEF12-3456', 'short')).toBe('ABCDEF12-3456');
    expect(pickDeviceId('short', null)).toBeNull();
  });
});

describe('the answer', () => {
  it('words a distance in metres to the nearest 10, then km', () => {
    expect(distanceText(143, 'en')).toEqual({ key: 'staff.clock.units.m', params: { n: '140' } });
    expect(distanceText(3, 'en')).toEqual({ key: 'staff.clock.units.m', params: { n: '10' } });
    expect(distanceText(3240, 'en')).toEqual({ key: 'staff.clock.units.km', params: { n: '3.2' } });
    expect(distanceText(41_600, 'ar')).toEqual({ key: 'staff.clock.units.km', params: { n: '42' } });
  });

  it('gives every refusal its own words, in both languages, and a next step', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      for (const reason of CLOCK_REFUSALS) {
        const view = refusalView(reason);
        expect(t(view.titleKey)).not.toBe(view.titleKey);
        expect(t(view.bodyKey)).not.toBe(view.bodyKey);
        expect(view.actions.length).toBeGreaterThan(0);
      }
    }
  });

  it('offers the right retry: scan again for a code, try again for a fix, back for a manager', () => {
    expect(refusalView('CODE_WRONG').actions[0]).toBe('scanAgain');
    expect(refusalView('LOCATION_ROUGH')).toMatchObject({ needs: 'accuracy', actions: ['tryAgain', 'back'] });
    expect(refusalView('LOCATION_STALE').actions[0]).toBe('tryAgain');
    expect(refusalView('NOT_HERE')).toMatchObject({ needs: 'distance', actions: ['back', 'tryAgain'] });
    for (const r of ['WRONG_DEVICE', 'NO_PLACE', 'NO_STATION', 'TOO_MANY_TRIES', 'ALREADY_IN', 'NOT_IN'] as const) {
      expect(refusalView(r).actions).toEqual(['back']);
    }
  });

  it('names the distance and the accuracy in the body', () => {
    const t = makeT('en');
    const d = distanceText(3240, 'en');
    expect(t(refusalView('NOT_HERE').bodyKey, { distance: t(d.key, d.params) })).toContain('about 3.2 km away');
  });

  it('says late minutes on a start and early minutes on a finish, nothing when on time', () => {
    const at = '2026-11-15T07:12:00Z';
    expect(acceptedView({ status: 'accepted', kind: 'in', at, work_date: '', late_minutes: 12, early_minutes: 0 })).toEqual({
      titleKey: 'staff.clock.result.started',
      minutes: { key: 'staff.clock.result.late', n: 12 },
    });
    expect(acceptedView({ status: 'accepted', kind: 'in', at, work_date: '', late_minutes: 0, early_minutes: 0 }).minutes).toBeNull();
    expect(acceptedView({ status: 'accepted', kind: 'out', at, work_date: '', late_minutes: 0, early_minutes: 30 })).toEqual({
      titleKey: 'staff.clock.result.finished',
      minutes: { key: 'staff.clock.result.early', n: 30 },
    });
  });
});
