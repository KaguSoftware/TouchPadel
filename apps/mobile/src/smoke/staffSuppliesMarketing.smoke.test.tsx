/**
 * The supplies and marketing pages of the staff phone: the shopping list, the
 * driver's purchases, marketing, and requests to marketing
 * (build-contracts-2026-09-23 §6.1, §6.2), rendered as a staff session in EN
 * and AR. See `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * Every read a page makes on its first render is seeded under its
 * `staffKeys` entry, so nothing reaches the client. The cases after the table
 * pin the parts that differ by role: the driver's run and Delivered, the
 * chef assistant's waiting line and the head chef's OK, marketing's counts
 * with no money, marketing's inbox, and a guest who never gets in.
 */
import { describe, expect, it } from '@jest/globals';
import { act, fireEvent, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { expectAlerted } from '../test/alertState';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { headerAdd } from '../test/headerAdd';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import type { IngredientOptions, MyPurchases, ShoppingItem, ShoppingListPage } from '../features/staff/supplies/api';
import type { CampaignResults, MarketingRequest, MarketingRequestsPage } from '../features/staff/marketing/api';
import StaffShopping from '../../app/(staff)/staff-shopping';
import StaffPurchase from '../../app/(staff)/staff-purchase';
import StaffPurchaseNew from '../../app/(staff)/staff-purchase-new';
import StaffPurchaseItems from '../../app/(staff)/staff-purchase-items';
import StaffPurchaseReview from '../../app/(staff)/staff-purchase-review';
import { resetPurchaseDraft } from '../features/staff/supplies/purchaseDraft';
import StaffPurchaseDetail from '../../app/(staff)/staff-purchase-detail';
import StaffMarketing from '../../app/(staff)/staff-marketing';
import StaffMarketingRequests from '../../app/(staff)/staff-marketing-requests';
import StaffMarketingRequestNew from '../../app/(staff)/staff-marketing-request-new';
import StaffOrderSlip from '../../app/(staff)/staff-order-slip';
import StaffOrderSlipNew from '../../app/(staff)/staff-order-slip-new';
import StaffReceipt from '../../app/(staff)/staff-receipt';

const V = TEST_VENUE_ID;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FLOUR = ID(1);

function line(patch: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: ID(10),
    ingredient_id: null,
    name_en: null,
    name_ar: null,
    label: 'Dish soap',
    qty: 2,
    unit: 'pc',
    note: null,
    requested_by_name: 'Rusul',
    requested_at: '2026-09-25T08:00:00Z',
    status: 'open',
    mine: false,
    decline_reason: null,
    ...patch,
  };
}

const page = (items: ShoppingItem[], pending = 0): ShoppingListPage => ({
  items,
  open_count: items.filter((i) => i.status === 'open').length,
  pending_count: pending,
});
const EMPTY_LIST = page([]);
const INGREDIENTS: IngredientOptions = {
  ingredients: [{ id: FLOUR, name_en: 'Flour', name_ar: 'طحين', unit: 'g', kind: 'purchased', pack_size: 1000 }],
};
const PACK_FLOUR = line({ id: ID(20), ingredient_id: FLOUR, name_en: 'Flour', name_ar: 'طحين', label: null, unit: 'pack' });
const NO_PURCHASES: MyPurchases = { purchases: [] };
const NO_REQUESTS: MarketingRequestsPage = { requests: [], open_count: 0, total: 0 };

function request(patch: Partial<MarketingRequest>): MarketingRequest {
  return {
    id: ID(30),
    title: 'Photo of the new latte',
    body: 'For the Friday post',
    want_by: null,
    menu_item_id: null,
    item_name_en: null,
    item_name_ar: null,
    photos: [],
    status: 'open',
    answer: null,
    answered_by_name: null,
    answered_at: null,
    created_at: '2026-09-25T08:00:00Z',
    requested_by_name: 'Yusuf',
    requested_by_role: 'barista',
    ...patch,
  };
}

runSmokeCases('staff supplies and marketing', [
  {
    route: 'staff-shopping',
    Component: StaffShopping,
    labelKey: 'staff.supplies.shopping.add.submit',
    options: {
      staff: { role: 'head_chef' },
      queryData: [
        [staffKeys.shopping(V, 'open'), page([line({})])],
        [staffKeys.shopping(V, 'pending'), EMPTY_LIST],
        [staffKeys.ingredients(V), INGREDIENTS],
      ],
    },
  },
  {
    route: 'staff-purchase',
    Component: StaffPurchase,
    nearbyKey: 'staff.supplies.purchase.list.empty',
    options: {
      staff: { role: 'driver' },
      queryData: [[staffKeys.purchases(V), NO_PURCHASES]],
    },
  },
  {
    route: 'staff-purchase-detail',
    Component: StaffPurchaseDetail,
    nearbyKey: 'staff.supplies.purchase.list.secItems',
    options: {
      staff: { role: 'driver' },
      params: { id: ID(40) },
      queryData: [[staffKeys.purchases(V), { purchases: [{
        id: ID(40), bought_at: '2026-09-25T09:00:00Z', shop_name: 'Al-Rasheed market', total_iqd: 60000,
        status: 'to_receive', receipt_path: null, delivered_at: null,
        lines: [{ label: null, name_en: 'Flour', name_ar: 'طحين', qty: 2000, unit: 'g', price_iqd: 60000, status: 'to_receive' }],
      }] }]],
    },
  },
  {
    route: 'staff-purchase-new',
    Component: StaffPurchaseNew,
    labelKey: 'staff.supplies.purchase.form.nextItems',
    options: {
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.shopping(V, 'open'), EMPTY_LIST],
        [staffKeys.ingredients(V), INGREDIENTS],
        [staffKeys.purchases(V), NO_PURCHASES],
      ],
    },
  },
  {
    route: 'staff-purchase-items',
    Component: StaffPurchaseItems,
    labelKey: 'staff.supplies.purchase.form.nextReview',
    options: {
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.shopping(V, 'open'), EMPTY_LIST],
        [staffKeys.ingredients(V), INGREDIENTS],
        [staffKeys.purchases(V), NO_PURCHASES],
      ],
    },
  },
  {
    route: 'staff-purchase-review',
    Component: StaffPurchaseReview,
    labelKey: 'staff.supplies.purchase.form.save',
    options: {
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.shopping(V, 'open'), EMPTY_LIST],
        [staffKeys.ingredients(V), INGREDIENTS],
        [staffKeys.purchases(V), NO_PURCHASES],
      ],
    },
  },
  {
    route: 'staff-marketing',
    Component: StaffMarketing,
    labelKey: 'staff.marketing.tabs.take',
    options: {
      staff: { role: 'marketing' },
      queryData: [
        [staffKeys.marketingNotes(V), { notes: [] }],
        [staffKeys.marketingRequests(V, 'open'), NO_REQUESTS],
      ],
    },
  },
  {
    route: 'staff-marketing-requests',
    Component: StaffMarketingRequests,
    nearbyKey: 'staff.marketing.requests.empty',
    options: {
      staff: { role: 'manager' },
      queryData: [
        [staffKeys.myMarketingRequests(V), { requests: [] }],
        [staffKeys.marketingRequests(V, 'open'), NO_REQUESTS],
      ],
    },
  },
  {
    route: 'staff-marketing-request-new',
    Component: StaffMarketingRequestNew,
    labelKey: 'staff.marketing.requests.submit',
    options: { staff: { role: 'manager' } },
  },
  // Phase 2 Milestone 4b: the camera pages, each with a row in its log.
  {
    route: 'staff-order-slip',
    Component: StaffOrderSlip,
    nearbyKey: 'staff.scan.slip.mine',
    options: {
      staff: { role: 'waiter' },
      queryData: [
        [staffKeys.myOrderSlips(V), [
          { id: ID(50), status: 'sent', created_at: '2026-09-26T10:00:00Z', table_number: 'T5', line_count: 3, rejected_reason: null },
        ]],
      ],
    },
  },
  {
    route: 'staff-order-slip-new',
    Component: StaffOrderSlipNew,
    labelKey: 'staff.scan.take',
    options: { staff: { role: 'waiter' } },
  },
  {
    route: 'staff-receipt',
    Component: StaffReceipt,
    labelKey: 'staff.scan.take',
    options: {
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.myReceipts(V), [
          { id: ID(51), status: 'read', created_at: '2026-09-26T10:00:00Z', supplier_name_read: 'Al Rafidain', total_iqd_read: 58000, rejected_reason: null },
        ]],
      ],
    },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('the supplies pages by role in %s', (locale) => {
  const t = makeT(locale);

  it('gives the driver the run as a checklist, and Record purchase opens the purchase with the ticks', () => {
    const screen = renderRoute(StaffShopping, {
      locale,
      staff: { role: 'driver' },
      queryData: [[staffKeys.shopping(V, 'open'), page([line({ id: ID(11) }), line({ id: ID(12) })])]],
    });
    try {
      // The driver adds nothing and decides nothing.
      expect(screen.queryByTestId('staff-shopping.add')).toBeNull();
      expect(screen.queryByTestId(`staff-shopping.approve.${ID(11)}`)).toBeNull();
      fireEvent.press(screen.getByTestId(`staff-shopping.run.${ID(12)}`));
      const buy = screen.getByTestId('staff-shopping.buy');
      expect(within(buy).getByText(t('staff.supplies.shopping.run.record', { count: 1 }))).toBeTruthy();
      fireEvent.press(buy);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-purchase-new', params: { itemIds: ID(12) } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('tells the chef assistant a line waits for the head chef, and lists theirs that wait', () => {
    const screen = renderRoute(StaffShopping, {
      locale,
      staff: { role: 'chef' },
      queryData: [
        [staffKeys.shopping(V, 'open'), EMPTY_LIST],
        [staffKeys.shopping(V, 'pending'), page([line({ id: ID(13), status: 'pending', mine: true })], 1)],
        [staffKeys.shopping(V, 'declined'), page([line({ id: ID(14), status: 'declined', mine: true, decline_reason: 'We have plenty' })])],
        [staffKeys.ingredients(V), INGREDIENTS],
      ],
    });
    try {
      expect(screen.getByText(t('staff.supplies.shopping.add.waitsForOk'))).toBeTruthy();
      expect(screen.getByText(t('staff.supplies.shopping.waiting.title', { count: 1 }))).toBeTruthy();
      expect(screen.getByTestId(`staff-shopping.cancel.${ID(13)}`)).toBeTruthy();
      expect(screen.getByText(t('staff.supplies.shopping.declined.title'))).toBeTruthy();
      // The chef assistant decides nothing.
      expect(screen.queryByTestId(`staff-shopping.approve.${ID(13)}`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('gives the head chef Approve and Decline on a waiting line, and Decline asks why', async () => {
    const screen = renderRoute(StaffShopping, {
      locale,
      staff: { role: 'head_chef' },
      queryData: [
        [staffKeys.shopping(V, 'open'), EMPTY_LIST],
        [staffKeys.shopping(V, 'pending'), page([line({ id: ID(15), status: 'pending' })], 1)],
        [staffKeys.ingredients(V), INGREDIENTS],
      ],
    });
    try {
      expect(screen.getByText(t('staff.supplies.shopping.approve.title', { count: 1 }))).toBeTruthy();
      expect(screen.getByTestId(`staff-shopping.approve.${ID(15)}`)).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-shopping.decline.${ID(15)}`));
      expect(screen.getByTestId(`staff-shopping.decline.${ID(15)}.reason`)).toBeTruthy();
      fireEvent.press(screen.getByTestId(`staff-shopping.decline.${ID(15)}.confirm`));
      await expectAlerted(t('staff.supplies.shopping.approve.errors.reason'));
    } finally {
      screen.unmount();
    }
  });

  it('lets the barista read the list and add nothing', () => {
    const screen = renderRoute(StaffShopping, {
      locale,
      staff: { role: 'barista' },
      queryData: [[staffKeys.shopping(V, 'open'), page([line({ id: ID(16) })])]],
    });
    try {
      expect(screen.getByTestId(`staff-shopping.item.${ID(16)}`)).toBeTruthy();
      expect(screen.queryByTestId('staff-shopping.add')).toBeNull();
      expect(screen.queryByTestId(`staff-shopping.cancel.${ID(16)}`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('prefills a ticked pack line in the base unit; the list opens the form from the +, and offers Delivered on a purchase not yet delivered', () => {
    const purchases: MyPurchases = {
      purchases: [
        {
          id: ID(40),
          bought_at: '2026-09-25T09:00:00Z',
          shop_name: 'Al-Rasheed market',
          total_iqd: 60000,
          status: 'to_receive',
          receipt_path: `${V}/receipts/x.jpg`,
          delivered_at: null,
          lines: [{ label: null, name_en: 'Flour', name_ar: 'طحين', qty: 2000, unit: 'g', price_iqd: 60000, status: 'to_receive' }],
        },
        {
          id: ID(41),
          bought_at: '2026-09-24T09:00:00Z',
          shop_name: null,
          total_iqd: 3000,
          status: 'done',
          receipt_path: null,
          delivered_at: '2026-09-24T10:00:00Z',
          lines: [],
        },
      ],
    };
    // Step 1 (shop and receipt): Next opens the items page with the ticked lines.
    resetPurchaseDraft();
    const shopStep = renderRoute(StaffPurchaseNew, {
      locale,
      params: { itemIds: ID(20) },
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.shopping(V, 'open'), page([PACK_FLOUR])],
        [staffKeys.ingredients(V), INGREDIENTS],
        [staffKeys.purchases(V), purchases],
      ],
    });
    try {
      fireEvent.press(shopStep.getByTestId('staff-purchase-new.next'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-purchase-items', params: { itemIds: ID(20) } },
      });
    } finally {
      shopStep.unmount();
    }
    // Step 2 (items): the pack line is prefilled in grams; a missing price holds the page, a filled one opens the review.
    const screen = renderRoute(StaffPurchaseItems, {
      locale,
      params: { itemIds: ID(20) },
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.shopping(V, 'open'), page([PACK_FLOUR])],
        [staffKeys.ingredients(V), INGREDIENTS],
        [staffKeys.purchases(V), purchases],
      ],
    });
    try {
      expect(screen.getByTestId('staff-purchase-items.line.0.qty').props.value).toBe('2000');
      expect(screen.getByTestId('staff-purchase-items.line.add')).toBeTruthy();
      expect(screen.getByTestId('staff-purchase-items.total')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-purchase-items.next'));
      expect(routerState.calls.some((c) => JSON.stringify(c.arg).includes('staff-purchase-review'))).toBe(false);
      // The pack's 2000 g is over the limit of 999: the page holds until it is changed.
      fireEvent.changeText(screen.getByTestId('staff-purchase-items.line.0.price'), '60000');
      fireEvent.press(screen.getByTestId('staff-purchase-items.next'));
      expect(routerState.calls.some((c) => JSON.stringify(c.arg).includes('staff-purchase-review'))).toBe(false);
      fireEvent.changeText(screen.getByTestId('staff-purchase-items.line.0.qty'), '500');
      fireEvent.press(screen.getByTestId('staff-purchase-items.next'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-purchase-review', params: { itemIds: ID(20) } },
      });
    } finally {
      screen.unmount();
    }
    // Step 3 (review): the typed price carries over, and Save is there.
    const review = renderRoute(StaffPurchaseReview, {
      locale,
      params: { itemIds: ID(20) },
      staff: { role: 'driver' },
      queryData: [
        [staffKeys.shopping(V, 'open'), page([PACK_FLOUR])],
        [staffKeys.ingredients(V), INGREDIENTS],
        [staffKeys.purchases(V), purchases],
      ],
    });
    try {
      expect(review.getByTestId('staff-purchase-review.save')).toBeTruthy();
      expect(within(review.getByTestId('staff-purchase-review.total')).getByText(/60,000|٦٠٬٠٠٠/)).toBeTruthy();
    } finally {
      review.unmount();
    }
    const list = renderRoute(StaffPurchase, {
      locale,
      staff: { role: 'driver' },
      queryData: [[staffKeys.purchases(V), purchases]],
    });
    const add = headerAdd(list);
    expect(add).not.toBeNull();
    act(() => add?.onPress());
    expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-purchase-new' });
    try {
      expect(list.getByTestId(`staff-purchase.delivered.${ID(40)}`)).toBeTruthy();
      expect(list.queryByTestId(`staff-purchase.delivered.${ID(41)}`)).toBeNull();
      // Details opens the purchase's own page.
      fireEvent.press(list.getByTestId(`staff-purchase.details.${ID(40)}`));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-purchase-detail', params: { id: ID(40) } },
      });
    } finally {
      list.unmount();
    }
    // The page shows the purchase's items, info and receipt, and Delivered while it waits.
    const detail = renderRoute(StaffPurchaseDetail, {
      locale,
      params: { id: ID(40) },
      staff: { role: 'driver' },
      queryData: [[staffKeys.purchases(V), purchases]],
    });
    try {
      expect(detail.getByTestId('staff-purchase-detail.summary')).toBeTruthy();
      expect(detail.getByText(t('staff.supplies.purchase.list.secItems'))).toBeTruthy();
      expect(detail.getByText(t('staff.supplies.purchase.list.secInfo'))).toBeTruthy();
      expect(detail.getByText(t('staff.supplies.purchase.list.secReceipt'))).toBeTruthy();
      expect(detail.getByTestId('staff-purchase-detail.delivered')).toBeTruthy();
    } finally {
      detail.unmount();
    }
    const done = renderRoute(StaffPurchaseDetail, {
      locale,
      params: { id: ID(41) },
      staff: { role: 'driver' },
      queryData: [[staffKeys.purchases(V), purchases]],
    });
    try {
      expect(done.queryByTestId('staff-purchase-detail.delivered')).toBeNull();
      expect(done.getByText(t('staff.supplies.purchase.list.noReceipt'))).toBeTruthy();
    } finally {
      done.unmount();
    }
  });

  it('goes from the shop to the items without asking for an item, and holds on the items until one is added', () => {
    resetPurchaseDraft();
    const queryData: [readonly unknown[], unknown][] = [
      [staffKeys.shopping(V, 'open'), EMPTY_LIST],
      [staffKeys.ingredients(V), INGREDIENTS],
      [staffKeys.purchases(V), NO_PURCHASES],
    ];
    const shopStep = renderRoute(StaffPurchaseNew, { locale, staff: { role: 'driver' }, queryData });
    try {
      // No item asked for yet: Next just opens the items page.
      fireEvent.press(shopStep.getByTestId('staff-purchase-new.next'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-purchase-items', params: { itemIds: '' } },
      });
    } finally {
      shopStep.unmount();
    }
    const screen = renderRoute(StaffPurchaseItems, { locale, staff: { role: 'driver' }, queryData });
    try {
      // The items open with one new item to fill in, and it cannot be removed while it is the only one.
      expect(screen.getByTestId('staff-purchase-items.line.0.label')).toBeTruthy();
      expect(screen.queryByTestId('staff-purchase-items.line.0.remove')).toBeNull();
      fireEvent.press(screen.getByTestId('staff-purchase-items.line.add'));
      expect(screen.getByTestId('staff-purchase-items.line.1.remove')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-purchase-items.line.1.remove'));
      // A price each: 6 × 2,000 is worked out and shown as what the line was paid.
      fireEvent.changeText(screen.getByTestId('staff-purchase-items.line.0.label'), 'Milk');
      fireEvent.changeText(screen.getByTestId('staff-purchase-items.line.0.qty'), '6');
      fireEvent.changeText(screen.getByTestId('staff-purchase-items.line.0.price'), '2000');
      expect(within(screen.getByTestId('staff-purchase-items.line.0.total')).getByText(/12,000|١٢٬٠٠٠/)).toBeTruthy();
      expect(within(screen.getByTestId('staff-purchase-items.total')).getByText(/12,000|١٢٬٠٠٠/)).toBeTruthy();
      fireEvent.changeText(screen.getByTestId('staff-purchase-items.line.0.label'), '');
      // The name is missing: Next stays on the items instead of opening the review.
      const before = routerState.calls.length;
      fireEvent.press(screen.getByTestId('staff-purchase-items.next'));
      expect(routerState.calls.length).toBe(before);
    } finally {
      screen.unmount();
    }
  });

  it('shows a manager the purchases to read, with no purchase form', () => {
    const screen = renderRoute(StaffPurchase, {
      locale,
      staff: { role: 'manager' },
      queryData: [[staffKeys.purchases(V), NO_PURCHASES]],
    });
    try {
      expect(screen.queryByTestId('staff-purchase-review.save')).toBeNull();
      expect(screen.getByText(t('staff.supplies.purchase.list.mgmtNote'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

describe.each(LOCALES)('the marketing pages in %s', (locale) => {
  const t = makeT(locale);

  it('shows marketing its campaigns’ reach in counts, with nothing in dinars', () => {
    const results: CampaignResults = {
      campaigns: [
        {
          campaign_id: ID(50),
          name_en: 'Autumn',
          name_ar: 'الخريف',
          channel: 'telegram',
          status: 'live',
          starts_at: '2026-09-20T21:00:00Z',
          ends_at: null,
          sends: 120,
          delivered: 118,
          failed: 2,
          last_sent_at: '2026-09-21T08:00:00Z',
          attributable: false,
          redemptions: null,
          suggested_by_me: true,
        },
      ],
    };
    const screen = renderRoute(StaffMarketing, {
      locale,
      staff: { role: 'marketing' },
      queryData: [
        [staffKeys.marketingNotes(V), { notes: [] }],
        [staffKeys.marketingRequests(V, 'open'), { ...NO_REQUESTS, open_count: 2 }],
        [staffKeys.campaignResults(V), results],
      ],
    });
    try {
      expect(
        within(screen.getByTestId('staff-marketing.requests')).getByText(
          t('staff.marketing.requestsRowOpen', { count: 2 }),
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-marketing.tab.results'));
      expect(screen.getByText(t('staff.marketing.results.sends'))).toBeTruthy();
      expect(screen.getByText(t('staff.marketing.results.noPromotion'))).toBeTruthy();
      expect(screen.getByText(t('staff.marketing.results.yours'))).toBeTruthy();
      expect(screen.queryByText(/IQD|د\.ع|دينار/)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('keeps the marketing page to marketing', () => {
    const screen = renderRoute(StaffMarketing, { locale, staff: { role: 'manager' } });
    try {
      expect(screen.queryByTestId('staff-marketing.tab.take')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('gives marketing the inbox to answer, with no form to ask itself', async () => {
    const screen = renderRoute(StaffMarketingRequests, {
      locale,
      params: { id: ID(30) },
      staff: { role: 'marketing' },
      queryData: [[staffKeys.marketingRequests(V, 'open'), { requests: [request({})], open_count: 1, total: 1 }]],
    });
    try {
      expect(headerAdd(screen)).toBeNull();
      // The named request opens on its answer.
      expect(screen.getByTestId('staff-marketing-requests.answer')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-marketing-requests.answer.done'));
      await expectAlerted(t('staff.marketing.requests.errors.answer'));
    } finally {
      screen.unmount();
    }
  });

  it('gives an asker a + that opens the ask form, and keeps the form off the list', () => {
    const screen = renderRoute(StaffMarketingRequests, {
      locale,
      staff: { role: 'manager' },
      queryData: [
        [staffKeys.myMarketingRequests(V), { requests: [] }],
        [staffKeys.marketingRequests(V, 'open'), NO_REQUESTS],
      ],
    });
    try {
      expect(screen.queryByTestId('staff-marketing-request-new.submit')).toBeNull();
      const add = headerAdd(screen);
      expect(add?.label).toBe(t('staff.marketing.requests.newTitle'));
      act(() => add?.onPress());
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-marketing-request-new' });
    } finally {
      screen.unmount();
    }
  });

  it('asks for a title and the details before sending a request', async () => {
    const screen = renderRoute(StaffMarketingRequestNew, { locale, staff: { role: 'owner' } });
    try {
      fireEvent.press(screen.getByTestId('staff-marketing-request-new.submit'));
      await expectAlerted(t('staff.marketing.requests.errors.title'));
      await expectAlerted(t('staff.marketing.requests.errors.body'));
    } finally {
      screen.unmount();
    }
  });

  it('keeps the ask form from marketing, which answers and never asks', () => {
    const screen = renderRoute(StaffMarketingRequestNew, { locale, staff: { role: 'marketing' } });
    try {
      expect(screen.queryByTestId('staff-marketing-request-new.submit')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('lets an asker withdraw an open request and read an answered one', () => {
    const screen = renderRoute(StaffMarketingRequests, {
      locale,
      staff: { role: 'owner' },
      queryData: [
        [staffKeys.marketingRequests(V, 'open'), NO_REQUESTS],
        [
          staffKeys.myMarketingRequests(V),
          {
            requests: [
              request({ id: ID(31) }),
              request({ id: ID(32), status: 'done', answer: 'Posted Friday', answered_by_name: 'Noor', answered_at: '2026-09-25T10:00:00Z' }),
            ],
          },
        ],
      ],
    });
    try {
      expect(screen.getByTestId(`staff-marketing-requests.withdraw.${ID(31)}`)).toBeTruthy();
      expect(screen.queryByTestId(`staff-marketing-requests.withdraw.${ID(32)}`)).toBeNull();
      expect(screen.getByText(t('work.marketingRequest.status.done'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('keeps everyone but the manager, the owner and marketing off the requests page (2026-09-28)', () => {
    for (const role of ['cashier', 'barista', 'waiter'] as const) {
      const screen = renderRoute(StaffMarketingRequests, { locale, staff: { role } });
      try {
        expect(screen.queryByTestId('staff-marketing-requests.list')).toBeNull();
      } finally {
        screen.unmount();
      }
    }
  });

  it('never lets a guest in', () => {
    for (const Component of [StaffShopping, StaffPurchase, StaffPurchaseNew, StaffPurchaseItems, StaffPurchaseReview, StaffPurchaseDetail, StaffMarketing, StaffMarketingRequests, StaffMarketingRequestNew]) {
      const screen = renderRoute(Component, { locale, session: 'in' });
      try {
        expect(screen.queryByTestId('staff-shopping.add')).toBeNull();
        expect(screen.queryByTestId('staff-purchase-review.save')).toBeNull();
        expect(screen.queryByTestId('staff-marketing.tab.take')).toBeNull();
        expect(screen.queryByTestId('staff-marketing-requests.list')).toBeNull();
        expect(screen.queryByTestId('staff-marketing-request-new.submit')).toBeNull();
      } finally {
        screen.unmount();
      }
    }
  });
});
