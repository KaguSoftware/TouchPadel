/**
 * A deal's own QR (0445, Majed 2026-11-15: "its own QR code with a 15-minute countdown, just like
 * rewards"), `app/deal-voucher.tsx`. See `src/smoke/auth.smoke.test.tsx` for what a case asserts
 * and `src/test/smokeCase.tsx` for how.
 *
 * The route case seeds the parsed codes and deals under their `loyaltyKeys`, so the first render
 * draws the live code. After it, the states a first render cannot show under the one primary: used
 * at the counter, expired with a new code (and the deal's picture), a deal no longer open, a newer
 * live code, and Cancel through the phone's own alert. None of those names a `route:` (each route
 * is cased by exactly one suite; smokeCoverage.test.ts).
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { loyaltyKeys } from '../features/loyalty/keys';
import { parseMyDeals } from '../features/loyalty/deals';
import { parseMyDealVouchers } from '../features/loyalty/dealVouchers';
import { supabase } from '../lib/supabase';
import DealVoucherScreen from '../../app/deal-voucher';

type Seeds = [readonly unknown[], unknown][];

const DEAL = {
  id: 'd-open',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  blurb_en: null,
  blurb_ar: null,
  type: 'percent',
  value: 20,
  ends_at: null,
  weekdays: [],
  hour_from: null,
  hour_to: null,
  live_now: true,
  min_spend_iqd: null,
  per_customer: null,
  used: 0,
  tier: null,
  state: 'open',
  venue_id: null,
  on: { items: [], categories: [], courts: false },
};

const deals = (state = 'open') => parseMyDeals({ picked_id: null, picked_until: null, deals: [{ ...DEAL, state }] });

/** One code for the deal, `minutesLeft` on the server's clock. */
const code = (over: Record<string, unknown> = {}, minutesLeft = 10) => ({
  id: 'dv-1',
  code: 'TPD-8F3K2QXM9ABC',
  promotion_id: 'd-open',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  type: 'percent',
  value: 20,
  status: 'active',
  created_at: new Date(Date.now() - (15 - minutesLeft) * 60_000).toISOString(),
  expires_at: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
  ended_at: null,
  ...over,
});
const codes = (...rows: Record<string, unknown>[]) =>
  parseMyDealVouchers({ now: new Date().toISOString(), vouchers: rows });

const seeds = (list = codes(code()), dealList: ReturnType<typeof parseMyDeals> | null = deals()): Seeds => [
  [loyaltyKeys.dealVouchers, list],
  ...(dealList ? ([[loyaltyKeys.deals, dealList]] as Seeds) : []),
];

/**
 * The app schema's rpc for a case that writes, answering only the call it names: every other read
 * (the poll) fails, as with no stub, and keeps what was seeded. Undone after each test.
 */
function stubAppRpc(name: string, data: unknown) {
  const rpc = jest.fn((called: string, _args?: unknown) =>
    Promise.resolve(called === name ? { data, error: null } : { data: null, error: { message: 'offline' } }),
  );
  Object.assign(supabase, { schema: () => ({ rpc }) });
  return rpc;
}
afterEach(() => {
  delete (supabase as unknown as { schema?: unknown }).schema;
  jest.restoreAllMocks();
});

const CASES: SmokeCase[] = [
  {
    route: 'deal-voucher',
    Component: DealVoucherScreen,
    // The QR is a mark with no text of its own: the line under it says what it is for.
    nearbyKey: 'loyalty.guest.dealVoucher.show',
    options: { session: 'in', params: { id: 'dv-1' }, queryData: seeds() },
  },
];

runSmokeCases('a deal code', CASES);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('deal code states in %s', (locale) => {
  const t = makeT(locale);
  const render = (list = codes(code()), dealList: ReturnType<typeof parseMyDeals> | null = deals()) =>
    renderRoute(DealVoucherScreen, { locale, session: 'in', params: { id: 'dv-1' }, queryData: seeds(list, dealList) });

  it('the live code: name, value in words, QR, grouped code, time and Cancel; no points anywhere', () => {
    const screen = render();
    try {
      expect(within(screen.getByTestId('deal-voucher.name')).getByText(locale === 'ar' ? 'ساعة السعادة' : 'Happy hour')).toBeTruthy();
      expect(String(screen.getByTestId('deal-voucher.value').props.children)).toContain('20');
      expect(screen.getByTestId('deal-voucher.qr')).toBeTruthy();
      expect(within(screen.getByTestId('deal-voucher.code')).getByText('TPD-8F3K-2QXM-9ABC')).toBeTruthy();
      expect(String(screen.getByTestId('deal-voucher.time').props.children)).toMatch(/^(9:5\d|10:00)$/);
      const cancel = screen.getByTestId('deal-voucher.cancel');
      expect(within(cancel).getByText(t('loyalty.guest.dealVoucher.cancel'))).toBeTruthy();
      expect(screen.queryByText(/points|نقطة|نقاط/)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('used at the counter says so, with no QR and no new code', () => {
    const screen = render(codes(code({ status: 'used', ended_at: new Date().toISOString() })));
    try {
      expect(within(screen.getByTestId('deal-voucher.collected')).getByText(t('loyalty.guest.dealVoucher.collectedTitle'))).toBeTruthy();
      expect(screen.queryByTestId('deal-voucher.qr')).toBeNull();
      expect(screen.queryByTestId('deal-voucher.again')).toBeNull();
      expect(within(screen.getByTestId('deal-voucher.done')).getByText(t('loyalty.guest.dealVoucher.done'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a code past its time reads as expired and offers a new one, which replaces the screen', async () => {
    const fresh = code({ id: 'dv-2', code: 'TPD-0000000000AB' }, 15);
    const rpc = stubAppRpc('redeem_deal', { now: new Date().toISOString(), voucher: fresh });
    const screen = render(codes(code({}, -1)));
    try {
      expect(within(screen.getByTestId('deal-voucher.expired')).getByText(t('loyalty.guest.dealVoucher.expiredTitle'))).toBeTruthy();
      const again = screen.getByTestId('deal-voucher.again');
      expect(within(again).getByText(t('loyalty.guest.dealVoucher.again'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(again);
      });
      await waitFor(() =>
        expect(routerState.calls).toContainEqual({
          method: 'replace',
          arg: { pathname: '/deal-voucher', params: { id: 'dv-2' } },
        }),
      );
      expect(rpc).toHaveBeenCalledWith('redeem_deal', { p_promotion_id: 'd-open' });
    } finally {
      screen.unmount();
    }
  });

  it('a deal no longer open (its uses spent) offers no new code', () => {
    const screen = render(codes(code({ status: 'cancelled', ended_at: new Date().toISOString() })), deals('used'));
    try {
      expect(screen.getByTestId('deal-voucher.cancelled')).toBeTruthy();
      expect(screen.queryByTestId('deal-voucher.again')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('a cancelled code with a newer live one for the deal shows that one instead of redeeming again', () => {
    const screen = render(
      codes(code({ status: 'cancelled', ended_at: new Date().toISOString() }), code({ id: 'dv-2', code: 'TPD-0000000000AB' })),
    );
    try {
      expect(screen.getByText(t('loyalty.guest.dealVoucher.newerBody'))).toBeTruthy();
      expect(screen.queryByTestId('deal-voucher.again')).toBeNull();
      fireEvent.press(screen.getByTestId('deal-voucher.current'));
      expect(routerState.calls).toContainEqual({
        method: 'replace',
        arg: { pathname: '/deal-voucher', params: { id: 'dv-2' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('Cancel asks with the phone’s own alert, then the screen turns to cancelled', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const rpc = stubAppRpc('cancel_deal_voucher', {
      now: new Date().toISOString(),
      vouchers: [code({ status: 'cancelled', ended_at: new Date().toISOString() })],
    });
    const screen = render();
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('deal-voucher.cancel'));
      });
      expect(alert).toHaveBeenCalled();
      const [title, , buttons] = alert.mock.calls[0] as [string, string, { text: string; onPress?: () => void }[]];
      expect(title).toBe(t('loyalty.guest.dealVoucher.cancelTitle'));
      const confirm = buttons.find((b) => b.text === t('loyalty.guest.dealVoucher.cancelConfirm'));
      await act(async () => {
        confirm?.onPress?.();
      });
      expect(rpc).toHaveBeenCalledWith('cancel_deal_voucher', { p_voucher_id: 'dv-1' });
      await waitFor(() => expect(screen.getByTestId('deal-voucher.cancelled')).toBeTruthy());
    } finally {
      screen.unmount();
    }
  });
});
