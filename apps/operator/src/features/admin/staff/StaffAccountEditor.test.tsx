import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import type { StaffRow } from './staffModel';

// The row dropdown used to change a role the instant it moved, and "Remove"
// took access away with a two-word question. Every change that gives power or
// takes access away now says what it does and waits for a yes.

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => ({})),
}));

import { appRpc } from '../../../lib/appRpc';
import { StaffAccountEditor } from './StaffAccountEditor';

const rpc = vi.mocked(appRpc);

const cashier: StaffRow = { id: 'c1', display_name: 'Sara', role: 'cashier', is_active: true, has_pin: false };

function renderPanel(staff: StaffRow, isSelf = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ConfirmProvider>
          <StaffAccountEditor staff={staff} isSelf={isSelf} canManage onClose={vi.fn()} onResetPassword={vi.fn()} onSetPin={vi.fn()} />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('StaffAccountEditor', () => {
  beforeEach(() => rpc.mockClear());

  it('a role change says what the new role can open and writes nothing until confirmed', async () => {
    renderPanel(cashier);
    // The hint under the picker follows the choice before anything is saved.
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    await userEvent.click(screen.getByRole('option', { name: 'Owner' }));
    expect(screen.getByText(/Everything, including staff accounts/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change Sara’s role to Owner?' });
    expect(rpc).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(rpc).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change to Owner' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_role', { p_staff_id: 'c1', p_role: 'owner' }));
  });

  it('never offers Kitchen, which is retired (0155), to anyone not already on it', async () => {
    renderPanel(cashier);
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    const offered = screen.getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual(expect.arrayContaining(['Barista', 'Head chef', 'Driver', 'Marketing']));
    expect(offered).not.toContain('Kitchen');
  });

  it('a Kitchen account still reads Kitchen, says to move it on, and can be moved to Barista', async () => {
    renderPanel({ ...cashier, role: 'prep' });
    const picker = screen.getByRole('combobox', { name: 'Role' });
    expect(picker.textContent).toContain('Kitchen');
    expect(screen.getByText(/retired/i)).toBeTruthy();

    await userEvent.click(picker);
    expect((screen.getByRole('option', { name: 'Kitchen' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('option', { name: 'Barista' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change to Barista' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_role', { p_staff_id: 'c1', p_role: 'barista' }));
  });

  it('removing access says what actually happens, then writes', async () => {
    renderPanel(cashier);
    await userEvent.click(screen.getByRole('button', { name: 'Remove access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove access for Sara?' });
    expect(within(dialog).getByText(/signed out on every device/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_active', { p_staff_id: 'c1', p_active: false }));
  });

  it('your own account cannot be re-roled or removed, and says why', () => {
    renderPanel({ ...cashier, role: 'owner', has_pin: true }, true);
    expect((screen.getByLabelText('Role') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove access' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only another owner can change your role/)).toBeTruthy();
  });

  it('a cashier holds a PIN since 0105, and the panel says what it is for', () => {
    // Before 0105 the panel said only managers and owners have a PIN. A
    // cashier's PIN now starts and ends their breaks and unlocks the station,
    // and approves nothing — the note must say the first, not imply the second.
    renderPanel(cashier);
    expect(screen.getByRole('button', { name: 'Set PIN' })).toBeTruthy();
    expect(screen.getByText(/cannot take a break until one is set/)).toBeTruthy();
    expect(screen.queryByText(/approve/)).toBeNull();
  });
});
