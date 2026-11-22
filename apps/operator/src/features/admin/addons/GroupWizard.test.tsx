import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import type * as AppRpcModule from '../../../lib/appRpc';
import type * as AuthModule from '../../../lib/auth';
import type { AddonsData } from './useAddons';

// The extras wizard: Name, Choices, Options, Items, Review. Nothing is written
// until Review's Save. A manager's price rules (#51, #53, #9) survive in it.

const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
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
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));

import { GroupWizard } from './GroupWizard';

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
  items: [
    { id: 'latte', category_id: 'hot', name_en: 'Latte', name_ar: 'لاتيه', is_active: true },
    { id: 'cola', category_id: 'cold', name_en: 'Cola', name_ar: 'كولا', is_active: true },
  ],
  categories: [
    { id: 'hot', name_en: 'Hot drinks', name_ar: 'مشروبات ساخنة', sort_order: 0 },
    { id: 'cold', name_en: 'Cold drinks', name_ar: 'مشروبات باردة', sort_order: 1 },
  ],
};

function renderWizard(props: Partial<React.ComponentProps<typeof GroupWizard>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ConfirmProvider>
            <GroupWizard group={null} data={data} onClose={onClose} onSaved={onSaved} {...props} />
          </ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

beforeEach(() => {
  rpc.appRpc.mockReset();
  rpc.appRpc.mockResolvedValue('new-id');
  nav.navigate.mockReset();
  who.role = 'manager';
});

describe('GroupWizard', () => {
  it('holds Name until both names are given, and says so', async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Options' }).at(-1)!);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('Enter the name in English and Arabic.')).toBeTruthy();
  });

  it('makes a new group with a new option, and saves nothing before Save', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderWizard();
    await user.type(screen.getByRole('textbox', { name: /English/ }), 'Syrup');
    await user.type(screen.getByRole('textbox', { name: /Arabic/ }), 'شراب');
    await user.click(screen.getAllByRole('button', { name: 'Options' }).at(-1)!);
    await user.click(screen.getByRole('button', { name: 'New option' }));
    await user.type(screen.getByRole('textbox', { name: /Name \(English\)/ }), 'Caramel');
    await user.type(screen.getByRole('textbox', { name: /Name \(Arabic\)/ }), 'كراميل');
    await user.type(screen.getByRole('textbox', { name: /Extra charge/ }), '750');
    expect(rpc.appRpc).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Items' }).at(-1)!);
    await user.click(screen.getByRole('button', { name: /^Hot drinks/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Latte' }));
    await user.click(screen.getAllByRole('button', { name: 'Review' }).at(-1)!);
    await user.click(screen.getByTestId('group-wizard.submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-id'));
    expect(rpc.appRpc).toHaveBeenCalledWith(
      'upsert_modifier_group',
      expect.objectContaining({ p_id: null, p_name_en: 'Syrup', p_min_select: 0, p_max_select: 1 }),
    );
    expect(rpc.appRpc).toHaveBeenCalledWith('link_item_modifier_group', {
      p_item_id: 'latte',
      p_group_id: 'new-id',
      p_linked: true,
    });
    // A manager's new paid option goes in hidden.
    expect(rpc.appRpc).toHaveBeenCalledWith(
      'upsert_modifier',
      expect.objectContaining({ p_name_en: 'Caramel', p_price_delta_iqd: 750, p_is_active: false }),
    );
  });

  it('shows saved options as plain rows until Edit, and says a change to one on sale goes to the owner', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'options' });
    expect(screen.getByText('Oat milk')).toBeTruthy();
    expect(screen.getByText('+1,000 IQD')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Name \(English\)/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit: Oat milk' }));
    const box = (name: RegExp) => screen.getByRole('textbox', { name }) as HTMLInputElement;
    expect(box(/Name \(English\): Oat milk/).disabled).toBe(false);
    expect(box(/Extra charge \(IQD\): Oat milk/).disabled).toBe(false);
    expect(
      screen.getByText('On sale: a change to its name or price is sent to the owner for approval.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Change the price/ })).toBeNull();
  });

  it('sends a manager’s change to an option on sale to the owner, with a reason, and does not write it', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderWizard({ group, startAt: 'options' });
    await user.click(screen.getByRole('button', { name: 'Edit: Oat milk' }));
    const price = screen.getByRole('textbox', { name: /Extra charge \(IQD\): Oat milk/ });
    await user.clear(price);
    await user.type(price, '1500');
    const en = screen.getByRole('textbox', { name: /Name \(English\): Oat milk/ });
    await user.clear(en);
    await user.type(en, 'Oat drink');
    await user.click(screen.getByTestId('group-wizard.step.review'));
    expect(screen.getByText('Sent to the owner for approval')).toBeTruthy();
    // Save waits for why and what is expected.
    expect((screen.getByTestId('group-wizard.submit') as HTMLButtonElement).disabled).toBe(true);
    const boxes = screen.getAllByRole('textbox');
    await user.type(boxes.at(-2)!, 'Oat costs more');
    await user.type(boxes.at(-1)!, 'Margin back');
    await user.click(screen.getByTestId('group-wizard.submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // Not written: the locked name and price wait for the owner.
    expect(rpc.appRpc.mock.calls.filter(([name]) => name === 'upsert_modifier')).toHaveLength(0);
    const started = rpc.appRpc.mock.calls.find(([name]) => name === 'start_protocol');
    expect(started![1]).toMatchObject({
      p_kind: 'price_promo',
      p_variant: null,
      p_first_record: {
        change: 'addon_price',
        reason: 'Oat costs more',
        expected_effect: 'Margin back',
        addons: [{ modifier_id: OAT, price_delta_iqd: 1500 }],
        renames: [{ modifier_id: OAT, name_en: 'Oat drink', name_ar: 'حليب الشوفان' }],
      },
    });
  });

  it('puts a cancelled edit back to what is stored, and the row plain again', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'options' });
    await user.click(screen.getByRole('button', { name: 'Edit: Oat milk' }));
    const price = screen.getByRole('textbox', { name: /Extra charge \(IQD\): Oat milk/ });
    await user.clear(price);
    await user.type(price, '1500');
    await user.click(screen.getByRole('button', { name: 'Cancel: Oat milk' }));
    expect(screen.queryByRole('textbox', { name: /Extra charge/ })).toBeNull();
    expect(screen.getByText('+1,000 IQD')).toBeTruthy();
  });

  it('writes an owner’s change to an option on sale directly, with no request', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    const { onSaved } = renderWizard({ group, startAt: 'options' });
    await user.click(screen.getByRole('button', { name: 'Edit: Oat milk' }));
    const price = screen.getByRole('textbox', { name: /Extra charge \(IQD\): Oat milk/ });
    await user.clear(price);
    await user.type(price, '1500');
    await user.click(screen.getByTestId('group-wizard.step.review'));
    expect(screen.queryByText('Sent to the owner for approval')).toBeNull();
    await user.click(screen.getByTestId('group-wizard.submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(rpc.appRpc).toHaveBeenCalledWith(
      'upsert_modifier',
      expect.objectContaining({ p_id: OAT, p_price_delta_iqd: 1500 }),
    );
    expect(rpc.appRpc.mock.calls.some(([name]) => name === 'start_protocol')).toBe(false);
  });

  it('offers Put on sale for a paid option never on sale, and no start for a free one', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'options' });
    await user.click(screen.getByRole('button', { name: 'Edit: Vanilla syrup' }));
    expect(screen.getByRole('button', { name: 'Put on sale: Vanilla syrup' })).toBeTruthy();
    expect(
      (
        screen.getByRole('textbox', {
          name: /Extra charge \(IQD\): Vanilla syrup/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Edit: No ice' }));
    expect(screen.queryByRole('button', { name: 'Put on sale: No ice' })).toBeNull();
  });

  it('shows both names and the extra charge in an opened option, each with a visible label', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'options' });
    await user.click(screen.getByRole('button', { name: 'Edit: No ice' }));
    expect(screen.getByDisplayValue('No ice')).toBeTruthy();
    expect(screen.getByDisplayValue('بلا ثلج')).toBeTruthy();
    expect(screen.getAllByText('Name (English)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Name (Arabic)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Extra charge (IQD)').length).toBeGreaterThan(0);
  });

  it('saves only what changed on an existing group', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderWizard({ group, startAt: 'options' });
    await user.click(screen.getByRole('button', { name: 'Edit: No ice' }));
    const ice = screen.getByRole('textbox', { name: /Extra charge \(IQD\): No ice/ });
    await user.clear(ice);
    await user.type(ice, '250');
    await user.click(screen.getByTestId('group-wizard.step.review'));
    await user.click(screen.getByTestId('group-wizard.submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const calls = rpc.appRpc.mock.calls.filter(([name]) => name === 'upsert_modifier');
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({ p_id: ICE, p_price_delta_iqd: 250 });
  });
});

describe('GroupWizard opened from an option', () => {
  it('opens that option for editing and leaves the others as plain rows', () => {
    renderWizard({ group, startAt: 'options', startOption: ICE });
    expect(screen.getByRole('textbox', { name: /Name \(English\): No ice/ })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Name \(English\): Oat milk/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit: Oat milk' })).toBeTruthy();
  });
});

describe('GroupWizard choices', () => {
  it('shows the two limits only for “Pick several”, and says the rule in a sentence', async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(screen.getByText('Optional · choose up to 1')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'At most' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Pick several/ }));
    expect(screen.getByText('Optional · choose up to 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'At most +' }));
    expect(screen.getByText('Optional · choose up to 4')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'At least +' }));
    expect(screen.getByText('Required · choose 1 to 4')).toBeTruthy();
  });
});

describe('GroupWizard items step', () => {
  it('shows a card per category with how many are picked, and opens one to its items', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'items' });
    // Latte is already offered, so Hot drinks says 1 of 1; no item is listed yet.
    expect(screen.getByRole('button', { name: /^Hot drinks/ }).textContent).toContain('1 of 1');
    expect(screen.getByRole('button', { name: /^Cold drinks/ }).textContent).toContain('0 of 1');
    expect(screen.queryByRole('checkbox', { name: 'Cola' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Cold drinks/ }));
    expect(screen.getByRole('checkbox', { name: 'Cola' })).toBeTruthy();
    // The breadcrumb says where this is; Back (and the breadcrumb's Items) return to the cards.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /^Cold drinks/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Cold drinks/ }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Items' })).getByRole('button', {
        name: 'Items',
      }),
    );
    expect(screen.getByRole('button', { name: /^Cold drinks/ })).toBeTruthy();
  });

  it('selects a whole category at once from inside it', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'items' });
    await user.click(screen.getByRole('button', { name: /^Cold drinks/ }));
    await user.click(screen.getByRole('button', { name: 'Select all: Cold drinks' }));
    expect((screen.getByRole('checkbox', { name: 'Cola' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Clear: Cold drinks' })).toBeTruthy();
  });

  it('lists matches from every category while searching', async () => {
    const user = userEvent.setup();
    renderWizard({ group, startAt: 'items' });
    await user.type(screen.getByRole('searchbox'), 'col');
    expect(screen.getByRole('checkbox', { name: 'Cola' })).toBeTruthy();
    expect(screen.getByText('Cold drinks')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Latte' })).toBeNull();
  });
});
