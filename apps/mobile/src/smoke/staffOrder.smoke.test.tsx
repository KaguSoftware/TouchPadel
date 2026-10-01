/**
 * Place an order on the staff phone (owner, 2026-09-28; migration 0251): the
 * tables, a table's menu, an item's sheet and the review, rendered as a staff
 * session in EN and AR. See `src/smoke/auth.smoke.test.tsx` for what a case
 * asserts and `src/test/smokeCase.tsx` for how.
 *
 * The floor and the menu are seeded under their `staffKeys` entries; the
 * order being built lives in the drafts store (floor/drafts.ts), which a case
 * arranges and clears. The cases after the table pin the flow: a one-tap add,
 * an item that needs its sheet, a required option refused by name, the tab
 * chosen for a table with one tab and asked for with several, the closed day,
 * and a role that is not on the floor.
 */
import { describe, expect, it } from '@jest/globals';
import { act, fireEvent, within } from '@testing-library/react-native';
import { formatNumber, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import { clearDraft, getDraft, updateDraft } from '../features/staff/floor/drafts';
import { addLine, type Floor, type MenuCategory } from '../features/staff/floor/logic';
import StaffOrder from '../../app/staff-order';
import StaffOrderMenu from '../../app/staff-order-menu';
import StaffOrderItem from '../../app/staff-order-item';
import StaffOrderReview from '../../app/staff-order-review';

const V = TEST_VENUE_ID;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = ID(1);
const T2 = ID(2);
const T3 = ID(3);
const TAB_A = ID(11);
const TAB_B = ID(12);
const TAB_C = ID(13);

const FLOOR: Floor = {
  day_open: true,
  tables: [
    {
      id: T1,
      table_number: '1',
      zone: null,
      tabs: [
        {
          id: TAB_A,
          label: 'Ali',
          opened_at: '2026-09-28T10:00:00Z',
          mine: true,
          lines: [{ name_en: 'Latte', name_ar: 'لاتيه', size_en: 'Large', size_ar: 'كبير', qty: 2 }],
        },
      ],
    },
    { id: T2, table_number: '2', zone: null, tabs: [] },
    {
      id: T3,
      table_number: '3',
      zone: null,
      tabs: [
        { id: TAB_B, label: null, opened_at: '2026-09-28T10:00:00Z', mine: false, lines: [] },
        { id: TAB_C, label: 'Sara', opened_at: '2026-09-28T10:05:00Z', mine: false, lines: [] },
      ],
    },
  ],
};

const MENU: MenuCategory[] = [
  {
    id: ID(20),
    name_en: 'Drinks',
    name_ar: 'مشروبات',
    items: [
      {
        id: ID(21),
        name_en: 'Water',
        name_ar: 'ماء',
        orderable: true,
        variants: [{ id: ID(22), name_en: 'Bottle', name_ar: 'قنينة', price_iqd: 1000, is_default: true }],
        groups: [],
      },
      {
        id: ID(23),
        name_en: 'Karak',
        name_ar: 'كرك',
        orderable: true,
        variants: [{ id: ID(24), name_en: 'Cup', name_ar: 'كوب', price_iqd: 2000, is_default: true }],
        groups: [
          {
            id: ID(25),
            name_en: 'Sugar',
            name_ar: 'سكر',
            min_select: 1,
            max_select: 1,
            modifiers: [
              { id: ID(26), name_en: 'No sugar', name_ar: 'بدون سكر', price_delta_iqd: 0, reveals: [] },
              { id: ID(27), name_en: 'Sweet', name_ar: 'حلو', price_delta_iqd: 0, reveals: [] },
            ],
          },
        ],
      },
      {
        id: ID(28),
        name_en: 'Scone',
        name_ar: 'سكون',
        orderable: false,
        variants: [{ id: ID(29), name_en: 'One', name_ar: 'واحد', price_iqd: 3000, is_default: true }],
        groups: [],
      },
    ],
  },
];

const SEEDS: [readonly unknown[], unknown][] = [
  [staffKeys.floor(V), FLOOR],
  [staffKeys.floorMenu(V), MENU],
];
const WAITER = { role: 'waiter' as const };

/** Clear every table's draft after a case: the store outlives a render. */
const clean = () => () => [T1, T2, T3].forEach(clearDraft);

runSmokeCases('staff place an order', [
  {
    route: 'staff-order',
    Component: StaffOrder,
    nearbyKey: 'staff.floor.tables.lead',
    options: { staff: WAITER, queryData: SEEDS },
  },
  {
    route: 'staff-order-menu',
    Component: StaffOrderMenu,
    labelKey: 'staff.floor.menu.review',
    options: { staff: WAITER, params: { table: T1 }, queryData: SEEDS },
    arrange: clean,
  },
  {
    route: 'staff-order-item',
    Component: StaffOrderItem,
    labelKey: 'staff.floor.item.add',
    options: { staff: WAITER, params: { table: T1, item: ID(23) }, queryData: SEEDS },
    arrange: clean,
  },
  {
    // A table with no tab: nothing added yet opens a new tab on its own.
    route: 'staff-order-review',
    Component: StaffOrderReview,
    labelKey: 'staff.floor.menu.openTab',
    options: { staff: WAITER, params: { table: T2 }, queryData: SEEDS },
    arrange: clean,
  },
]);

describe.each<Locale>(['en', 'ar'])('place an order in %s', (locale) => {
  const t = makeT(locale);

  it('marks a table with a tab and a table with an order not yet sent', () => {
    updateDraft(T2, (d) => addLine(d, { itemId: ID(21), variantId: ID(22), qty: 1, modifierIds: [], note: '' }, 'k'), {
      kind: 'new',
    });
    const screen = renderRoute(StaffOrder, { locale, staff: WAITER, queryData: SEEDS });
    try {
      const t1 = screen.getByTestId(`staff-order.table.${T1}`);
      expect(within(t1).getByText(t('staff.floor.tables.tabsOpen', { count: formatNumber(1, locale) }))).toBeTruthy();
      expect(within(screen.getByTestId(`staff-order.table.${T2}`)).getByText(t('staff.floor.tables.notSent'))).toBeTruthy();
      fireEvent.press(t1);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-order-menu', params: { table: T1 } },
      });
    } finally {
      screen.unmount();
      clearDraft(T2);
    }
  });

  it('says the day is not open and takes no table', () => {
    const screen = renderRoute(StaffOrder, {
      locale,
      staff: WAITER,
      queryData: [[staffKeys.floor(V), { ...FLOOR, day_open: false }]],
    });
    try {
      expect(screen.getByText(t('staff.floor.tables.dayClosed'))).toBeTruthy();
      expect(screen.getByTestId(`staff-order.table.${T1}`).props.accessibilityState.disabled).toBe(true);
    } finally {
      screen.unmount();
    }
  });

  it('adds a one-size item with one tap, sends one with options to its sheet, and holds the sold out', () => {
    const screen = renderRoute(StaffOrderMenu, { locale, staff: WAITER, params: { table: T1 }, queryData: SEEDS });
    try {
      // The table's only tab is chosen already.
      expect(screen.getByTestId(`staff-order-menu.target.tab.${TAB_A}`).props.accessibilityState.checked).toBe(true);
      act(() => fireEvent.press(screen.getByTestId(`staff-order-menu.item.${ID(21)}`)));
      act(() => fireEvent.press(screen.getByTestId(`staff-order-menu.item.${ID(21)}`)));
      expect(getDraft(T1)?.lines).toEqual([expect.objectContaining({ variantId: ID(22), qty: 2 })]);
      expect(
        within(screen.getByTestId('staff-order-menu.review')).getByText(
          t('staff.floor.menu.reviewCount', { count: formatNumber(2, locale) }),
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-order-menu.item.${ID(23)}`));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-order-item', params: { table: T1, item: ID(23) } },
      });
      expect(screen.getByTestId(`staff-order-menu.item.${ID(28)}`).props.accessibilityState.disabled).toBe(true);
    } finally {
      screen.unmount();
      clearDraft(T1);
    }
  });

  it('asks which tab when the table has several', () => {
    const screen = renderRoute(StaffOrderMenu, { locale, staff: WAITER, params: { table: T3 }, queryData: SEEDS });
    try {
      expect(screen.getByText(t('staff.floor.menu.pickTab'))).toBeTruthy();
      expect(screen.getByTestId('staff-order-menu.review').props.accessibilityState.disabled).toBe(true);
      act(() => fireEvent.press(screen.getByTestId(`staff-order-menu.target.tab.${TAB_C}`)));
      expect(getDraft(T3)?.target).toEqual({ kind: 'tab', tabId: TAB_C });
    } finally {
      screen.unmount();
      clearDraft(T3);
    }
  });

  it('refuses Add until the required option is chosen, naming it', () => {
    const screen = renderRoute(StaffOrderItem, {
      locale,
      staff: WAITER,
      params: { table: T1, item: ID(23) },
      queryData: SEEDS,
    });
    try {
      fireEvent.press(screen.getByTestId('staff-order-item.add'));
      expect(screen.getByText(t('staff.floor.item.missing', { group: locale === 'ar' ? 'سكر' : 'Sugar' }))).toBeTruthy();
      expect(getDraft(T1)).toBeNull();
      fireEvent.press(screen.getByTestId(`staff-order-item.option.${ID(26)}`));
      fireEvent.press(screen.getByTestId('staff-order-item.qty.more'));
      act(() => fireEvent.press(screen.getByTestId('staff-order-item.add')));
      expect(getDraft(T1)?.lines).toEqual([
        expect.objectContaining({ variantId: ID(24), qty: 2, modifierIds: [ID(26)] }),
      ]);
      // Back to the table's menu (with no history under the sheet, useBack's fallback).
      expect(routerState.calls).toContainEqual({
        method: 'replace',
        arg: { pathname: '/staff-order-menu', params: { table: T1 } },
      });
    } finally {
      screen.unmount();
      clearDraft(T1);
    }
  });

  it('reviews the order on its tab, and a count taken to 0 removes the line', () => {
    updateDraft(T1, (d) => addLine(d, { itemId: ID(21), variantId: ID(22), qty: 1, modifierIds: [], note: '' }, 'k1'), {
      kind: 'tab',
      tabId: TAB_A,
    });
    const screen = renderRoute(StaffOrderReview, { locale, staff: WAITER, params: { table: T1 }, queryData: SEEDS });
    try {
      expect(
        within(screen.getByTestId('staff-order-review.send')).getByText(
          t('staff.floor.review.sendCount', { count: formatNumber(1, locale) }),
        ),
      ).toBeTruthy();
      act(() => fireEvent.press(screen.getByTestId('staff-order-review.qty.k1.less')));
      expect(getDraft(T1)?.lines).toEqual([]);
      fireEvent.press(screen.getByTestId('staff-order-review.send'));
      expect(screen.getByText(t('staff.floor.review.issues.empty'))).toBeTruthy();
    } finally {
      screen.unmount();
      clearDraft(T1);
    }
  });

  it('keeps the order pages to the floor and management', () => {
    const screen = renderRoute(StaffOrder, { locale, staff: { role: 'barista' }, queryData: SEEDS });
    try {
      expect(screen.queryByTestId('staff-order.tables')).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});
