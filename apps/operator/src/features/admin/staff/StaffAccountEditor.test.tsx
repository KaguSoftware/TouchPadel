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

// The Access section (0345) reads the person's two columns off `staff`; every
// other read here answers an empty list.
const access = vi.hoisted(() => ({ row: { extra_roles: [] as string[], blocked_areas: [] as string[] } }));
vi.mock('../../../lib/supabase', () => {
  const chain = (table: string): unknown => {
    const result = { data: table === 'staff' ? access.row : [], error: null };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => result,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return q;
  };
  return { supabase: { from: chain }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => ({})),
}));

import { appRpc } from '../../../lib/appRpc';
import { StaffAccountEditor } from './StaffAccountEditor';

const rpc = vi.mocked(appRpc);

const cashier: StaffRow = { id: 'c1', display_name: 'Sara', role: 'cashier', is_active: true, has_pin: false };

/** The editor is a wizard: each section is a step, opened from the menu on the side. */
async function openStep(key: string) {
  await userEvent.click(screen.getByTestId(`staff-editor.step.${key}`));
}

/** The confirm opens over the wizard's own dialog: the last one is the question. */
async function confirmDialog() {
  await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(1));
  return screen.getAllByRole('dialog').at(-1)!;
}

/** Edits are held across the steps and written from Review, behind one confirm. */
async function submitFromReview() {
  await userEvent.click(screen.getByTestId('staff-editor.step.review'));
  await userEvent.click(screen.getByTestId('staff-editor.submit'));
}

async function confirmSave() {
  await userEvent.click(within(await confirmDialog()).getByRole('button', { name: 'Save changes' }));
}

function renderPanel(staff: StaffRow, isSelf = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ConfirmProvider>
          <StaffAccountEditor staff={staff} isSelf={isSelf} canManage onClose={vi.fn()} />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('StaffAccountEditor', () => {
  beforeEach(() => rpc.mockClear());

  it('a role change says what the new role can open and writes nothing until confirmed', async () => {
    renderPanel(cashier);
    await openStep('profile');
    // The hint under the picker follows the choice before anything is saved.
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    await userEvent.click(screen.getByRole('option', { name: 'Owner' }));
    expect(screen.getByText(/Everything, including staff accounts/)).toBeTruthy();

    await submitFromReview();
    const dialog = await confirmDialog();
    expect(within(dialog).getByText('Changes their role to Owner.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(rpc).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('staff-editor.submit'));
    await confirmSave();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_role', { p_staff_id: 'c1', p_role: 'owner' }));
  });

  it('never offers Kitchen, which is retired (0155), to anyone not already on it', async () => {
    renderPanel(cashier);
    await openStep('profile');
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    const offered = screen.getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual(expect.arrayContaining(['Barista', 'Head chef', 'Driver', 'Marketing']));
    expect(offered).not.toContain('Kitchen');
  });

  it('a Kitchen account still reads Kitchen, says to move it on, and can be moved to Barista', async () => {
    renderPanel({ ...cashier, role: 'prep' });
    await openStep('profile');
    const picker = screen.getByRole('combobox', { name: 'Role' });
    expect(picker.textContent).toContain('Kitchen');
    expect(screen.getByText(/retired/i)).toBeTruthy();

    await userEvent.click(picker);
    expect((screen.getByRole('option', { name: 'Kitchen' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('option', { name: 'Barista' }));
    await submitFromReview();
    await confirmSave();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_role', { p_staff_id: 'c1', p_role: 'barista' }));
  });

  it('removing access says what actually happens, then writes', async () => {
    renderPanel(cashier);
    await openStep('signin');
    await userEvent.click(screen.getByRole('button', { name: 'Remove access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove access for Sara?' });
    expect(within(dialog).getByText(/signed out on every device/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_active', { p_staff_id: 'c1', p_active: false }));
  });

  it('your own account cannot be re-roled or removed, and says why', async () => {
    renderPanel({ ...cashier, role: 'owner', has_pin: true }, true);
    expect((screen.getByLabelText('Role') as HTMLSelectElement).disabled).toBe(true);
    await openStep('signin');
    expect((screen.getByRole('button', { name: 'Remove access' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a cashier holds a PIN since 0105, and the panel says what it is for', async () => {
    // Before 0105 the panel said only managers and owners have a PIN. A
    // cashier's PIN unlocks the station (breaks left the operator, F-08) and
    // approves nothing — the note must say the first, not imply the second.
    renderPanel(cashier);
    await openStep('signin');
    expect(screen.getByLabelText('New PIN')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set PIN' })).toBeNull();
    expect(screen.getByText(/unlock the station with their password until one is set/)).toBeTruthy();
    expect(screen.queryByText(/approve/)).toBeNull();
    expect(screen.queryByText(/break/i)).toBeNull();
    // The break-cover station picker is gone with breaks.
    expect(screen.queryByText('Stations')).toBeNull();
  });

  it('Access: a second job adds its pages, an unticked page is blocked, and both save together after a yes', async () => {
    access.row = { extra_roles: [], blocked_areas: [] };
    renderPanel(cashier);
    await openStep('access');
    const section = await screen.findByTestId('staff-access');
    // A cashier's own pages are ticked; the desk is not theirs yet.
    expect((within(section).getByTestId('access-page-till') as HTMLInputElement).checked).toBe(true);
    expect(within(section).queryByTestId('access-page-desk')).toBeNull();
    // Their own role is never offered as a second job.
    expect(within(section).queryByTestId('access-job-cashier')).toBeNull();

    await userEvent.click(within(section).getByTestId('access-job-court_desk'));
    expect((within(section).getByTestId('access-page-desk') as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(section).getByTestId('access-page-incidents'));
    expect(rpc).not.toHaveBeenCalled();

    await submitFromReview();
    const dialog = await confirmDialog();
    expect(within(dialog).getByText('Adds the second job: Court desk.')).toBeTruthy();
    expect(within(dialog).getByText('Keeps them out of: Incidents.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_staff_access', {
        p_staff_id: 'c1',
        p_extra_roles: ['court_desk'],
        p_blocked_areas: ['incidents'],
      }),
    );
  });

  it('Access: taking a second job away drops the blocks on the pages it brought', async () => {
    access.row = { extra_roles: ['court_desk'], blocked_areas: ['tournaments'] };
    renderPanel(cashier);
    await openStep('access');
    const section = await screen.findByTestId('staff-access');
    expect((within(section).getByTestId('access-page-tournaments') as HTMLInputElement).checked).toBe(false);
    await userEvent.click(within(section).getByTestId('access-job-court_desk'));
    expect(within(section).queryByTestId('access-page-tournaments')).toBeNull();
    await submitFromReview();
    await confirmSave();
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_staff_access', { p_staff_id: 'c1', p_extra_roles: [], p_blocked_areas: [] }),
    );
  });

  it('Access: every barista is also a cashier (0446), so the box is ticked, locked and says why', async () => {
    access.row = { extra_roles: ['cashier'], blocked_areas: [] };
    renderPanel({ ...cashier, role: 'head_barista' });
    await openStep('access');
    const section = await screen.findByTestId('staff-access');
    const box = within(section).getByTestId('access-job-cashier') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(within(section).getByText('Every barista also works as a cashier, so Cashier stays ticked.')).toBeTruthy();
    expect((within(section).getByTestId('access-page-till') as HTMLInputElement).checked).toBe(true);
  });

  it('Access: ticking Barista as a second job brings Cashier with it', async () => {
    access.row = { extra_roles: [], blocked_areas: [] };
    renderPanel({ ...cashier, role: 'waiter' });
    await openStep('access');
    const section = await screen.findByTestId('staff-access');
    expect((within(section).getByTestId('access-job-cashier') as HTMLInputElement).disabled).toBe(false);
    await userEvent.click(within(section).getByTestId('access-job-barista'));
    const box = within(section).getByTestId('access-job-cashier') as HTMLInputElement;
    expect(box.checked && box.disabled).toBe(true);
    await submitFromReview();
    await confirmSave();
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_staff_access', {
        p_staff_id: 'c1',
        p_extra_roles: ['barista', 'cashier'],
        p_blocked_areas: [],
      }),
    );
  });

  it('Access: an owner has nothing to tick', async () => {
    renderPanel({ ...cashier, role: 'owner' });
    await openStep('access');
    expect(await screen.findByText('An owner opens everything, so there is nothing to tick.')).toBeTruthy();
    expect(screen.queryByTestId('staff-access')).toBeNull();
  });

  it('has no per-step Save buttons, and Done with nothing changed writes nothing', async () => {
    renderPanel(cashier);
    expect(screen.queryByRole('button', { name: /^Save (name|access)$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
    await userEvent.click(screen.getByTestId('staff-editor.step.review'));
    expect(screen.getByTestId('staff-editor.submit').textContent).toBe('Done');
    await userEvent.click(screen.getByTestId('staff-editor.submit'));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a new PIN and a new password are held, and written together when Save changes is confirmed', async () => {
    renderPanel(cashier);
    await openStep('signin');
    await userEvent.type(screen.getByLabelText('New PIN'), '482915');
    await userEvent.type(screen.getByLabelText('New password'), 'hunter2hunter2');
    expect(rpc).not.toHaveBeenCalledWith('set_staff_pin', expect.anything());
    await submitFromReview();
    await confirmSave();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_staff_pin', { p_staff_id: 'c1', p_pin: '482915' }));
  });

  it('removing the PIN is a draft: marked, undoable, and written only on save', async () => {
    renderPanel({ ...cashier, has_pin: true });
    await openStep('signin');
    await userEvent.click(screen.getByRole('button', { name: 'Remove PIN' }));
    expect(screen.getByText('The PIN is removed when you save.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep the PIN' }));
    expect(screen.getByLabelText('New PIN')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove PIN' }));
    await submitFromReview();
    await confirmSave();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('clear_staff_pin', { p_staff_id: 'c1' }));
  });
});
