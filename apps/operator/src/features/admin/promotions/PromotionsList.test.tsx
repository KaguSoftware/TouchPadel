import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as PromotionsApi from './promotionsApi';
import type * as AppRpcModule from '../../../lib/appRpc';

// Four states for the list (loading / ready / empty / error), the two rules
// the spec singles out (enable/disable through the switch, no delete control
// anywhere), and the redesign: one status cell, plain "when" and "applies to"
// text, live first, and a filter with counts kept in the URL.

const api = vi.hoisted(() => ({ fetchPromotions: vi.fn() }));
const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as Record<string, unknown> }));
const perms = vi.hoisted(() => ({ editPromotions: true }));

vi.mock('./promotionsApi', async (importOriginal) => {
  const mod = await importOriginal<typeof PromotionsApi>();
  return { ...mod, fetchPromotions: api.fetchPromotions };
});
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const mod = await importOriginal<typeof AppRpcModule>();
  return { ...mod, appRpc: rpc.appRpc };
});
vi.mock('../../../lib/auth', () => ({
  usePermissions: () => ({ editPromotions: perms.editPromotions }),
  requiredRoleFor: () => 'manager',
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate, useSearch: () => nav.search }));

import { PromotionsListScreen } from './PromotionsList';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <PromotionsListScreen />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const rows = [
  {
    id: 'p1', name_en: 'Happy hour', name_ar: 'ساعة السعادة', type: 'percent', value: 20,
    starts_at: null, ends_at: null, weekdays: [5, 6], hour_from: '16:00:00', hour_to: '19:00:00', scope: null, limits: null,
    auto: true, public_code: null, code_single_use: false, enabled: true,
  },
  {
    id: 'p2', name_en: 'Old promo', name_ar: 'عرض قديم', type: 'amount', value: 5000,
    starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-02-01T00:00:00Z', weekdays: [], hour_from: null, hour_to: null,
    scope: { itemIds: ['i1', 'i2'] }, limits: null, auto: false, public_code: 'OLD5', code_single_use: true, enabled: false,
  },
  {
    id: 'p0', name_en: 'Aardvark', name_ar: 'أ', type: 'percent', value: 5,
    starts_at: null, ends_at: null, weekdays: [], hour_from: null, hour_to: null, scope: null, limits: null,
    auto: false, public_code: null, code_single_use: false, enabled: false,
  },
];

beforeEach(() => {
  api.fetchPromotions.mockReset();
  rpc.appRpc.mockReset();
  nav.navigate.mockReset();
  nav.search = {};
  perms.editPromotions = true;
});

describe('PromotionsListScreen', () => {
  it('loading: header and a skeleton, no table yet', () => {
    api.fetchPromotions.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Promotions' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('ready: lists active and inactive promotions in plain words, with no delete', async () => {
    api.fetchPromotions.mockResolvedValue(rows);
    renderScreen();
    expect(await screen.findByText('Happy hour')).toBeTruthy();
    expect(screen.getByText('Old promo')).toBeTruthy();
    // One status cell: the word beside the switch, with no separate badge column.
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Discount', 'When', 'Applies to', 'Status', '']);
    expect(within(table).getByText('Live')).toBeTruthy();
    expect(within(table).getByText(/^Ended /)).toBeTruthy();
    expect(within(table).getByText('Off')).toBeTruthy();
    // When: weekdays and hours, not "No end date".
    expect(screen.getByText('Fri, Sat · 16:00–19:00')).toBeTruthy();
    // Applies to: how a bill gets it, and what it covers.
    expect(screen.getByText('Code OLD5 · single use')).toBeTruthy();
    expect(screen.getByText('Items: 2')).toBeTruthy();
    expect(screen.queryByText('No code needed')).toBeNull();
    expect(screen.getByText('Needs a code, none yet')).toBeTruthy();
    expect(screen.queryByText('What it applies to')).toBeNull();
    // The rules are one lead, not a lead + a count + a banner.
    expect(screen.getByText(/one promotion at most/)).toBeTruthy();
    expect(screen.queryByText(/of 3$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
  });

  it('puts live promotions first, then off, then ended', async () => {
    api.fetchPromotions.mockResolvedValue(rows);
    renderScreen();
    await screen.findByText('Happy hour');
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names).toEqual(['Happy hour', 'Aardvark', 'Old promo']);
  });

  it('filters by status with a count on each choice, kept in the URL', async () => {
    const user = userEvent.setup();
    api.fetchPromotions.mockResolvedValue(rows);
    nav.search = { show: 'disabled' };
    renderScreen();
    expect(await screen.findByText('Aardvark')).toBeTruthy();
    expect(screen.queryByText('Happy hour')).toBeNull();
    const filter = screen.getByRole('group', { name: 'Show' });
    expect(within(filter).getByRole('button', { name: /^All\s*3$/ })).toBeTruthy();
    expect(within(filter).getByRole('button', { name: /^Off\s*1$/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(filter).getByRole('button', { name: /^Live\s*1$/ }));
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/admin/promotions', search: { show: 'live' }, replace: true });
  });

  it('searches by name or code and shows the result count only then', async () => {
    const user = userEvent.setup();
    api.fetchPromotions.mockResolvedValue(rows);
    renderScreen();
    await screen.findByText('Happy hour');
    await user.type(screen.getByRole('searchbox'), 'old5');
    expect(screen.queryByText('Happy hour')).toBeNull();
    expect(screen.getByText('Old promo')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'nothing like this');
    expect(screen.getByText('No promotion matches.')).toBeTruthy();
  });

  it('opens the editor from a row', async () => {
    const user = userEvent.setup();
    api.fetchPromotions.mockResolvedValue(rows);
    renderScreen();
    await user.click(await screen.findByText('Old promo'));
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/admin/promotions/$id', params: { id: 'p2' } });
  });

  it('empty: teaches the next action', async () => {
    api.fetchPromotions.mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('No promotions yet.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New promotion' }).length).toBeGreaterThan(0);
  });

  it('error: shows the retry affordance', async () => {
    api.fetchPromotions.mockRejectedValue(new Error('boom'));
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('toggles enabled through set_promotion_enabled', async () => {
    const user = userEvent.setup();
    api.fetchPromotions.mockResolvedValue(rows);
    rpc.appRpc.mockResolvedValue(null);
    renderScreen();
    await screen.findByText('Happy hour');
    await user.click(screen.getByRole('switch', { name: 'On or off: Happy hour' }));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('set_promotion_enabled', { p_id: 'p1', p_enabled: false }));
    // The row click (navigation) must not fire from the switch.
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('keeps the controls visible but refused without editPromotions', async () => {
    perms.editPromotions = false;
    api.fetchPromotions.mockResolvedValue(rows);
    renderScreen();
    await screen.findByText('Happy hour');
    expect(screen.getByRole('note')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'On or off: Happy hour' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
