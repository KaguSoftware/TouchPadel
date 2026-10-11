/**
 * Rewards for orders placed (0332): the person's own page and the owner's page
 * as route cases, plus Today's track (the route's own case is in
 * staff.smoke.test.tsx) and the owner's tile, in EN and AR. Reads are seeded
 * under `staffKeys`, so nothing reaches the (mocked) client on first render.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { countPhrase, formatIQD, formatMonthLong, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import type { MyRewards, RewardsBoard } from '../features/staff/rewards/api';
import StaffRewards from '../../app/staff-rewards';
import StaffRewardsAdmin from '../../app/staff-rewards-admin';
import StaffToday from '../../app/staff';

const V = TEST_VENUE_ID;
const R1 = 'e1a00000-0000-4000-8000-000000000001';
const R2 = 'e1a00000-0000-4000-8000-000000000002';
const R3 = 'e1a00000-0000-4000-8000-000000000003';
const RANA = 'e1a00000-0000-4000-8000-0000000000a1';

const MINE: MyRewards = {
  month: '2026-10-01',
  month_end: '2026-10-31',
  days_left: 21,
  count: 184,
  rewards: [
    { id: R1, target: 100, reward_iqd: 25000, prize: null },
    { id: R2, target: 200, reward_iqd: 50000, prize: 'Dinner for two' },
    { id: R3, target: 300, reward_iqd: 100000, prize: null },
  ],
  last_month: {
    month: '2026-09-01',
    count: 240,
    reached: [
      { target: 100, reward_iqd: 25000, prize: null, pay_month: '2026-10-01' },
      { target: 200, reward_iqd: 50000, prize: 'Dinner for two', pay_month: '2026-10-01' },
    ],
  },
};

/** Last month closed (0333): a bonus paid in November, a prize-only row, and one not yet written down. */
const CLOSED: MyRewards = {
  ...MINE,
  last_month: {
    month: '2026-09-01',
    count: 340,
    reached: [
      { target: 100, reward_iqd: 25000, prize: null, pay_month: '2026-11-01' },
      { target: 300, reward_iqd: 0, prize: 'Dinner for two', pay_month: '2026-11-01' },
    ],
  },
};

const BOARD: RewardsBoard = {
  month: '2026-10-01',
  month_end: '2026-10-31',
  days_left: 21,
  people: [
    {
      staff_id: RANA,
      name: 'Rana',
      role: 'waiter',
      count: 184,
      last_month_count: 240,
      rewards: [
        { id: R1, target: 100, reward_iqd: 25000, prize: null, set_at: '2026-10-01T09:00:00Z' },
      ],
    },
  ],
};

runSmokeCases('staff rewards', [
  {
    route: 'staff-rewards',
    Component: StaffRewards,
    nearbyKey: 'staff.rewards.mine.how',
    options: { staff: { role: 'waiter' }, queryData: [[staffKeys.myRewards(V), MINE]] },
  },
  {
    route: 'staff-rewards-admin',
    Component: StaffRewardsAdmin,
    nearbyKey: 'staff.rewards.admin.intro',
    options: { staff: { role: 'owner' }, queryData: [[staffKeys.rewardsBoard(V), BOARD]] },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('staff rewards in %s', (locale) => {
  const t = makeT(locale);

  it("puts the person's track at the top of Today, about the next reward, and opens their page", () => {
    const screen = renderRoute(StaffToday, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.myRewards(V), MINE]],
    });
    try {
      const headline = screen.getByTestId('staff.rewards.headline');
      // 16 orders to 50,000 IQD, the next reward, never a total.
      const toGo = countPhrase('staff.rewards.orders', 16, locale);
      expect(within(headline).getByText(formatIQD(50000, locale))).toBeTruthy();
      expect(
        screen.getByText(t('staff.rewards.card.plusPrize', { prize: 'Dinner for two' })),
      ).toBeTruthy();
      const [before] = t('staff.rewards.card.next', { orders: toGo, reward: '\u0000' }).split(
        '\u0000',
      );
      expect((headline.props.children as unknown[])[0]).toBe(before);
      fireEvent.press(screen.getByTestId('staff.rewards'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-rewards' });
    } finally {
      screen.unmount();
    }
  });

  it('shows no track to someone with no rewards, and none to the owner', () => {
    const none = renderRoute(StaffToday, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.myRewards(V), { ...MINE, rewards: [] }]],
    });
    try {
      expect(none.queryByTestId('staff.rewards')).toBeNull();
    } finally {
      none.unmount();
    }
    const owner = renderRoute(StaffToday, { locale, staff: { role: 'owner' } });
    try {
      expect(owner.queryByTestId('staff.rewards')).toBeNull();
      const tile = owner.getByTestId('staff.rewards-admin');
      expect(within(tile).getByText(t('staff.rewards.admin.entry'))).toBeTruthy();
    } finally {
      owner.unmount();
    }
  });

  it("lists the person's rewards with what is left, and last month's", () => {
    const screen = renderRoute(StaffRewards, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.myRewards(V), MINE]],
    });
    try {
      expect(
        within(screen.getByTestId(`staff-rewards.reward.${R1}`)).getByText(
          t('staff.rewards.mine.reached'),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(`staff-rewards.reward.${R2}`)).getByText(
          t('staff.rewards.mine.toGo', { orders: countPhrase('staff.rewards.orders', 16, locale) }),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('staff-rewards.last-month.200')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('says which wage a bonus reached last month is added to, and nothing for a prize alone', () => {
    const screen = renderRoute(StaffRewards, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.myRewards(V), CLOSED]],
    });
    try {
      const november = formatMonthLong(new Date('2026-11-01T12:00:00Z'), locale);
      expect(
        within(screen.getByTestId('staff-rewards.last-month.100')).getByText(
          t('staff.rewards.mine.inWage', { month: november }),
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId('staff-rewards.last-month.300.in-wage')).toBeNull();
      expect(screen.getByTestId('staff-rewards.last-month.300')).toBeTruthy();
    } finally {
      screen.unmount();
    }
    const open = renderRoute(StaffRewards, {
      locale,
      staff: { role: 'waiter' },
      queryData: [
        [
          staffKeys.myRewards(V),
          {
            ...MINE,
            last_month: {
              ...MINE.last_month,
              reached: MINE.last_month.reached.map((r) => ({ ...r, pay_month: null })),
            },
          },
        ],
      ],
    });
    try {
      expect(open.queryByTestId('staff-rewards.last-month.100.in-wage')).toBeNull();
    } finally {
      open.unmount();
    }
  });

  it("opens the owner's form in place and refuses a reward with nothing in it", () => {
    const screen = renderRoute(StaffRewardsAdmin, {
      locale,
      staff: { role: 'owner' },
      queryData: [[staffKeys.rewardsBoard(V), BOARD]],
    });
    try {
      const id = `staff-rewards-admin.person.${RANA}`;
      expect(screen.getByText('Rana')).toBeTruthy();
      expect(
        within(screen.getByTestId(`${id}.reward.${R1}`)).getByText(
          t('staff.rewards.admin.reached'),
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId(`${id}.add`));
      fireEvent.changeText(screen.getByTestId(`${id}.target`), '300');
      fireEvent.press(screen.getByTestId(`${id}.save`));
      expect(screen.getByText(t('staff.rewards.admin.rewardMissing'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});
