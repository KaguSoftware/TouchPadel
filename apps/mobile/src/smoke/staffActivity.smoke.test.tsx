/**
 * The owner's activity monitor (0341) as a route case, plus what it shows (each
 * person's operator and phone apart, an app never used, the break badge, the
 * filter) and Today's tile, in EN and AR. The board is seeded under
 * `activityKeys`, so nothing reaches the (mocked) client on first render.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { countPhrase, makeT, type Locale, type MessageKey } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { activityKeys } from '../features/staff/activity/api';
import type { ActivityBoard, ActivityPart } from '../features/staff/activity/logic';
import StaffActivity from '../../app/(staff)/staff-activity';
import StaffToday from '../../app/staff';

const ALI = 'ac700000-0000-4000-8000-0000000000a1';
const RANA = 'ac700000-0000-4000-8000-0000000000a2';

// One clock reading for both, so "5 min ago" never rounds down to 4 by the ms between them.
const BASE = Date.now();
const NOW = new Date(BASE).toISOString();
const minutesAgo = (n: number) => new Date(BASE - n * 60_000).toISOString();

const part = (over: Partial<ActivityPart>): ActivityPart => ({
  status: 'online',
  state: 'active',
  stateAt: minutesAgo(1),
  lastSeenAt: minutesAgo(1),
  screen: null,
  appVersion: null,
  deviceId: null,
  lastAction: null,
  lastActionEntity: null,
  lastActionAt: null,
  ...over,
});

const BOARD: ActivityBoard = {
  serverTime: NOW,
  rows: [
    {
      staffId: ALI,
      name: 'Ali',
      role: 'cashier',
      onBreak: false,
      operator: part({
        status: 'online',
        lastSeenAt: minutesAgo(3),
        screen: '/till',
        lastAction: 'discount.apply',
        lastActionAt: minutesAgo(5),
      }),
      mobile: null,
    },
    {
      staffId: RANA,
      name: 'Rana',
      role: 'waiter',
      onBreak: true,
      operator: null,
      mobile: part({ status: 'away', state: 'background', lastSeenAt: minutesAgo(8) }),
    },
  ],
};

runSmokeCases('staff activity', [
  {
    route: 'staff-activity',
    Component: StaffActivity,
    nearbyKey: 'staff.activity.filter.all',
    options: { staff: { role: 'owner' }, queryData: [[activityKeys.board, BOARD]] },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('staff activity in %s', (locale) => {
  const t = makeT(locale);

  it('shows each person with the operator and the phone apart', () => {
    const screen = renderRoute(StaffActivity, {
      locale,
      staff: { role: 'owner' },
      queryData: [[activityKeys.board, BOARD]],
    });
    try {
      const ali = `staff-activity.row.${ALI}`;
      expect(within(screen.getByTestId(ali)).getByText('Ali')).toBeTruthy();
      expect(within(screen.getByTestId(ali)).getByText(t('op.roles.cashier' as MessageKey))).toBeTruthy();
      const op = screen.getByTestId(`${ali}.operator`);
      expect(within(op).getByText(t('staff.activity.surface.operator'))).toBeTruthy();
      expect(within(op).getByText(t('staff.activity.status.online'))).toBeTruthy();
      expect(
        within(op).getByText(
          t('staff.activity.lastAction', {
            action: t('ws.manager.audit.actions.discountApply' as MessageKey),
            when: countPhrase('staff.activity.ago.minutes', 5, locale),
          }),
        ),
      ).toBeTruthy();
      // Never used the phone: the word, and nothing else under it.
      const phone = screen.getByTestId(`${ali}.mobile`);
      expect(within(phone).getByText(t('staff.activity.surface.mobile'))).toBeTruthy();
      expect(within(phone).getByText(t('staff.activity.status.never'))).toBeTruthy();
      expect(screen.queryByTestId(`${ali}.mobile.action`)).toBeNull();

      const rana = `staff-activity.row.${RANA}`;
      expect(within(screen.getByTestId(`${rana}.mobile`)).getByText(t('staff.activity.status.away'))).toBeTruthy();
      expect(
        within(screen.getByTestId(`${rana}.operator`)).getByText(t('staff.activity.status.never')),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(`${rana}.break`)).getByText(t('staff.activity.onBreak')),
      ).toBeTruthy();
      expect(screen.queryByTestId(`${ali}.break`)).toBeNull();

      expect(
        within(screen.getByTestId('staff-activity.summary')).getByText(
          t('staff.activity.summary', { operator: 1, mobile: 0 }),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('keeps only the people online when asked', () => {
    const screen = renderRoute(StaffActivity, {
      locale,
      staff: { role: 'owner' },
      queryData: [[activityKeys.board, BOARD]],
    });
    try {
      fireEvent.press(screen.getByTestId('staff-activity.filter.online'));
      expect(screen.getByTestId(`staff-activity.row.${ALI}`)).toBeTruthy();
      expect(screen.queryByTestId(`staff-activity.row.${RANA}`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it("puts the owner's tile on Today, and it opens the monitor", () => {
    const owner = renderRoute(StaffToday, { locale, staff: { role: 'owner' } });
    try {
      const tile = owner.getByTestId('staff.activity');
      expect(within(tile).getByText(t('staff.activity.entry'))).toBeTruthy();
      fireEvent.press(tile);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-activity' });
    } finally {
      owner.unmount();
    }
    const waiter = renderRoute(StaffToday, { locale, staff: { role: 'waiter' } });
    try {
      expect(waiter.queryByTestId('staff.activity')).toBeNull();
    } finally {
      waiter.unmount();
    }
  });
});
