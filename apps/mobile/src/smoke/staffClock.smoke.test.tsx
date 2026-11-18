/**
 * Staff clock-in (0442): the clock page as a route case, Today's work card,
 * and the page's flow in EN and AR: the steps before the camera, the scan
 * (only the desk's QR, once), the typed digits, and the server's answers.
 * expo-location and expo-camera are mocked in jest.setup.ts and steered from
 * src/test/clockState.ts; the app schema's rpc is stood in per case.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, within } from '@testing-library/react-native';
import { countPhrase, formatTime, makeT, type Locale } from '@touch/i18n';
import type { MyClock } from '@touch/core/staff/clock';
import { supabase } from '../lib/supabase';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { clockState, resetClockState } from '../test/clockState';
import { staffKeys } from '../features/staff/keys';
import StaffClock from '../../app/(staff)/staff-clock';
import StaffToday from '../../app/staff';

const V = TEST_VENUE_ID;

const OUT: MyClock = {
  now: '2026-11-15T06:55:00Z',
  today: '2026-11-15',
  ready: true,
  state: 'out',
  since: null,
  device_bound: true,
  shifts: [
    { starts: '2026-11-15T07:00:00Z', ends: '2026-11-15T12:00:00Z', role: null },
    { starts: '2026-11-15T12:00:00Z', ends: '2026-11-15T15:00:00Z', role: 'cashier' },
  ],
  current: null,
  next: { starts: '2026-11-15T07:00:00Z', ends: '2026-11-15T12:00:00Z', role: null },
  recent: [],
};

const IN: MyClock = {
  ...OUT,
  state: 'in',
  since: '2026-11-15T07:04:00Z',
  current: { starts: '2026-11-15T07:00:00Z', ends: '2026-11-15T12:00:00Z', role: null },
  next: { starts: '2026-11-15T12:00:00Z', ends: '2026-11-15T15:00:00Z', role: 'cashier' },
};

type Rpc = jest.Mock<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>;

/** The app schema's rpc: my_clock answers `clock`, clock_punch answers `punch`. */
function standIn(clock: MyClock, punch: unknown): Rpc {
  const rpc: Rpc = jest.fn((fn: string) =>
    Promise.resolve({ data: fn === 'my_clock' ? clock : fn === 'clock_punch' ? punch : null, error: null }),
  );
  Object.assign(supabase, { schema: () => ({ rpc }) });
  return rpc;
}

const punches = (rpc: Rpc) => rpc.mock.calls.filter(([fn]) => fn === 'clock_punch');

beforeEach(() => resetClockState());
afterEach(() => {
  delete (supabase as { schema?: unknown }).schema;
});

runSmokeCases('staff clock', [
  {
    // The page reads the permissions first; its first frame is "Checking…".
    route: 'staff-clock',
    Component: StaffClock,
    nearbyKey: 'staff.clock.checking',
    options: { staff: { role: 'waiter' }, params: { kind: 'in' } },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('staff clock in %s', (locale) => {
  const t = makeT(locale);
  const role = (r: string) => t(`op.roles.${r}` as never);

  it('shows the work card under the greeting, not started, and Start work opens the page', async () => {
    standIn(OUT, null);
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'waiter' }, queryData: [[staffKeys.myClock(V), OUT]] });
    try {
      expect(within(screen.getByTestId('staff.clock.state')).getByText(t('staff.clock.card.notStarted'))).toBeTruthy();
      const action = screen.getByTestId('staff.clock.action');
      expect(within(action).getByText(t('staff.clock.card.start'))).toBeTruthy();
      fireEvent.press(action);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: { pathname: '/staff-clock', params: { kind: 'in' } } });
    } finally {
      screen.unmount();
    }
  });

  it('at work: since when, the running job until its end, then the next job, and Finish work', async () => {
    standIn(IN, null);
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'waiter' }, queryData: [[staffKeys.myClock(V), IN]] });
    try {
      expect(
        screen.getByText(t('staff.clock.card.atWorkSince', { time: formatTime(new Date(IN.since!), locale) })),
      ).toBeTruthy();
      expect(
        screen.getByText(
          t('staff.clock.card.onAsThen', {
            role: role('waiter'),
            time: formatTime(new Date('2026-11-15T12:00:00Z'), locale),
            next: role('cashier'),
          }),
        ),
      ).toBeTruthy();
      expect(within(screen.getByTestId('staff.clock.action')).getByText(t('staff.clock.card.finish'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a branch not set up says so, with no button; the owner has no card', () => {
    standIn({ ...OUT, ready: false }, null);
    const screen = renderRoute(StaffToday, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.myClock(V), { ...OUT, ready: false }]],
    });
    try {
      expect(within(screen.getByTestId('staff.clock.not-ready')).getByText(t('staff.clock.card.notReady'))).toBeTruthy();
      expect(screen.queryByTestId('staff.clock.action')).toBeNull();
    } finally {
      screen.unmount();
    }
    const owner = renderRoute(StaffToday, { locale, staff: { role: 'owner' } });
    try {
      expect(owner.queryByTestId('staff.clock')).toBeNull();
      expect(owner.queryByTestId('staff.clock.loading')).toBeNull();
    } finally {
      owner.unmount();
    }
  });

  it('scans only the desk QR, once, with a fresh precise fix, and says when it started and how late', async () => {
    const rpc = standIn(OUT, {
      status: 'accepted',
      kind: 'in',
      at: '2026-11-15T07:12:00Z',
      work_date: '2026-11-15',
      late_minutes: 12,
      early_minutes: 0,
    });
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      const camera = await screen.findByTestId('mock-camera');
      expect(screen.getByText(t('staff.clock.scan.hint'))).toBeTruthy();
      expect(clockState.watching).toBe(1);
      const scan = camera.props.onBarcodeScanned as (r: { data: string }) => void;
      // Anything that is not the desk's QR is ignored.
      await act(async () => scan({ data: 'https://example.com' }));
      await act(async () => scan({ data: 'TPV-ABCD-1234' }));
      expect(punches(rpc)).toHaveLength(0);
      await act(async () => {
        scan({ data: 'TPCLOCK:123456' });
        scan({ data: 'TPCLOCK:123456' });
      });
      const done = await screen.findByTestId('staff-clock.accepted');
      expect(
        within(done).getByText(t('staff.clock.result.started', { time: formatTime(new Date('2026-11-15T07:12:00Z'), locale) })),
      ).toBeTruthy();
      expect(within(done).getByText(countPhrase('staff.clock.result.late', 12, locale))).toBeTruthy();
      expect(punches(rpc)).toHaveLength(1);
      const args = punches(rpc)[0]![1];
      expect(args).toMatchObject({
        p_venue_id: V,
        p_kind: 'in',
        p_code: '123456',
        p_accuracy_m: 12,
        p_mocked: false,
        p_platform: 'ios',
        p_device_id: '00000000-JEST-IDFV-0000-000000000000',
      });
      expect(Date.now() - Date.parse(args.p_fix_at as string)).toBeLessThan(30_000);
      fireEvent.press(within(done).getByTestId('staff-clock.done'));
    } finally {
      screen.unmount();
    }
    expect(clockState.watching).toBe(0);
  });

  it('not at the club: says so with the distance, and offers back first', async () => {
    standIn(OUT, { status: 'refused', reason: 'NOT_HERE', distance_m: 3240, radius_m: 120 });
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      const camera = await screen.findByTestId('mock-camera');
      await act(async () => (camera.props.onBarcodeScanned as (r: { data: string }) => void)({ data: 'TPCLOCK:654321' }));
      const refused = await screen.findByTestId('staff-clock.refused.not-here');
      expect(within(refused).getByText(t('staff.clock.refused.NOT_HERE.title'))).toBeTruthy();
      expect(
        within(refused).getByText(
          t('staff.clock.refused.NOT_HERE.body', { distance: t('staff.clock.units.km', { n: '3.2' }) }),
        ),
      ).toBeTruthy();
      expect(within(refused).getByText(t('staff.clock.actions.back'))).toBeTruthy();
      expect(within(refused).getByText(t('staff.clock.actions.tryAgain'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a wrong code offers Scan again, which opens the camera for a new code', async () => {
    const rpc = standIn(OUT, { status: 'refused', reason: 'CODE_WRONG' });
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'out' } });
    try {
      let camera = await screen.findByTestId('mock-camera');
      await act(async () => (camera.props.onBarcodeScanned as (r: { data: string }) => void)({ data: 'TPCLOCK:111111' }));
      fireEvent.press(await screen.findByTestId('staff-clock.scan-again'));
      camera = await screen.findByTestId('mock-camera');
      await act(async () => (camera.props.onBarcodeScanned as (r: { data: string }) => void)({ data: 'TPCLOCK:222222' }));
      await screen.findByTestId('staff-clock.refused.code-wrong');
      expect(punches(rpc).map(([, a]) => a.p_code)).toEqual(['111111', '222222']);
      expect(punches(rpc).every(([, a]) => a.p_kind === 'out')).toBe(true);
    } finally {
      screen.unmount();
    }
  });

  it('explains location before the system prompt, then asks once', async () => {
    clockState.location = { status: 'undetermined', canAskAgain: true, precise: true };
    standIn(OUT, null);
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      const step = await screen.findByTestId('staff-clock.step.location');
      expect(within(step).getByText(t('staff.clock.steps.location.body'))).toBeTruthy();
      expect(clockState.locationAsks).toBe(0);
      fireEvent.press(within(step).getByTestId('staff-clock.allow-location'));
      await screen.findByTestId('mock-camera');
      expect(clockState.locationAsks).toBe(1);
    } finally {
      screen.unmount();
    }
  });

  it('location refused for good: no prompt, a way to Settings', async () => {
    clockState.location = { status: 'denied', canAskAgain: false, precise: true };
    standIn(OUT, null);
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      const step = await screen.findByTestId('staff-clock.step.location-blocked');
      expect(within(step).getByText(t('staff.clock.steps.locationBlocked.title'))).toBeTruthy();
      expect(within(step).getByText(t('staff.clock.steps.openSettings'))).toBeTruthy();
      expect(clockState.locationAsks).toBe(0);
      expect(screen.queryByTestId('mock-camera')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it("approximate location and the phone's location switch are steps of their own", async () => {
    clockState.location = { status: 'granted', canAskAgain: true, precise: false };
    standIn(OUT, null);
    let screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      await screen.findByTestId('staff-clock.step.location-approx');
    } finally {
      screen.unmount();
    }
    resetClockState();
    clockState.servicesOn = false;
    screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      const step = await screen.findByTestId('staff-clock.step.location-off');
      expect(within(step).getByText(t('staff.clock.steps.servicesOff.title'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('camera off for good: the 6 digits can be typed instead, Arabic digits too', async () => {
    clockState.camera = { status: 'denied', canAskAgain: false };
    const rpc = standIn(OUT, {
      status: 'accepted',
      kind: 'out',
      at: '2026-11-15T14:30:00Z',
      work_date: '2026-11-15',
      late_minutes: 0,
      early_minutes: 30,
    });
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'out' } });
    try {
      const step = await screen.findByTestId('staff-clock.step.camera-blocked');
      fireEvent.press(within(step).getByTestId('staff-clock.type-instead'));
      const input = await screen.findByTestId('staff-clock.code.input');
      fireEvent.changeText(input, '١٢٣ ٤٥٦');
      await act(async () => fireEvent.press(screen.getByTestId('staff-clock.send')));
      const done = await screen.findByTestId('staff-clock.accepted');
      expect(within(done).getByText(countPhrase('staff.clock.result.early', 30, locale))).toBeTruthy();
      expect(punches(rpc)[0]![1]).toMatchObject({ p_code: '123456', p_kind: 'out' });
    } finally {
      screen.unmount();
    }
  });

  it('a raised error reads through the error mapping, never as a raw code', async () => {
    const rpc: Rpc = jest.fn((fn: string) =>
      Promise.resolve(
        fn === 'clock_punch'
          ? { data: null, error: { message: 'FORBIDDEN', code: 'P0001' } }
          : { data: OUT, error: null },
      ),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(StaffClock, { locale, staff: { role: 'waiter' }, params: { kind: 'in' } });
    try {
      const camera = await screen.findByTestId('mock-camera');
      await act(async () => (camera.props.onBarcodeScanned as (r: { data: string }) => void)({ data: 'TPCLOCK:123456' }));
      const error = await screen.findByTestId('staff-clock.error');
      expect(within(error).getByText(t('staff.clock.error.title'))).toBeTruthy();
      expect(within(error).queryByText('FORBIDDEN')).toBeNull();
      expect(within(error).getByText(t('errors.forbidden'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});
