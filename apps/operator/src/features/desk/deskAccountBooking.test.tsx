import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { LocaleProvider } from '../../lib/i18n';
import { mutate } from '../../lib/mutate';
import { callEdge } from '../../lib/edge';
import { CreateReservationDialog } from './CreateReservationDialog';

// 0448: a typed name and number become a customer account before the booking
// is written (features/desk/customers/deskAccount.ts). The function is mocked
// at callEdge, the write at mutate(), as deskDialogs.test.tsx does.

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }));
vi.mock('../../lib/mutate', () => ({
  mutate: vi.fn(async () => ({ queued: false, localId: '', idempotencyKey: '', result: null })),
  isElectron: () => false,
}));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    code = 'UNKNOWN';
  },
  appRpc: vi.fn(async (fn: string) => (fn === 'price_slot' ? [{ rule_id: 'r', price_iqd: 70000 }] : [])),
}));
vi.mock('../../lib/edge', () => ({ callEdge: vi.fn() }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: toastInfo }) }));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable: true }) }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role: 'court_desk' } }) };
});
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const TZ = 'Asia/Baghdad';
const at = (min: number) => wallTimeToUtc('2099-09-03', min, TZ);
const courts = [{ id: 'c2', name_en: 'Court 2', name_ar: 'ملعب 2', duration_options: [60, 90], sort_order: 2 }];

type User = ReturnType<typeof userEvent.setup>;
const go = (user: User, key: 'who' | 'when' | 'review') => user.click(screen.getByTestId(`booking.step.${key}`));
const createButton = () => screen.getByTestId('booking.submit') as HTMLButtonElement;

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} onClose={vi.fn()} onCreated={onCreated} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onCreated };
}

async function typeGuest(user: User, name: string, phone: string) {
  await go(user, 'who');
  await user.type(screen.getByLabelText(/Guest name/), name);
  if (phone) await user.type(screen.getByLabelText(/Guest phone/), phone);
}

const lastWrite = () => vi.mocked(mutate).mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  vi.mocked(mutate).mockClear();
  vi.mocked(callEdge).mockReset();
  toastInfo.mockClear();
});

describe('New booking: a typed name and number become a customer (0448)', () => {
  it('says what the number is for, before and after it is typed', async () => {
    const user = userEvent.setup();
    open();
    await go(user, 'who');
    expect(screen.getByTestId('desk-account-note').textContent).toBe('Without a number this guest is saved by name only, as an incomplete customer. A number completes the account.');
    await user.type(screen.getByLabelText(/Guest name/), 'Walk In');
    await user.type(screen.getByLabelText(/Guest phone/), '07701234567');
    expect(screen.getByTestId('desk-account-note').textContent).toBe('Saved as a customer under this number. They finish their account in the app.');
  });

  it('makes the account, then books for it', async () => {
    vi.mocked(callEdge).mockResolvedValue({ id: 'new-1', customer: { id: 'new-1', full_name: 'Walk In', phone: '07701234567', gender: null } });
    const user = userEvent.setup();
    const { onCreated } = open();
    await typeGuest(user, 'Walk In', '07701234567');
    await go(user, 'review');
    await user.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(callEdge).toHaveBeenCalledWith(
      'desk-customer-create',
      { fullName: 'Walk In', phone: '07701234567', preferredLang: 'en', ifExists: 'return' },
      expect.objectContaining({ ttlMs: 0, retry: false }),
    );
    expect(lastWrite()).toMatchObject({ guestId: 'new-1', guestName: 'Walk In', guestPhone: '07701234567' });
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('is saved as a customer'));
  });

  it('links an account the number already has under the same name, with no question', async () => {
    vi.mocked(callEdge).mockResolvedValue({ id: 'old-1', existing: true, claimed: true, customer: { full_name: 'Walk In Hassan', phone: '+9647701234567', gender: 'male' } });
    const user = userEvent.setup();
    const { onCreated } = open();
    await typeGuest(user, 'Walk In', '07701234567');
    await go(user, 'review');
    await user.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(lastWrite()).toMatchObject({ guestId: 'old-1' });
  });

  it('a number that is somebody else\'s is shown first; the second press books it', async () => {
    vi.mocked(callEdge).mockResolvedValue({ id: 'old-2', existing: true, claimed: true, customer: { full_name: 'Omar Saleh', phone: '07701234567', gender: 'male' } });
    const user = userEvent.setup();
    const { onCreated } = open();
    await typeGuest(user, 'Walk In', '07701234567');
    await go(user, 'review');
    await user.click(createButton());
    // Nothing written: the Who step now shows whose number it is.
    expect(await screen.findByText('Linked to Omar Saleh')).toBeTruthy();
    expect(screen.getByTestId('desk-account-check').textContent).toContain('This number already belongs to');
    expect(mutate).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('already belongs to'));
    await go(user, 'review');
    await user.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(lastWrite()).toMatchObject({ guestId: 'old-2' });
    expect(callEdge).toHaveBeenCalledTimes(1);
  });

  it('Unlink after that keeps the typed name: no account is looked for again', async () => {
    vi.mocked(callEdge).mockResolvedValue({ id: 'old-3', existing: true, claimed: true, customer: { full_name: 'Omar Saleh', phone: '07701234567', gender: 'male' } });
    const user = userEvent.setup();
    const { onCreated } = open();
    await typeGuest(user, 'Walk In', '07701234567');
    await go(user, 'review');
    await user.click(createButton());
    await user.click(await screen.findByText('Unlink'));
    await go(user, 'review');
    await user.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(lastWrite()).not.toHaveProperty('guestId');
    expect(lastWrite()).toMatchObject({ guestName: 'Walk In', guestPhone: '07701234567' });
    expect(callEdge).toHaveBeenCalledTimes(1);
  });

  it('never stands in the way: no answer from the function books under the typed name', async () => {
    vi.mocked(callEdge).mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { onCreated } = open();
    await typeGuest(user, 'Walk In', '07701234567');
    await go(user, 'review');
    await user.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(lastWrite()).not.toHaveProperty('guestId');
    expect(lastWrite()).toMatchObject({ guestName: 'Walk In', guestPhone: '07701234567' });
  });

  it('a name with no number is saved as an incomplete customer, and the booking is theirs', async () => {
    vi.mocked(callEdge).mockResolvedValue({ id: 'draft-1', incomplete: true, customer: { id: 'draft-1', full_name: 'Walk In', phone: null, gender: null } });
    const user = userEvent.setup();
    const { onCreated } = open();
    await typeGuest(user, 'Walk In', '');
    await go(user, 'review');
    await user.click(createButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(callEdge).toHaveBeenCalledWith(
      'desk-customer-create',
      { fullName: 'Walk In', preferredLang: 'en', ifExists: 'return' },
      expect.anything(),
    );
    expect(lastWrite()).toMatchObject({ guestId: 'draft-1', guestName: 'Walk In' });
    expect(lastWrite()).not.toHaveProperty('guestPhone');
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('by name only'));
  });
});
