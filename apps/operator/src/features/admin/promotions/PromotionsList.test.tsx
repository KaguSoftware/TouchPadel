import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as PromotionsApi from './promotionsApi';
import type * as AppRpcModule from '../../../lib/appRpc';

// Four states for the list (loading / ready / empty / error) plus the two
// rules the spec singles out: enable/disable through the switch, and no
// delete control anywhere.

const api = vi.hoisted(() => ({ fetchPromotions: vi.fn() }));
const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
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
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));

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
    starts_at: null, ends_at: null, weekdays: [], hour_from: null, hour_to: null, scope: null, limits: null,
    auto: true, public_code: null, code_single_use: false, enabled: true,
  },
  {
    id: 'p2', name_en: 'Old promo', name_ar: 'عرض قديم', type: 'amount', value: 5000,
    starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-02-01T00:00:00Z', weekdays: [], hour_from: null, hour_to: null,
    scope: null, limits: null, auto: false, public_code: 'OLD5', code_single_use: true, enabled: false,
  },
];

beforeEach(() => {
  api.fetchPromotions.mockReset();
  rpc.appRpc.mockReset();
  nav.navigate.mockReset();
  perms.editPromotions = true;
});

describe('PromotionsListScreen', () => {
  it('loading: header and a skeleton, no table yet', () => {
    api.fetchPromotions.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Promotions' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('ready: lists active and inactive promotions with a lifecycle label and no delete', async () => {
    api.fetchPromotions.mockResolvedValue(rows);
    renderScreen();
    expect(await screen.findByText('Happy hour')).toBeTruthy();
    expect(screen.getByText('Old promo')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('Code OLD5 · single use')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
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
    await user.click(screen.getByRole('switch', { name: 'Enabled — Happy hour' }));
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
    expect((screen.getByRole('switch', { name: 'Enabled — Happy hour' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
