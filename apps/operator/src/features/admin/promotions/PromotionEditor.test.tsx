import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as PromotionsApi from './promotionsApi';
import type * as AppRpcModule from '../../../lib/appRpc';

// The editor's redesign: errors wait until a field was visited, Save says the
// one thing stopping it, the summary line follows the draft, the enabled
// switch explains itself, and code-only without a code is called out. Save
// still goes through upsert_promotion with the same arguments.

const api = vi.hoisted(() => ({ fetchPromotion: vi.fn() }));
const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const router = vi.hoisted(() => ({ navigate: vi.fn(), params: { id: 'new' } as { id: string } }));

vi.mock('./promotionsApi', async (importOriginal) => {
  const mod = await importOriginal<typeof PromotionsApi>();
  return { ...mod, fetchPromotion: api.fetchPromotion };
});
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const mod = await importOriginal<typeof AppRpcModule>();
  return { ...mod, appRpc: rpc.appRpc };
});
vi.mock('../../../lib/auth', () => ({
  usePermissions: () => ({ editPromotions: true }),
  requiredRoleFor: () => 'manager',
}));
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
});

describe('PromotionEditorScreen', () => {
  it('a new promotion opens without errors, and Save says what it needs', () => {
    renderScreen();
    expect(screen.queryByText('Enter both the English and the Arabic name.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Add both names to save.')).toBeTruthy();
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
    expect(screen.queryByText('Add both names to save.')).toBeNull();
  });

  it('keeps a one-line summary of the draft, and states the rules once without a banner', async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByText('10% off everything from the cafe · Any day, any time · No code needed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Fri' }));
    await user.click(screen.getByRole('button', { name: 'Sat' }));
    expect(screen.getByText('10% off everything from the cafe · Fri, Sat · No code needed')).toBeTruthy();
    expect(screen.getAllByText(/only the one that takes the most off applies/).length).toBe(1);
    expect(screen.getByText(/Off means it never applies/)).toBeTruthy();
    expect(screen.queryByText(/Every promotion, active and inactive/)).toBeNull();
  });

  it('calls out a code-only promotion that has no code', async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByText('Without a code this promotion can never apply.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Only with a code' }));
    expect(screen.getByText('Without a code this promotion can never apply.')).toBeTruthy();
    expect(screen.getByText('Save the promotion first, then generate a code.')).toBeTruthy();
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
});
