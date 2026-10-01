import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../lib/i18n';

// Add player (operator.md §5.13.9): a typed walk-in or a customer, the ban
// and category mirrors, the booked-match wording, and the toast at four.

const navigate = vi.fn();
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
let reachable = true;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#record">{children}</a>,
  useNavigate: () => navigate,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/realtime', () => ({ useBroadcast: vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { AddSeatDialog, categoryGender, deskOpenNumbers } from './AddSeatDialog';
import type { MatchSeat } from './matchPayloads';

const rpc = vi.mocked(appRpc);
type Raw = Record<string, unknown>;

function rawSeat(no: number, over: Raw = {}): Raw {
  return {
    seat_id: `s${no}`,
    seat_no: no,
    kind: 'desk',
    status: 'in',
    carrying: true,
    full_name: `Player ${no}`,
    can: { mark_attended: false, mark_no_show: false, unmark: false, remove_reasons: [], take_share: false, write_off: false, replace: false },
    ...over,
  };
}

function rawDetail(match: Raw, seats: Raw[]): Raw {
  return {
    match: {
      id: 'm1',
      status: 'filling',
      start_at: '2026-10-01T18:00:00.000Z',
      end_at: '2026-10-01T19:30:00.000Z',
      category: 'open',
      shares_iqd: [10000, 10000, 10000, 12000],
      court_name_en: 'Indoor Court 1',
      court_name_ar: 'الملعب الداخلي 1',
      server_now: '2026-10-01T15:00:00.000Z',
      can: { add_seat: true, cancel: true, call_off: false },
      ...match,
    },
    seats,
    requests: [],
    money: null,
    events: [],
  };
}

let raw: Raw;
let record: Raw | null;
let addResult: unknown;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  reachable = true;
  record = null;
  addResult = { seat_no: 3, match_status: 'filling' };
  calls.length = 0;
  navigate.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'desk_match_detail') return structuredClone(raw);
    if (fn === 'customer_record') return record;
    if (fn === 'desk_add_seat') {
      if (addResult instanceof Error) throw addResult;
      return addResult;
    }
    return [];
  });
});

async function mount(props: { customerId?: string } = {}) {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <AddSeatDialog matchId="m1" onClose={onClose} onAdded={onAdded} {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  // The match detail has landed once the Add button knows why it is disabled (or is not).
  await waitFor(() => expect(calls.some((c) => c.fn === 'desk_match_detail')).toBe(true));
  return { dialog, onClose, onAdded };
}

const addButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Add player' }) as HTMLButtonElement;
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩]/g, '');

describe('deskOpenNumbers / categoryGender', () => {
  const seat = (no: number, over: Partial<MatchSeat> = {}) =>
    ({ seat_id: `s${no}`, seat_no: no, carrying: true, status: 'in', can: { replace: false }, ...over }) as MatchSeat;

  it('a vacant number, a late leaver and a no-show the server lets the desk re-seat', () => {
    expect(deskOpenNumbers([seat(1), seat(3)])).toEqual([2, 4]);
    expect(deskOpenNumbers([seat(1), seat(2, { status: 'left_late' }), seat(3), seat(4)])).toEqual([2]);
    expect(deskOpenNumbers([seat(1), seat(2), seat(3, { status: 'no_show', can: { replace: true } as MatchSeat['can'] }), seat(4, { status: 'no_show' })])).toEqual([3]);
  });

  it('women seat women, men seat men, an open match names nobody', () => {
    expect(categoryGender('women')).toBe('female');
    expect(categoryGender('men')).toBe('male');
    expect(categoryGender('open')).toBeNull();
  });
});

describe('AddSeatDialog', () => {
  it('a typed walk-in: Add waits for a name, then sends it with the dialog key', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1), rawSeat(2)]);
    const { dialog, onClose, onAdded } = await mount();
    expect(addButton(dialog).disabled).toBe(true);
    expect(addButton(dialog).title).toBe('Pick a customer or type a name.');
    await user.type(within(dialog).getByLabelText('Guest name'), 'Bravo');
    await user.click(addButton(dialog));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const args = calls.find((c) => c.fn === 'desk_add_seat')!.args;
    expect(args).toMatchObject({ p_match_id: 'm1', p_customer_id: null, p_guest_name: 'Bravo', p_guest_phone: null, p_gender: null });
    expect(String(args.p_idempotency_key)).toMatch(/^match\.add:/);
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Bravo is in.');
    expect(onAdded).toHaveBeenCalled();
  });

  it("a typed name and phone follow the server's rules: 80 characters, a phone of 7 to 15 digits, said on the box", async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1), rawSeat(2)]);
    const { dialog } = await mount();
    const name = within(dialog).getByLabelText('Guest name') as HTMLInputElement;
    expect(name.maxLength).toBe(80);
    await user.type(name, 'Bravo');
    const phone = within(dialog).getByLabelText(/^Guest phone/);
    await user.type(phone, '0770 12');
    expect(addButton(dialog).disabled).toBe(true);
    expect(addButton(dialog).title).toBe('A phone number has 7 to 15 digits.');
    // Not said on the box while it is being typed; once the desk leaves it.
    expect(within(dialog).queryByText('A phone number has 7 to 15 digits.')).toBeNull();
    await user.tab();
    expect(within(dialog).getByText('A phone number has 7 to 15 digits.')).toBeTruthy();
    await user.type(phone, '34567');
    expect(addButton(dialog).disabled).toBe(false);
  });

  it('INVALID_ARGUMENT p_guest_phone lands on the phone box, not as a generic refusal', async () => {
    const user = userEvent.setup();
    addResult = new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_guest_phone');
    raw = rawDetail({}, [rawSeat(1), rawSeat(2)]);
    const { dialog, onClose } = await mount();
    await user.type(within(dialog).getByLabelText('Guest name'), 'Bravo');
    await user.type(within(dialog).getByLabelText(/^Guest phone/), '07701234567');
    await user.click(addButton(dialog));
    expect(await within(dialog).findByText('A phone number has 7 to 15 digits.')).toBeTruthy();
    expect(within(dialog).queryByText(/Invalid input/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a women's match seats a typed walk-in as a woman, vouched at the desk", async () => {
    const user = userEvent.setup();
    raw = rawDetail({ category: 'women' }, [rawSeat(1)]);
    const { dialog } = await mount();
    expect(within(dialog).getByText('Seated as a woman (vouched at the desk).')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Guest name'), 'Sara');
    await user.click(addButton(dialog));
    await waitFor(() => expect(calls.find((c) => c.fn === 'desk_add_seat')?.args.p_gender).toBe('female'));
  });

  it('a handed-back customer banned from open matches cannot be added', async () => {
    record = { customer: { id: 'c9', full_name: 'Omar Khalid', phone: '0770', email: null, preferred_lang: 'en' }, flags: [{ type: 'match_ban', label: 'conduct' }] };
    raw = rawDetail({}, [rawSeat(1)]);
    const { dialog } = await mount({ customerId: 'c9' });
    await waitFor(() => expect(within(dialog).getByText(/Linked to Omar Khalid/)).toBeTruthy());
    expect(addButton(dialog).disabled).toBe(true);
    expect(addButton(dialog).title).toBe('Banned from open matches');
  });

  it("a customer who plays as a man cannot join a women's match; the dialog links their record", async () => {
    record = { customer: { id: 'c9', full_name: 'Omar Khalid', phone: null, email: null, preferred_lang: 'en', gender: 'male' }, flags: [] };
    raw = rawDetail({ category: 'women' }, [rawSeat(1)]);
    const { dialog } = await mount({ customerId: 'c9' });
    await waitFor(() => expect(addButton(dialog).title).toBe('This customer plays as a man. This match is for women.'));
    expect(addButton(dialog).disabled).toBe(true);
    expect(within(dialog).getByText('Open their record')).toBeTruthy();
    expect(within(dialog).queryByText('Seated as a woman (vouched at the desk).')).toBeNull();
  });

  it('a linked customer is sent by id, never by a typed name', async () => {
    const user = userEvent.setup();
    record = { customer: { id: 'c9', full_name: 'Noor Salem', phone: '0771', email: null, preferred_lang: 'ar' }, flags: [] };
    raw = rawDetail({}, [rawSeat(1)]);
    const { dialog } = await mount({ customerId: 'c9' });
    await waitFor(() => expect(addButton(dialog).disabled).toBe(false));
    await user.click(addButton(dialog));
    await waitFor(() => expect(calls.find((c) => c.fn === 'desk_add_seat')?.args).toMatchObject({ p_customer_id: 'c9', p_guest_name: null, p_guest_phone: null }));
  });

  it("a booked match: the title says a free seat, and its share is owed", async () => {
    const user = userEvent.setup();
    raw = rawDetail({ status: 'booked' }, [rawSeat(1), rawSeat(2), rawSeat(3)]);
    addResult = { seat_no: 4, match_status: 'booked' };
    const { dialog } = await mount();
    await waitFor(() => expect(within(dialog).getByText('Add a player in a free seat')).toBeTruthy());
    expect(within(dialog).getByText("They owe the seat's share of 12,000 IQD.")).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Guest name'), 'Delta');
    await user.click(addButton(dialog));
    // Already booked: the plain line, not "Four in".
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Delta is in.');
  });

  it('at four while filling: "Four in: booked on {court}", or waiting for a court', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1), rawSeat(2), rawSeat(3)]);
    addResult = { seat_no: 4, match_status: 'booked' };
    const first = await mount();
    raw = rawDetail({ status: 'booked' }, [rawSeat(1), rawSeat(2), rawSeat(3), rawSeat(4)]);
    await user.type(within(first.dialog).getByLabelText('Guest name'), 'Delta');
    await user.click(addButton(first.dialog));
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Four in: booked on Indoor Court 1.');
  });

  it('four in and waiting for a court says so', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1), rawSeat(2), rawSeat(3)]);
    addResult = { seat_no: 4, match_status: 'awaiting_court' };
    const { dialog } = await mount();
    await user.type(within(dialog).getByLabelText('Guest name'), 'Delta');
    await user.click(addButton(dialog));
    await waitFor(() => expect(toast.ok).toHaveBeenCalledWith('Four in: waiting for a court.'));
  });

  it('a refusal stays in the dialog, beside the button', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1)]);
    addResult = new AppRpcError('MATCH_FULL', 'MATCH_FULL');
    const { dialog, onClose } = await mount();
    await user.type(within(dialog).getByLabelText('Guest name'), 'Echo');
    await user.click(addButton(dialog));
    expect(await within(dialog).findByText('No seat is free in this match.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offline: Add needs a connection', async () => {
    reachable = false;
    raw = rawDetail({}, [rawSeat(1)]);
    const { dialog } = await mount();
    expect(addButton(dialog).title).toBe('Needs a connection: open matches work online only');
  });

  it('Create customer leaves for the form in attach mode, naming this match', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1)]);
    const { dialog } = await mount();
    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/customers/new', search: { attach: 'match', match: 'm1' } });
  });
});
