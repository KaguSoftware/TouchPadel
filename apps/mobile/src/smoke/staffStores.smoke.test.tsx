/**
 * The staff phone's store pages (wave5-addendum-2026-09-25 §5.3): Add to
 * stock, Move stock and Count the bakery, each rendered as a staff session of
 * a role that sees its primary, in EN and AR. See `src/smoke/auth.smoke.test.tsx`
 * for what a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * Every read a page makes on its first render is seeded under its `staffKeys`
 * key, so nothing reaches the (mocked) client. The cases after the table pin
 * who sees what: each role's store, the desk's cafe-only shop stock, a move
 * larger than the source shows refused before it is sent, the blind count, and
 * the stock page by store.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { staffKeys } from '../features/staff/keys';
import type { PickItem, PickList, StockToday } from '../features/staff/stores/logic';
import type { StockView } from '../features/staff/stock/logic';
import StaffStockLog from '../../app/staff-stock-log';
import StaffStockMove from '../../app/staff-stock-move';
import StaffStockCount from '../../app/staff-stock-count';
import StaffStock from '../../app/staff-stock';

const V = TEST_VENUE_ID;

const FLOUR: PickItem = {
  ingredient_id: 'flour',
  name_en: 'Flour',
  name_ar: 'طحين',
  unit: 'g',
  kind: 'purchased',
  pack_size: 1000,
};
const BUNS: PickItem = {
  ingredient_id: 'buns',
  name_en: 'Burger Buns',
  name_ar: 'خبز برغر',
  unit: 'pc',
  kind: 'purchased',
  pack_size: null,
};
const GRIP: PickItem = {
  ingredient_id: 'grip',
  name_en: 'Overgrip',
  name_ar: 'شريط',
  unit: 'pc',
  kind: 'retail',
  pack_size: null,
};

const list = (
  purpose: PickList['purpose'],
  location: PickList['location'],
  items: PickItem[],
): PickList => ({
  purpose,
  location,
  items,
});

const TODAY: StockToday = {
  business_date: '2026-09-26',
  transfers: [
    {
      transfer_id: 'tr-1',
      from: 'cafe',
      to: 'bakery',
      moved_by_name: 'Hasan',
      moved_at: '2026-09-26T07:10:00Z',
      lines: [{ ingredient_id: 'flour', name_en: 'Flour', name_ar: 'طحين', unit: 'g', qty: 5000 }],
    },
  ],
  logs: [
    {
      delivery_id: 'dl-1',
      location: 'cafe',
      source: 'staff_log',
      received_by_name: 'Bareq',
      received_at: '2026-09-26T06:30:00Z',
      lines: [
        {
          ingredient_id: 'buns',
          name_en: 'Burger Buns',
          name_ar: 'خبز برغر',
          unit: 'pc',
          qty: 24,
          expiry_date: null,
        },
      ],
    },
  ],
  driver_deliveries_waiting: 2,
  counts: [
    {
      count_id: 'cnt-1',
      location: 'bakery',
      status: 'applied',
      counted_by_name: 'Tiba',
      submitted_at: '2026-09-25T18:00:00Z',
      applied_at: '2026-09-25T19:00:00Z',
      lines: [
        {
          ingredient_id: 'flour',
          name_en: 'Flour',
          name_ar: 'طحين',
          unit: 'g',
          counted_qty: 12000,
        },
      ],
    },
  ],
};

const LOG_CAFE = list('log', 'cafe', [BUNS, FLOUR, GRIP]);
const LOG_CAFE_HEAD = list('log', 'cafe', [BUNS, FLOUR]);
const LOG_BAKERY = list('log', 'bakery', [BUNS, FLOUR]);
const MOVE_CAFE = list('move', 'cafe', [
  { ...BUNS, on_hand: 40 },
  { ...FLOUR, on_hand: 9000 },
]);
const MOVE_BAKERY = list('move', 'bakery', [{ ...FLOUR, on_hand: 2000 }]);
const COUNT_BAKERY = list('count', 'bakery', [BUNS, FLOUR]);
const COUNT_CAFE = list('count', 'cafe', [BUNS, FLOUR, GRIP]);

runSmokeCases('staff stores', [
  {
    route: 'staff-stock-log',
    Component: StaffStockLog,
    labelKey: 'staff.stores.log.save.cafe',
    options: {
      staff: { role: 'head_barista' },
      queryData: [
        [staffKeys.stockPick(V, 'log', 'cafe'), LOG_CAFE_HEAD],
        [staffKeys.stockToday(V), TODAY],
      ],
    },
  },
  {
    route: 'staff-stock-move',
    Component: StaffStockMove,
    labelKey: 'staff.stores.move.save.bakery',
    options: {
      staff: { role: 'waiter' },
      queryData: [
        [staffKeys.stockPick(V, 'move', 'cafe'), MOVE_CAFE],
        [
          staffKeys.stockToday(V),
          { ...TODAY, logs: null, counts: null, driver_deliveries_waiting: null },
        ],
      ],
    },
  },
  {
    route: 'staff-stock-count',
    Component: StaffStockCount,
    labelKey: 'staff.stores.count.submit',
    options: {
      staff: { role: 'chef' },
      queryData: [
        [staffKeys.stockPick(V, 'count', 'bakery'), COUNT_BAKERY],
        [
          staffKeys.stockToday(V),
          { ...TODAY, transfers: null, logs: null, driver_deliveries_waiting: null },
        ],
      ],
    },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('who sees what on the store pages in %s', (locale) => {
  const t = makeT(locale);

  it('opens the head chef’s Add to stock on the bakery, with the cafe a tap away', () => {
    const screen = renderRoute(StaffStockLog, {
      locale,
      staff: { role: 'head_chef' },
      queryData: [
        [staffKeys.stockPick(V, 'log', 'bakery'), LOG_BAKERY],
        [staffKeys.stockPick(V, 'log', 'cafe'), LOG_CAFE_HEAD],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      expect(screen.getByText(t('staff.stores.log.save.bakery'))).toBeTruthy();
      expect(screen.getByTestId('staff-stock-log.store.cafe')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-stock-log.store.cafe'));
      expect(screen.getByText(t('staff.stores.log.save.cafe'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives the desk no store to pick: shop stock goes into the cafe', () => {
    const screen = renderRoute(StaffStockLog, {
      locale,
      staff: { role: 'court_desk' },
      queryData: [
        [staffKeys.stockPick(V, 'log', 'cafe'), list('log', 'cafe', [GRIP])],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      expect(screen.queryByTestId('staff-stock-log.store')).toBeNull();
      expect(screen.getByText(t('staff.stores.log.leadShop'))).toBeTruthy();
      expect(screen.getByText(t('staff.stores.log.save.cafe'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('names the driver’s purchases still waiting, shows the day’s additions, and asks for an amount', () => {
    const screen = renderRoute(StaffStockLog, {
      locale,
      staff: { role: 'head_barista' },
      queryData: [
        [staffKeys.stockPick(V, 'log', 'cafe'), LOG_CAFE_HEAD],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      expect(screen.getByTestId('staff-stock-log.driver-waiting')).toBeTruthy();
      expect(screen.getByText(t('staff.stores.log.driverWaiting', { count: 2 }))).toBeTruthy();
      expect(screen.getByTestId('staff-stock-log.today.dl-1')).toBeTruthy();
      // Nothing picked yet: Save says to pick something.
      fireEvent.press(screen.getByTestId('staff-stock-log.save'));
      expect(screen.getByText(t('staff.stores.errors.lines'))).toBeTruthy();
      // A short list is offered whole; pressing an item adds its line.
      fireEvent.press(screen.getByTestId('staff-stock-log.item.flour'));
      expect(screen.getByTestId('staff-stock-log.qty.flour')).toBeTruthy();
      // Flour comes in packs of 1,000 g; buns do not.
      expect(screen.getByTestId('staff-stock-log.unit.flour')).toBeTruthy();
      expect(screen.queryByTestId('staff-stock-log.item.flour')).toBeNull();
      fireEvent.press(screen.getByTestId('staff-stock-log.save'));
      expect(screen.getByText(t('staff.stores.errors.qty'))).toBeTruthy();
      // The use-by date waits behind a link.
      expect(screen.queryByTestId('staff-stock-log.expiry.flour')).toBeNull();
      fireEvent.press(screen.getByTestId('staff-stock-log.expiry-add.flour'));
      expect(screen.getByTestId('staff-stock-log.expiry.flour')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('refuses a shop line at the bakery before it is sent (V14)', () => {
    const screen = renderRoute(StaffStockLog, {
      locale,
      staff: { role: 'cashier' },
      queryData: [
        [staffKeys.stockPick(V, 'log', 'cafe'), LOG_CAFE],
        [staffKeys.stockPick(V, 'log', 'bakery'), LOG_BAKERY],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      fireEvent.press(screen.getByTestId('staff-stock-log.item.grip'));
      expect(screen.queryByText(t('staff.stores.errors.cafeOnly'))).toBeNull();
      fireEvent.press(screen.getByTestId('staff-stock-log.store.bakery'));
      expect(screen.getByText(t('staff.stores.errors.cafeOnly'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('shows what the source holds and refuses a move larger than that, then swaps the stores', () => {
    const screen = renderRoute(StaffStockMove, {
      locale,
      staff: { role: 'waiter' },
      queryData: [
        [staffKeys.stockPick(V, 'move', 'cafe'), MOVE_CAFE],
        [staffKeys.stockPick(V, 'move', 'bakery'), MOVE_BAKERY],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      expect(screen.getByTestId('staff-stock-move.today.tr-1')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-stock-move.item.buns'));
      fireEvent.changeText(screen.getByTestId('staff-stock-move.qty.buns'), '50');
      fireEvent.press(screen.getByTestId('staff-stock-move.move'));
      expect(
        screen.getByText(
          t('staff.stores.errors.short.cafe', {
            qty: t('staff.supplies.qtyUnit', {
              qty: '40',
              unit: t('staff.supplies.units.many.pc'),
            }),
          }),
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-stock-move.swap'));
      expect(screen.getByText(t('staff.stores.move.save.cafe'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('counts blind: names and units only, and counts what was typed', () => {
    const screen = renderRoute(StaffStockCount, {
      locale,
      staff: { role: 'head_chef' },
      queryData: [
        [staffKeys.stockPick(V, 'count', 'bakery'), COUNT_BAKERY],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      // The kitchen counts the bakery only: no store to pick.
      expect(screen.queryByTestId('staff-stock-count.store')).toBeNull();
      expect(screen.getByTestId('staff-stock-count.item.flour')).toBeTruthy();
      expect(screen.getByTestId('staff-stock-count.unit.flour')).toBeTruthy();
      expect(screen.queryByTestId('staff-stock-count.unit.buns')).toBeNull();
      // No on-hand figure anywhere on the sheet.
      expect(screen.queryByText(t('staff.checklists.stock.onHand', { qty: '9,000 g' }))).toBeNull();
      expect(
        screen.getByText(t('staff.stores.count.counted', { count: 0, total: 2 })),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-stock-count.submit'));
      expect(screen.getByText(t('staff.stores.errors.countNone'))).toBeTruthy();
      fireEvent.changeText(screen.getByTestId('staff-stock-count.item.buns'), '0');
      expect(
        screen.getByText(t('staff.stores.count.counted', { count: 1, total: 2 })),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('holds a new count while one of this store waits for a manager', () => {
    const waiting: StockToday = {
      ...TODAY,
      counts: [{ ...TODAY.counts![0]!, count_id: 'cnt-2', status: 'waiting', applied_at: null }],
    };
    const screen = renderRoute(StaffStockCount, {
      locale,
      staff: { role: 'chef' },
      queryData: [
        [staffKeys.stockPick(V, 'count', 'bakery'), COUNT_BAKERY],
        [staffKeys.stockToday(V), waiting],
      ],
    });
    try {
      expect(screen.getByTestId('staff-stock-count.waiting')).toBeTruthy();
      expect(screen.getByTestId('staff-stock-count.submit').props.accessibilityState.disabled).toBe(
        true,
      );
      // The reason is repeated by the button it holds, at the end of a long sheet.
      expect(screen.getByText(t('staff.stores.count.held'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lets a manager count either store, and keeps each store’s numbers apart', () => {
    const screen = renderRoute(StaffStockCount, {
      locale,
      staff: { role: 'manager' },
      queryData: [
        [staffKeys.stockPick(V, 'count', 'bakery'), COUNT_BAKERY],
        [staffKeys.stockPick(V, 'count', 'cafe'), COUNT_CAFE],
        [staffKeys.stockToday(V), TODAY],
      ],
    });
    try {
      fireEvent.changeText(screen.getByTestId('staff-stock-count.item.flour'), '12');
      fireEvent.press(screen.getByTestId('staff-stock-count.store.cafe'));
      expect(
        screen.getByText(t('staff.stores.count.counted', { count: 0, total: 3 })),
      ).toBeTruthy();
      expect(screen.getByTestId('staff-stock-count.item.grip')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('splits the stock page by store for the waiter, and keeps the desk’s one list', () => {
    const view: StockView = {
      as_of: '2026-09-26T09:00:00Z',
      items: [
        {
          ingredient_id: 'flour',
          kind: 'purchased',
          name_en: 'Flour',
          name_ar: 'طحين',
          unit: 'g',
          pack_size: 1000,
          on_hand: 11000,
          par_level: null,
          low_stock_threshold: null,
          low: false,
          below_par: false,
          next_expiry: null,
          product: null,
          by_location: { cafe: 9000, bakery: 2000 },
        },
        {
          ingredient_id: 'buns',
          kind: 'purchased',
          name_en: 'Burger Buns',
          name_ar: 'خبز برغر',
          unit: 'pc',
          pack_size: null,
          on_hand: 40,
          par_level: null,
          low_stock_threshold: null,
          low: false,
          below_par: false,
          next_expiry: null,
          product: null,
          by_location: { cafe: 40, bakery: 0 },
        },
      ],
    };
    const waiter = renderRoute(StaffStock, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[staffKeys.stock(V, 'all'), view]],
    });
    try {
      expect(waiter.getByTestId('staff-stock.list')).toBeTruthy();
      expect(waiter.getByTestId('staff-stock.store.cafe')).toBeTruthy();
      fireEvent.press(waiter.getByTestId('staff-stock.store.bakery'));
      expect(waiter.getByText(t('staff.stores.stock.notHere.bakery', { count: 1 }))).toBeTruthy();
    } finally {
      waiter.unmount();
    }
    const desk = renderRoute(StaffStock, {
      locale,
      staff: { role: 'court_desk' },
      queryData: [[staffKeys.stock(V, 'all'), { ...view, items: [] }]],
    });
    try {
      expect(desk.queryByTestId('staff-stock.store')).toBeNull();
    } finally {
      desk.unmount();
    }
  });
});
