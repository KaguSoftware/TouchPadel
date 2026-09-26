/**
 * The waiter's guest calls (wave5-addendum-2026-09-25 §2.1.8, §8 Q3): the
 * calls page as a waiter, in EN and AR, and the states after the table case:
 * a call nobody has answered offers both answers, one the waiter is on offers
 * only Done and says so, an empty venue teaches what will arrive, and Today
 * puts the open count on the waiter's calls row (Today's own route case is in
 * staff.smoke.test.tsx; this suite names no other route).
 *
 * Every read is seeded under its `staffKeys` key, so nothing reaches the
 * (mocked) client on the first render; the live `floor` channel is the global
 * mock's, which never reports a state.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { formatNumber, isolate, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { TEST_SESSION } from '../test/authState';
import { staffKeys } from '../features/staff/keys';
import type { WaiterCall } from '../features/staff/calls/logic';
import StaffCalls from '../../app/staff-calls';
import StaffToday from '../../app/staff';

const V = TEST_VENUE_ID;
const RAISED = 'ca110000-0000-4000-8000-000000000001';
const MINE = 'ca110000-0000-4000-8000-000000000002';

/** Minutes before now, as the server's timestamp. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const CALLS: WaiterCall[] = [
  {
    id: RAISED,
    reason: 'bill',
    status: 'raised',
    raised_at: ago(6),
    acknowledged_by: null,
    table: { table_number: '4' },
  },
  {
    id: MINE,
    reason: 'water',
    status: 'acknowledged',
    raised_at: ago(12),
    acknowledged_by: TEST_SESSION.user.id,
    table: { table_number: '12' },
  },
];

runSmokeCases('the waiter’s guest calls', [
  {
    route: 'staff-calls',
    Component: StaffCalls,
    labelKey: 'staff.calls.listTitle',
    options: { staff: { role: 'waiter' }, queryData: [[staffKeys.calls(V), CALLS]] },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('guest calls in %s', (locale) => {
  const t = makeT(locale);

  it('offers both answers on a waiting call, and only Done on the one the waiter is on', () => {
    const screen = renderRoute(StaffCalls, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.calls(V), CALLS]],
    });
    try {
      const raised = within(screen.getByTestId(`staff-calls.item.${RAISED}`));
      expect(raised.getByText(t('op.floor.table', { table: isolate('4') }))).toBeTruthy();
      expect(raised.getByText(t('op.floor.reasons.bill'))).toBeTruthy();
      expect(
        within(screen.getByTestId(`staff-calls.ack.${RAISED}`)).getByText(t('op.floor.ack')),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(`staff-calls.done.${RAISED}`)).getByText(t('op.floor.resolve')),
      ).toBeTruthy();

      const mine = within(screen.getByTestId(`staff-calls.item.${MINE}`));
      expect(
        mine.getByText(`${t('op.floor.reasons.water')} · ${t('staff.calls.mine')}`),
      ).toBeTruthy();
      expect(screen.queryByTestId(`staff-calls.ack.${MINE}`)).toBeNull();
      expect(screen.getByTestId(`staff-calls.done.${MINE}`)).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lists the newest call first', () => {
    const screen = renderRoute(StaffCalls, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.calls(V), [...CALLS].reverse()]],
    });
    try {
      const ids = screen
        .getAllByTestId(/^staff-calls\.item\./)
        .map((n) => String(n.props.testID).replace('staff-calls.item.', ''));
      expect(ids).toEqual([RAISED, MINE]);
    } finally {
      screen.unmount();
    }
  });

  it('says what will arrive when nobody is waiting', () => {
    const screen = renderRoute(StaffCalls, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.calls(V), []]],
    });
    try {
      expect(screen.getByTestId('staff-calls.empty')).toBeTruthy();
      expect(screen.getByText(t('staff.calls.emptyTitle'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('puts the open count on the waiter’s Today row, first on the page', () => {
    const screen = renderRoute(StaffToday, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.calls(V), CALLS]],
    });
    try {
      const row = screen.getByTestId('staff.row.calls');
      expect(
        within(row).getByText(t('staff.calls.rowCount', { count: formatNumber(2, locale) })),
      ).toBeTruthy();
      expect(screen.getByText(t('staff.calls.group'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives no calls row to the cashier, who answers on the till', () => {
    const screen = renderRoute(StaffToday, { locale, staff: { role: 'cashier' } });
    try {
      expect(screen.queryByTestId('staff.row.calls')).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});
