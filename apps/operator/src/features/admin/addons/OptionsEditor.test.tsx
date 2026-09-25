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

// A manager's option prices go to the owner (build-contracts-2026-09-23 §5.5,
// #51, #53): an option on sale keeps its price and offers "Change the price",
// a new paid option is saved hidden and offers "Put on sale", a free one works
// as before. The owner's screen is unchanged.

const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
const who = vi.hoisted(() => ({ role: 'manager' }));

vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const mod = await importOriginal<typeof AppRpcModule>();
  return { ...mod, appRpc: rpc.appRpc };
});
vi.mock('../../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return { ...mod, useAuth: () => ({ staff: { role: who.role } }) };
});
vi.mock('./useAddons', async (importOriginal) => {
  const mod = await importOriginal<typeof UseAddonsModule>();
  return { ...mod, useAddons: () => ({ refresh: vi.fn(async () => undefined) }) };
});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));

import { OptionsEditor } from './OptionsEditor';

const OAT = 'a0000000-0000-4000-8000-000000000001';
const SYRUP = 'a0000000-0000-4000-8000-000000000002';
const ICE = 'a0000000-0000-4000-8000-000000000003';
const group = { id: 'g1', name_en: 'Milk', name_ar: 'الحليب', min_select: 0, max_select: 1 };
const data: AddonsData = {
  groups: [group],
  modifiers: [
    { id: OAT, group_id: 'g1', name_en: 'Oat milk', name_ar: 'حليب الشوفان', price_delta_iqd: 1000, sort_order: 0, is_active: true, launched_at: '2026-01-01T00:00:00Z' },
    { id: SYRUP, group_id: 'g1', name_en: 'Vanilla syrup', name_ar: 'شراب الفانيلا', price_delta_iqd: 500, sort_order: 1, is_active: false, launched_at: null },
    { id: ICE, group_id: 'g1', name_en: 'No ice', name_ar: 'بلا ثلج', price_delta_iqd: 0, sort_order: 2, is_active: false, launched_at: null },
  ],
  links: [{ item_id: 'latte', group_id: 'g1' }],
  reveals: [],
  items: [],
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <OptionsEditor group={group} data={data} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function addOption(user: ReturnType<typeof userEvent.setup>, delta: string) {
  await user.click(screen.getByRole('button', { name: 'New option' }));
  // The new row comes last, after each existing option's own name fields and
  // Save, so its controls are the last of their kind.
  await user.type(screen.getAllByRole('textbox', { name: 'Name (English)' }).at(-1)!, 'Caramel');
  await user.type(screen.getAllByRole('textbox', { name: 'Name (Arabic)' }).at(-1)!, 'كراميل');
  await user.type(screen.getByPlaceholderText('Extra charge (IQD)'), delta);
}

beforeEach(() => {
  rpc.appRpc.mockReset();
  rpc.appRpc.mockResolvedValue('new-id');
  nav.navigate.mockReset();
  who.role = 'manager';
});

describe('OptionsEditor as a manager', () => {
  it('keeps an option on sale at its price, with Change the price', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect((screen.getByDisplayValue('1000') as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Change the price: Oat milk' }));
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'addon_price', addon: OAT } });
    // Switching it off and on is still theirs.
    expect((screen.getByRole('switch', { name: 'Active: Oat milk' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('holds a hidden paid option for the owner, with Put on sale, and lets a free one go on', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect((screen.getByRole('switch', { name: 'Active: Vanilla syrup' }) as HTMLButtonElement).disabled).toBe(true);
    // Never on sale: its price is still the manager's to set.
    expect((screen.getByDisplayValue('500') as HTMLInputElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Put on sale: Vanilla syrup' }));
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'addon_price', addon: SYRUP } });
    expect((screen.getByRole('switch', { name: 'Active: No ice' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Put on sale: No ice' })).toBeNull();
  });

  it('saves a new paid option hidden, and says so', async () => {
    const user = userEvent.setup();
    renderEditor();
    await addOption(user, '750');
    expect(screen.getByText('Saved hidden. “Put on sale” then sends its price to the owner.')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith('upsert_modifier', expect.objectContaining({ p_name_en: 'Caramel', p_price_delta_iqd: 750, p_is_active: false })),
    );
  });

  it('saves a new free option switched on', async () => {
    const user = userEvent.setup();
    renderEditor();
    await addOption(user, '0');
    expect(screen.queryByText('Saved hidden. “Put on sale” then sends its price to the owner.')).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_modifier', expect.objectContaining({ p_price_delta_iqd: 0, p_is_active: true })));
  });
});

describe('OptionsEditor as the owner', () => {
  it('is unchanged: prices editable, a paid option saved on, no starts', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    renderEditor();
    expect((screen.getByDisplayValue('1000') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('switch', { name: 'Active: Vanilla syrup' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /^Change the price/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Put on sale/ })).toBeNull();
    await addOption(user, '750');
    await user.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_modifier', expect.objectContaining({ p_price_delta_iqd: 750, p_is_active: true })));
  });
});
