import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { LocaleProvider } from '../../lib/i18n';
import { mutate } from '../../lib/mutate';
import { appRpc } from '../../lib/appRpc';
import { CreateReservationDialog } from './CreateReservationDialog';
import { ReservationActionsDialog } from './ReservationActionsDialog';
import type { ReservationRow } from './deskTypes';

// The two desk dialogs over a real query client. The writes are mocked at
// mutate(), the price quote at appRpc('price_slot'), and the router and toast
// at their hooks — neither dialog renders a route of its own.

let priceRows: { rule_id: string; price_iqd: number }[] = [{ rule_id: 'r', price_iqd: 70000 }];

vi.mock('../../lib/mutate', () => ({
  mutate: vi.fn(async () => ({ queued: false, localId: '', idempotencyKey: '', result: null })),
  isElectron: () => false,
}));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    code = 'UNKNOWN';
  },
  appRpc: vi.fn(async (fn: string) => (fn === 'price_slot' ? priceRows : [])),
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn() }) }));
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role: 'court_desk' } }) };
});
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const TZ = 'Asia/Baghdad';
const DATE = '2099-09-03';
const courts = [
  { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب 1', duration_options: [60, 90], sort_order: 1 },
  { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب 2', duration_options: [60, 90], sort_order: 2 },
];
const at = (min: number) => wallTimeToUtc(DATE, min, TZ);

function booking(over: Partial<ReservationRow> & { id: string }): ReservationRow {
  return {
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: at(20 * 60).toISOString(),
    end_at: at(21 * 60).toISOString(),
    guest_id: null,
    guest_name: 'Sara Ahmed',
    guest_phone: null,
    price_iqd: 50000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(mutate).mockClear();
  vi.mocked(appRpc).mockClear();
  priceRows = [{ rule_id: 'r', price_iqd: 70000 }];
});

describe('CreateReservationDialog', () => {
  const night = { date: DATE, rows: [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30, 21 * 60], reservations: [booking({ id: 'held' })] };

  it('shows the price the server will charge for the chosen court, start and length', async () => {
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText(/70,000/)).toBeTruthy();
    expect(appRpc).toHaveBeenCalledWith('price_slot', { p_court_id: 'c2', p_start_at: at(20 * 60).toISOString(), p_duration_min: 60 });
  });

  it('marks start times the court is already booked for, and will not book one', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    wrap(<CreateReservationDialog courtId="c1" startAt={at(19 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={onCreated} />);
    const start = screen.getByLabelText('Start') as HTMLSelectElement;
    const taken = [...start.options].filter((o) => o.disabled).map((o) => o.value);
    // 19:30 + 60 min and 20:00 + 60 min overlap the 20:00–21:00 booking; 19:00 + 60 does not.
    expect(taken).toEqual([at(19 * 60 + 30).toISOString(), at(20 * 60).toISOString(), at(20 * 60 + 30).toISOString()]);
    // Moving to a free court clears it.
    await user.selectOptions(screen.getByLabelText('Court'), 'c2');
    expect([...(screen.getByLabelText('Start') as HTMLSelectElement).options].some((o) => o.disabled)).toBe(false);
    await user.type(screen.getByLabelText(/Guest name/), 'Walk In');
    await user.click(screen.getByRole('button', { name: 'Create booking' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith('reservation.create', expect.objectContaining({ courtId: 'c2', kind: 'booking', guestName: 'Walk In', startAt: at(19 * 60).toISOString() }));
  });

  it('refuses to book a length no rate prices, and says why', async () => {
    priceRows = [];
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('No price is set for this court at this time and length.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create booking' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts linked to a customer when booking for one', () => {
    wrap(
      <CreateReservationDialog
        courtId="c2"
        startAt={at(20 * 60)}
        courts={courts}
        tz={TZ}
        customer={{ id: 'g1', name: 'Layla Hassan', phone: '07701234567', flags: [] }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText('Linked to Layla Hassan')).toBeTruthy();
    expect((screen.getByLabelText(/Guest name/) as HTMLInputElement).value).toBe('Layla Hassan');
  });
});

describe('ReservationActionsDialog', () => {
  const rows = [19 * 60, 20 * 60, 21 * 60];

  it('marks a guest arrived in one click, with no reason attached', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    wrap(<ReservationActionsDialog reservation={booking({ id: 'r1' })} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={vi.fn()} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: 'Mark arrived' }));
    expect(onChanged).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith('reservation.update', { action: 'mark', reservationId: 'r1', status: 'arrived' });
  });

  it('takes the desk to the booking screen to take payment (0106)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(<ReservationActionsDialog reservation={booking({ id: 'r1', status: 'completed' })} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={onClose} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Take payment' }));
    expect(onClose).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/bookings/$id', params: { id: 'r1' } });
  });

  it('carries the chosen reason on an override (SOW L313)', async () => {
    const user = userEvent.setup();
    wrap(<ReservationActionsDialog reservation={booking({ id: 'r1', end_at: at(21 * 60 + 30).toISOString() })} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={vi.fn()} onChanged={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Reason for this change'), 'weather');
    await user.click(screen.getByRole('button', { name: 'Shorten −30 min' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('reservation.update', expect.objectContaining({ action: 'extend', reservationId: 'r1', reason: 'weather' })));
  });
});
