import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as PromotionsApi from './promotionsApi';
import type * as AppRpcModule from '../../../lib/appRpc';
import type * as AuthModule from '../../../lib/auth';

// The editor's redesign: errors wait until a field was visited, Save says the
// one thing stopping it, the summary line follows the draft, the enabled
// switch explains itself, and code-only without a code is called out. Save
// still goes through upsert_promotion with the same arguments.

const api = vi.hoisted(() => ({ fetchPromotion: vi.fn() }));
const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const router = vi.hoisted(() => ({ navigate: vi.fn(), params: { id: 'new' } as { id: string } }));
const perms = vi.hoisted(() => ({ editPromotions: true, role: 'owner' }));

vi.mock('./promotionsApi', async (importOriginal) => {
  const mod = await importOriginal<typeof PromotionsApi>();
  return { ...mod, fetchPromotion: api.fetchPromotion };
});
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const mod = await importOriginal<typeof AppRpcModule>();
  return { ...mod, appRpc: rpc.appRpc };
});
vi.mock('../../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return {
    ...mod,
    useAuth: () => ({ staff: { role: perms.role } }),
    usePermissions: () => ({ editPromotions: perms.editPromotions }),
  };
});
vi.mock('../../../lib/queries', () => ({ QK: { courts: ['courts'] }, fetchActiveCourts: async () => [] }));
vi.mock('../menu/useAdminMenu', () => ({ useAdminMenu: () => ({ data: { categories: [], items: [] } }) }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useParams: () => router.params,
  useBlocker: () => undefined,
}));

import { PromotionEditorScreen } from './PromotionEditor';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <PromotionEditorScreen />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetchPromotion.mockReset();
  rpc.appRpc.mockReset();
  router.navigate.mockReset();
  router.params = { id: 'new' };
  perms.editPromotions = true;
  perms.role = 'owner';
});

describe('PromotionEditorScreen', () => {
  it('a new promotion opens quiet: no errors, and Save asks for nothing yet', () => {
    renderScreen();
    expect(screen.queryByText('Enter both the English and the Arabic name.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/to save\.$/)).toBeNull();
    // Discard is simply disabled: no reason text of its own.
    expect((screen.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the name error only after the manager leaves the name fields', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText('English'), 'Happy hour');
    expect(screen.queryByText('Enter both the English and the Arabic name.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Fri' }));
    expect(screen.getByText('Enter both the English and the Arabic name.')).toBeTruthy();
    await user.type(screen.getByLabelText('Arabic'), 'ساعة السعادة');
    expect(screen.queryByText('Enter both the English and the Arabic name.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps a one-line summary of the draft, and states the rules once without a banner', async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByText('10% off everything from the cafe · Any day, any time')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Fri' }));
    await user.click(screen.getByRole('button', { name: 'Sat' }));
    expect(screen.getByText('10% off everything from the cafe · Fri, Sat')).toBeTruthy();
    expect(screen.getAllByText(/only the one that takes the most off applies/).length).toBe(1);
    expect(screen.getByText(/Off means it never applies/)).toBeTruthy();
    expect(screen.queryByText(/Every promotion, active and inactive/)).toBeNull();
  });

  it('calls out a code-only promotion that has no code and is not in the app', async () => {
    const user = userEvent.setup();
    renderScreen();
    const never = 'With no code, and not listed in the app, this promotion can never apply.';
    expect(screen.queryByText(never)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Only with a code' }));
    expect(screen.getByText(never)).toBeTruthy();
    expect(screen.getByTitle('Save the promotion first, then generate a code.')).toBeTruthy();
    // 0410: listed, members can pick it in the app, so "never applies" is no longer true.
    await user.click(screen.getByRole('switch', { name: 'List it as a deal in the app' }));
    expect(screen.queryByText(never)).toBeNull();
    expect(screen.getByText('It has no code yet. Until it does, members can still pick it in the app.')).toBeTruthy();
  });

  it('saves through upsert_promotion with the draft', async () => {
    const user = userEvent.setup();
    rpc.appRpc.mockResolvedValue('new-id');
    renderScreen();
    await user.type(screen.getByLabelText('English'), 'Happy hour');
    await user.type(screen.getByLabelText('Arabic'), 'ساعة السعادة');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith('upsert_promotion', expect.objectContaining({ p_id: null, p_name_en: 'Happy hour', p_name_ar: 'ساعة السعادة', p_auto: true })),
    );
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
  });

  // 0410: a promotion listed as a deal in the guests' app.
  describe("in the guests' app (0410)", () => {
    const row = {
      id: 'p1', name_en: 'Happy hour', name_ar: 'ساعة السعادة', type: 'percent', value: 20,
      starts_at: null, ends_at: null, weekdays: null, hour_from: null, hour_to: null, scope: null, limits: null,
      auto: true, public_code: null, code_single_use: false, enabled: true,
      in_app: false, app_blurb_en: null, app_blurb_ar: null,
    };
    const calls = () => rpc.appRpc.mock.calls.map((c) => c[0]);

    it('"In the app only" is not automatic, has no code and is listed; saving lists it after the promotion is saved', async () => {
      const user = userEvent.setup();
      rpc.appRpc.mockResolvedValue('new-id');
      renderScreen();
      await user.type(screen.getByLabelText('English'), 'Member latte');
      await user.type(screen.getByLabelText('Arabic'), 'لاتيه الأعضاء');
      await user.click(screen.getByRole('button', { name: 'In the app only' }));
      expect(screen.getByText(/Members pick it in the app, then show their member card/)).toBeTruthy();
      // No code box, no "never applies", and the listing is on and held on.
      expect(screen.queryByText('No code yet.')).toBeNull();
      expect(screen.queryByText(/can never apply/)).toBeNull();
      const listing = screen.getByRole('switch', { name: 'List it as a deal in the app' });
      expect(listing.getAttribute('aria-checked')).toBe('true');
      expect((listing as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/Any day, any time · In the app only$/)).toBeTruthy();
      await user.type(screen.getByLabelText('Line guests read (English)'), 'A latte on us');
      expect(screen.getByText('13 / 160')).toBeTruthy();
      // One language only: Save says so and nothing is sent.
      expect(screen.getByTitle('Finish the line for guests in both languages to save.')).toBeTruthy();
      await user.type(screen.getByLabelText('Line guests read (Arabic)'), 'لاتيه على حسابنا');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls()).toEqual(['upsert_promotion', 'set_promotion_app']));
      expect(rpc.appRpc.mock.calls[0]![1]).toMatchObject({ p_id: null, p_auto: false, p_public_code: '', p_code_single_use: false });
      expect(rpc.appRpc.mock.calls[1]![1]).toEqual({ p_id: 'new-id', p_in_app: true, p_blurb_en: 'A latte on us', p_blurb_ar: 'لاتيه على حسابنا' });
    });

    it('saves only the listing when only the listing changed', async () => {
      const user = userEvent.setup();
      router.params = { id: 'p1' };
      api.fetchPromotion.mockResolvedValue(row);
      rpc.appRpc.mockResolvedValue({ id: 'p1', in_app: true, app_blurb_en: null, app_blurb_ar: null });
      renderScreen();
      await user.click(await screen.findByRole('switch', { name: 'List it as a deal in the app' }));
      expect(screen.getByText(/Any day, any time · In the app$/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls()).toEqual(['set_promotion_app']));
      expect(rpc.appRpc.mock.calls[0]![1]).toEqual({ p_id: 'p1', p_in_app: true, p_blurb_en: null, p_blurb_ar: null });
    });

    it('says the promotion was saved when only its listing failed, and Save then retries the listing alone', async () => {
      const user = userEvent.setup();
      router.params = { id: 'p1' };
      api.fetchPromotion.mockResolvedValue(row);
      rpc.appRpc.mockImplementation(async (fn: string) => {
        if (fn === 'set_promotion_app') throw new Error('boom');
        return 'p1';
      });
      renderScreen();
      await user.click(await screen.findByRole('button', { name: 'Fri' }));
      await user.click(screen.getByRole('switch', { name: 'List it as a deal in the app' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('The promotion was saved, but its listing in the app was not. Press Save to try again.')).toBeTruthy();
      expect(calls()).toEqual(['upsert_promotion', 'set_promotion_app']);
      // The listing is still an unsaved change; the promotion itself is not written twice.
      expect(screen.getByText('Unsaved changes')).toBeTruthy();
      rpc.appRpc.mockResolvedValue({ id: 'p1' });
      rpc.appRpc.mockImplementation(async () => ({ id: 'p1' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls()).toEqual(['upsert_promotion', 'set_promotion_app', 'set_promotion_app']));
      await waitFor(() => expect(screen.queryByTestId('promotion-app-failed')).toBeNull());
    });

    it('a promotion whose code works once cannot be listed, and the page says why', async () => {
      router.params = { id: 'p1' };
      api.fetchPromotion.mockResolvedValue({ ...row, auto: false, public_code: 'ONCE1', code_single_use: true });
      renderScreen();
      const listing = await screen.findByRole('switch', { name: 'List it as a deal in the app' });
      expect((listing as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/A code that works once is one voucher for one bill/)).toBeTruthy();
    });

    it('choosing "In the app only" on a promotion with a code says the code stops working, and clears it on save', async () => {
      const user = userEvent.setup();
      router.params = { id: 'p1' };
      api.fetchPromotion.mockResolvedValue({ ...row, auto: false, public_code: 'SUMMER5' });
      rpc.appRpc.mockResolvedValue('p1');
      renderScreen();
      await user.click(await screen.findByRole('button', { name: 'In the app only' }));
      expect(screen.getByText('The code SUMMER5 stops working when you save.')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls()).toEqual(['upsert_promotion', 'set_promotion_app']));
      expect(rpc.appRpc.mock.calls[0]![1]).toMatchObject({ p_id: 'p1', p_auto: false, p_public_code: '' });
    });

    it('a server without the listing columns offers neither the panel nor the third option', async () => {
      router.params = { id: 'p1' };
      const { in_app: _a, app_blurb_en: _b, app_blurb_ar: _c, ...old } = row;
      api.fetchPromotion.mockResolvedValue(old);
      renderScreen();
      await screen.findByRole('button', { name: 'Only with a code' });
      expect(screen.queryByRole('button', { name: 'In the app only' })).toBeNull();
      expect(screen.queryByTestId('promotion-app')).toBeNull();
    });

    it('a manager reads the listing and cannot change it', async () => {
      perms.role = 'manager';
      perms.editPromotions = false;
      router.params = { id: 'p1' };
      api.fetchPromotion.mockResolvedValue({ ...row, in_app: true, app_blurb_en: 'A latte on us', app_blurb_ar: 'لاتيه على حسابنا' });
      renderScreen();
      expect(await screen.findByText('Listed in the guests’ app')).toBeTruthy();
      expect(screen.getByText('A latte on us')).toBeTruthy();
      expect(screen.getByText('Only the owner lists a promotion in the app.')).toBeTruthy();
      expect(screen.queryByRole('switch', { name: 'List it as a deal in the app' })).toBeNull();
    });
  });

  describe('as a manager (#57)', () => {
    const offRow = {
      id: 'p1', name_en: 'Happy hour', name_ar: 'ساعة السعادة', type: 'percent', value: 20,
      starts_at: null, ends_at: null, weekdays: [5, 6], hour_from: '16:00:00', hour_to: '19:00:00', scope: null, limits: null,
      auto: false, public_code: 'HAPPY20', code_single_use: false, enabled: false,
    };
    beforeEach(() => {
      perms.role = 'manager';
      perms.editPromotions = false;
    });

    it('reads a promotion and proposes a change or a switch-on instead of saving', async () => {
      const user = userEvent.setup();
      router.params = { id: 'p1' };
      api.fetchPromotion.mockResolvedValue(offRow);
      renderScreen();
      await user.click(await screen.findByRole('button', { name: 'Change this promotion' }));
      expect(router.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'promotion_edit', promotion: 'p1' } });
      await user.click(screen.getByRole('button', { name: 'Switch on' }));
      expect(router.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'promotion_enable', promotion: 'p1' } });
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      // The code is the owner's to draw (generate_promo_code refuses a manager).
      expect(screen.getByText('HAPPY20')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Generate code' })).toBeNull();
      expect(screen.queryByRole('note')).toBeNull();
      expect(screen.getByText(/Only the owner edits a promotion directly/)).toBeTruthy();
      expect((screen.getByLabelText('English') as HTMLInputElement).disabled).toBe(true);
    });

    it('a new one is a proposal', async () => {
      const user = userEvent.setup();
      renderScreen();
      expect(screen.getByText(/starts as a proposal in Protocols/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Propose a promotion' }));
      expect(router.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'promotion' } });
      expect(rpc.appRpc).not.toHaveBeenCalled();
    });
  });
});
