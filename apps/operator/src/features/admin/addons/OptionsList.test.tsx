import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as AppRpcModule from '../../../lib/appRpc';
import type * as AuthModule from '../../../lib/auth';
import type * as UseAddonsModule from './useAddons';
import type { AddonsData } from './useAddons';

// The page's option rows: name, what it costs, the switch, Edit. A manager's
// paid option never on sale has its switch off until the owner approves its
// price (#51, #53); everything else is changed in the wizard.

const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const who = vi.hoisted(() => ({ role: 'manager' }));

vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const mod = await importOriginal<typeof AppRpcModule>();
  return { ...mod, appRpc: rpc.appRpc };
});
vi.mock('../../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return {
    ...mod,
    useAuth: () => ({ staff: { role: who.role } }),
    usePermissions: () => ({ editMenu: true }),
  };
});
vi.mock('./useAddons', async (importOriginal) => {
  const mod = await importOriginal<typeof UseAddonsModule>();
  return { ...mod, useAddons: () => ({ refresh: vi.fn(async () => undefined) }) };
});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import { OptionsList } from './OptionsList';

const OAT = 'a0000000-0000-4000-8000-000000000001';
const SYRUP = 'a0000000-0000-4000-8000-000000000002';
const ICE = 'a0000000-0000-4000-8000-000000000003';
const group = { id: 'g1', name_en: 'Milk', name_ar: 'الحليب', min_select: 0, max_select: 1 };
const data: AddonsData = {
  groups: [group],
  modifiers: [
    {
      id: OAT,
      group_id: 'g1',
      name_en: 'Oat milk',
      name_ar: 'حليب الشوفان',
      price_delta_iqd: 1000,
      sort_order: 0,
      is_active: true,
      launched_at: '2026-01-01T00:00:00Z',
    },
    {
      id: SYRUP,
      group_id: 'g1',
      name_en: 'Vanilla syrup',
      name_ar: 'شراب الفانيلا',
      price_delta_iqd: 500,
      sort_order: 1,
      is_active: false,
      launched_at: null,
    },
    {
      id: ICE,
      group_id: 'g1',
      name_en: 'No ice',
      name_ar: 'بلا ثلج',
      price_delta_iqd: 0,
      sort_order: 2,
      is_active: false,
      launched_at: null,
    },
  ],
  links: [{ item_id: 'latte', group_id: 'g1' }],
  reveals: [],
  items: [],
  categories: [],
};

function renderList(onEdit = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <OptionsList group={group} data={data} onEdit={onEdit} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onEdit };
}

beforeEach(() => {
  rpc.appRpc.mockReset();
  rpc.appRpc.mockResolvedValue('ok');
  who.role = 'manager';
});

describe('OptionsList', () => {
  it('shows each option as its name and what it costs, with Edit, and no boxes', () => {
    renderList();
    expect(screen.getByText('Oat milk')).toBeTruthy();
    expect(screen.getByText('+1,000 IQD')).toBeTruthy();
    expect(screen.getByText('No extra charge')).toBeTruthy();
    expect(screen.queryByDisplayValue('Oat milk')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Edit:/ })).toHaveLength(3);
  });

  it('opens the wizard from an option’s Edit, and has no New option button', async () => {
    const user = userEvent.setup();
    const { onEdit } = renderList();
    await user.click(screen.getByRole('button', { name: 'Edit: Oat milk' }));
    expect(onEdit).toHaveBeenCalledWith(OAT);
    expect(screen.queryByRole('button', { name: 'New option' })).toBeNull();
  });

  it('holds a manager’s paid option never on sale off, and lets a free one go on', async () => {
    const user = userEvent.setup();
    renderList();
    expect(
      (screen.getByRole('switch', { name: 'Active: Vanilla syrup' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('switch', { name: 'Active: Oat milk' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.click(screen.getByRole('switch', { name: 'Active: No ice' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith(
        'upsert_modifier',
        expect.objectContaining({ p_id: ICE, p_is_active: true, p_price_delta_iqd: 0 }),
      ),
    );
  });

  it('switching a launched option off re-sends its stored price and names', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('switch', { name: 'Active: Oat milk' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith(
        'upsert_modifier',
        expect.objectContaining({
          p_id: OAT,
          p_is_active: false,
          p_price_delta_iqd: 1000,
          p_name_en: 'Oat milk',
        }),
      ),
    );
  });

  it('tells a manager prices go to the owner, and not the owner', () => {
    renderList();
    expect(screen.getByText(/go to the owner for approval/)).toBeTruthy();
  });
});
