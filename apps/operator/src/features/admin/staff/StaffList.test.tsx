import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import type * as AuthModule from '../../../lib/auth';

// /admin/staff?hire=<run step> (build-contracts-2026-09-23 §5.5): the banner
// names the hiring run's pick and role, Add staff member opens filled in with
// the role fixed, and the new account's id is sent as the add_staff step. A
// send that fails keeps the account and offers only the send again.
//
// vitest.config sets `restoreMocks: true`, so every mock is armed in beforeEach.

const STEP = '0e000000-0000-4000-8000-000000000003';
const RUN = '0e000000-0000-4000-8000-000000000001';
const SARA = '0c000000-0000-4000-8000-000000000002';
const NEW_ID = '0a000000-0000-4000-8000-000000000009';

const search: { hire?: string } = { hire: STEP };
const { navigateSpy, toastOk } = vi.hoisted(() => ({ navigateSpy: vi.fn(), toastOk: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateSpy, useSearch: () => search }));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: toastOk, info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    useAuth: () => ({ staff: { id: 'owner-1', role: 'owner' } }),
    usePermissions: () => actual.permissionsFor('owner'),
  };
});
vi.mock('../../../lib/settings', () => ({
  useCafeSettings: () => ({ settings: { break_allowance_minutes: 30 }, isLoading: false }),
  useSetCafeSetting: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../../../lib/edge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callEdge: vi.fn(),
}));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../../lib/appRpc';
import { callEdge } from '../../../lib/edge';
import { StaffList } from './StaffList';

const rpc = vi.mocked(appRpc);
const edge = vi.mocked(callEdge);

let stepOpen = true;
let submitFails = 0;
let positionRole = 'cashier';

beforeEach(() => {
  search.hire = STEP;
  stepOpen = true;
  submitFails = 0;
  positionRole = 'cashier';
  navigateSpy.mockReset();
  toastOk.mockReset();
  edge.mockResolvedValue({ result: 'created', staff: { id: NEW_ID, display_name: 'Sara Kareem', role: 'cashier', is_active: true } });
  rpc.mockImplementation(async (fn: string) => {
    switch (fn) {
      case 'list_staff':
        return [{ id: 'owner-1', display_name: 'Owner', role: 'owner', is_active: true, has_pin: true }];
      case 'protocol_step_detail':
        return { run: { id: RUN, kind: 'hiring' }, step: { step_key: 'add_staff', status: stepOpen ? 'open' : 'passed' }, can: { submit: stepOpen } };
      case 'protocol_run_detail':
        return {
          run: { id: RUN, kind: 'hiring' },
          steps: [
            { step_key: 'open_position', submissions: [{ decision: 'approve', record: { role: positionRole } }] },
            { step_key: 'interviews', submissions: [{ decision: 'approve', record: { candidate_ids: [SARA], picked_id: SARA } }] },
          ],
          can: {},
        };
      case 'hiring_candidates':
        return { candidates: [{ id: SARA, candidate_name: 'Sara Kareem', picked: true }], purged: false };
      case 'submit_step':
        if (submitFails > 0) {
          submitFails -= 1;
          throw new Error('network');
        }
        return { submission_id: 's1', auto: true, step_status: 'passed', run_status: 'done', opened_step_ids: [] };
      default:
        return null;
    }
  });
});

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <StaffList />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function fillAndAdd(user: ReturnType<typeof userEvent.setup>) {
  // The banner's button names the pick.
  await user.click(await screen.findByRole('button', { name: /^Add \u2068?Sara Kareem\u2069?$/ }));
  const dialog = await screen.findByRole('dialog');
  // It says saving finishes the run, since the banner is now behind it.
  expect(within(dialog).getByText('Saving the account finishes the hiring run.')).toBeTruthy();
  // Filled in from the run: the pick's name, the position's role, fixed, and
  // why it is fixed read with the role (its description, not a stray line).
  expect(within(dialog).getByDisplayValue('Sara Kareem')).toBeTruthy();
  const role = within(dialog).getByRole('combobox', { name: 'Role' });
  expect(role.textContent).toContain('Cashier');
  expect(role.hasAttribute('disabled') || role.getAttribute('aria-disabled') === 'true').toBe(true);
  const describedBy = role.getAttribute('aria-describedby');
  expect(describedBy && document.getElementById(describedBy)?.textContent).toContain('Set by the hiring run');
  // The name is filled in, so the email takes the focus.
  expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: /email/i }));
  await user.type(within(dialog).getByRole('textbox', { name: /email/i }), 'sara@touch.local');
  await user.type(within(dialog).getAllByRole('textbox').at(-1)!, 'opening-pass-123');
  await user.click(within(dialog).getByRole('button', { name: 'Add staff member' }));
  return dialog;
}

describe('StaffList: adding a hiring run’s pick', () => {
  it('names the pick and role, fills the form, and sends the new account as the add_staff step', async () => {
    const user = userEvent.setup();
    renderList();
    // The name is typed text, bidi-isolated inside the sentence.
    expect(await screen.findByText(/\u2068?Sara Kareem\u2069? was picked for Cashier/)).toBeTruthy();
    await fillAndAdd(user);

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_step', expect.objectContaining({ p_run_step_id: STEP, p_record: { staff_id: NEW_ID } })));
    expect(edge).toHaveBeenCalledWith('staff-admin', expect.objectContaining({ action: 'create', display_name: 'Sara Kareem', role: 'cashier' }), { ttlMs: 0 });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith('Account added. The hiring run is finished.'));
    // The finished hire leaves the link.
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/admin/staff', search: {} });
  });

  it('a failed send keeps the account and offers only the send again, with the same key', async () => {
    submitFails = 1;
    const user = userEvent.setup();
    renderList();
    const dialog = await fillAndAdd(user);
    expect(await within(dialog).findByText('The account was created, but the hiring step was not sent.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Send the hiring step again' }));
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith('Account added. The hiring run is finished.'));
    // One account, two sends with one key.
    expect(edge).toHaveBeenCalledTimes(1);
    const sends = rpc.mock.calls.filter(([fn]) => fn === 'submit_step').map(([, a]) => (a as Record<string, unknown>).p_idempotency_key);
    expect(sends).toHaveLength(2);
    expect(sends[0]).toBe(sends[1]);
  });

  it('a step that no longer waits fills nothing in, and leaves a way to the run and out', async () => {
    stepOpen = false;
    const user = userEvent.setup();
    renderList();
    expect(await screen.findByText('This hiring step is not waiting for you, so nothing is filled in.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add \u2068?Sara/ })).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith('hiring_candidates', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Open the hiring run' }));
    expect(navigateSpy).toHaveBeenLastCalledWith({ to: '/protocols', search: { run: RUN, step: STEP } });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(navigateSpy).toHaveBeenLastCalledWith({ to: '/admin/staff', search: {} });
  });

  it('a position role no account can be given says so, instead of claiming the run did not load', async () => {
    positionRole = 'owner';
    renderList();
    expect(await screen.findByText(/The position names a role an account cannot be given here/)).toBeTruthy();
    expect(screen.queryByText('The hiring run could not be loaded.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the hiring run' })).toBeTruthy();
  });

  it('an account made without an id in the answer locks the form and says the step was not sent', async () => {
    edge.mockResolvedValue({ result: 'created' });
    const user = userEvent.setup();
    renderList();
    const dialog = await fillAndAdd(user);
    expect(await within(dialog).findByText('The account was created, but the hiring step was not sent.')).toBeTruthy();
    // No second account: the form is locked and Add cannot be pressed again.
    expect(within(dialog).getByRole('textbox', { name: /email/i })).toHaveProperty('disabled', true);
    expect(within(dialog).getByRole('button', { name: 'Add staff member' })).toHaveProperty('disabled', true);
    expect(rpc).not.toHaveBeenCalledWith('submit_step', expect.anything());
  });

  it('without the link the page is as it was', async () => {
    delete search.hire;
    renderList();
    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith('protocol_step_detail', expect.anything());
  });
});
