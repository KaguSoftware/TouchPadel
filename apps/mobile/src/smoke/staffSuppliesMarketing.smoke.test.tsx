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
import { fireEvent, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { staffKeys } from '../features/staff/keys';
import type { IngredientOptions, MyPurchases, ShoppingItem, ShoppingListPage } from '../features/staff/supplies/api';
import type { CampaignResults, MarketingRequest, MarketingRequestsPage } from '../features/staff/marketing/api';
import StaffShopping from '../../app/staff-shopping';
import StaffPurchase from '../../app/staff-purchase';
import StaffMarketing from '../../app/staff-marketing';
import StaffMarketingRequests from '../../app/staff-marketing-requests';

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
    labelKey: 'staff.marketing.requests.submit',
    options: {
      staff: { role: 'barista' },
      queryData: [[staffKeys.myMarketingRequests(V), { requests: [] }]],
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
        arg: { pathname: '/staff-purchase', params: { itemIds: ID(12) } },
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

  it('gives the head chef Approve and Decline on a waiting line, and Decline asks why', () => {
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
      expect(screen.getByText(t('staff.supplies.shopping.approve.errors.reason'))).toBeTruthy();
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

  it('prefills a ticked pack line in the base unit, and offers Delivered on a purchase not yet delivered', () => {
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
    const screen = renderRoute(StaffPurchase, {
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
      expect(screen.getByTestId('staff-purchase.line.0.qty').props.value).toBe('2000');
      expect(screen.getByTestId(`staff-purchase.delivered.${ID(40)}`)).toBeTruthy();
      expect(screen.getByTestId(`staff-purchase.receipt.${ID(40)}`)).toBeTruthy();
      expect(screen.queryByTestId(`staff-purchase.delivered.${ID(41)}`)).toBeNull();
      expect(screen.getByText(t('staff.supplies.purchase.list.noReceipt'))).toBeTruthy();
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
      expect(screen.queryByTestId('staff-purchase.save')).toBeNull();
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

  it('gives marketing the inbox to answer, with no form to ask itself', () => {
    const screen = renderRoute(StaffMarketingRequests, {
      locale,
      params: { id: ID(30) },
      staff: { role: 'marketing' },
      queryData: [[staffKeys.marketingRequests(V, 'open'), { requests: [request({})], open_count: 1, total: 1 }]],
    });
    try {
      expect(screen.queryByTestId('staff-marketing-requests.submit')).toBeNull();
      // The named request opens on its answer.
      expect(screen.getByTestId('staff-marketing-requests.answer')).toBeTruthy();
      fireEvent.press(screen.getByTestId('staff-marketing-requests.answer.done'));
      expect(screen.getByText(t('staff.marketing.requests.errors.answer'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lets an asker withdraw an open request and read an answered one', () => {
    const screen = renderRoute(StaffMarketingRequests, {
      locale,
      staff: { role: 'cashier' },
      queryData: [
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
      // A cashier does not read the venue's requests.
      expect(screen.queryByTestId('staff-marketing-requests.filter')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('never lets a guest in', () => {
    for (const Component of [StaffShopping, StaffPurchase, StaffMarketing, StaffMarketingRequests]) {
      const screen = renderRoute(Component, { locale, session: 'in' });
      try {
        expect(screen.queryByTestId('staff-shopping.add')).toBeNull();
        expect(screen.queryByTestId('staff-purchase.save')).toBeNull();
        expect(screen.queryByTestId('staff-marketing.tab.take')).toBeNull();
        expect(screen.queryByTestId('staff-marketing-requests.submit')).toBeNull();
      } finally {
        screen.unmount();
      }
    }
  });
});
