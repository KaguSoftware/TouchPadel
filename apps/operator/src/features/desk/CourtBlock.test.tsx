import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { appRpc } from '../../lib/appRpc';
import { canAccess } from '../../lib/auth';
import { CourtBlockScreen } from './CourtBlock';

// The event mode of /desk/block (build-contracts-2026-09-23 §5.5) over a real
// query client: the courts and times from tournament_context, a first block
// that meets a booking and writes nothing, a second that blocks everything
// left, and the courts step sent with the blocks. The RPCs are mocked at
// appRpc; the router and the venue settings at their hooks.

const RUN = '0e000000-0000-4000-8000-000000000001';
const STEP = '0e000000-0000-4000-8000-000000000002';
const C1 = '0c000000-0000-4000-8000-000000000001';
const C2 = '0c000000-0000-4000-8000-000000000002';
const BOOKING = '0b000000-0000-4000-8000-000000000001';

const search: { run?: string; step?: string } = { run: RUN, step: STEP };
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  useSearch: () => search,
}));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    code = 'UNKNOWN';
  },
  appRpc: vi.fn(),
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role: 'court_desk' } }) };
});
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: vi.fn(async () => ({ timezone: 'Asia/Baghdad', opening_hours: {} })),
  fetchActiveCourts: vi.fn(async () => []),
}));

const rpc = vi.mocked(appRpc);

const RANGE = { from: '2099-10-09T15:00:00+00:00', to: '2099-10-09T19:00:00+00:00' };
const blocked: Array<{ reservation_id: string; court_id: string; start_at: string; end_at: string }> = [];
const context = () => ({
  name_en: 'Summer Cup',
  name_ar: 'كأس الصيف',
  class: 'A',
  format: 'americano',
  capacity: { unit: 'pairs', count: 16 },
  ranges: [{ court_ids: [C1, C2], court_names: [{ en: 'Court 1', ar: 'ملعب ١' }, { en: 'Court 2', ar: 'ملعب ٢' }], ...RANGE }],
  blocked: [...blocked],
});
let stepStatus = 'open';
let blockCalls = 0;

beforeEach(() => {
  navigateSpy.mockReset();
  blocked.length = 0;
  stepStatus = 'open';
  blockCalls = 0;
  search.run = RUN;
  search.step = STEP;
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'protocol_step_detail') {
      return { run: { id: RUN, kind: 'tournament' }, step: { step_key: 'courts', status: stepStatus }, can: { submit: stepStatus === 'open' } };
    }
    if (fn === 'tournament_context') return context();
    if (fn === 'block_courts_for_event') {
      blockCalls += 1;
      if (blockCalls === 1) {
        return { blocked: [], conflicts: [{ reservation_id: BOOKING, court_id: C1, start_at: RANGE.from, end_at: '2099-10-09T16:00:00+00:00', kind: 'booking', status: 'confirmed' }] };
      }
      const made = (args?.p_blocks as Array<{ court_id: string; start_at: string; end_at: string }>).map((b, i) => ({
        reservation_id: `0d000000-0000-4000-8000-00000000000${i + 1}`,
        ...b,
      }));
      blocked.push(...made);
      return { blocked: made, conflicts: [] };
    }
    if (fn === 'submit_step') return { submission_id: 's1', auto: false, step_status: 'submitted', run_status: 'active', opened_step_ids: [] };
    return null;
  });
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CourtBlockScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('/desk/block event mode', () => {
  it('lists the plan’s courts and times, lists what is in the way, then blocks everything and sends the step', async () => {
    const user = userEvent.setup();
    renderScreen();
    const table = await screen.findByRole('table', { name: 'Courts and times' });
    expect(within(table).getByText('Court 1')).toBeTruthy();
    expect(within(table).getByText('Court 2')).toBeTruthy();
    expect(within(table).getAllByText('To block')).toHaveLength(2);
    expect(screen.getByText('Class A · 16 pairs')).toBeTruthy();
    // Nothing is blocked yet, so the step cannot be sent.
    expect(screen.getByRole('button', { name: 'Send courts step' })).toHaveProperty('disabled', true);

    // A booking is in the way: nothing blocked, the booking listed with a way to it.
    await user.click(screen.getByRole('button', { name: 'Block all (2)' }));
    const conflict = await screen.findByRole('alert');
    expect(within(conflict).getByText(/Court 1/)).toBeTruthy();
    expect(within(conflict).getByText(/Booking/)).toBeTruthy();
    await user.click(within(conflict).getByRole('button', { name: 'Open booking' }));
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/bookings/$id', params: { id: BOOKING } });
    const first = rpc.mock.calls.find(([fn]) => fn === 'block_courts_for_event')![1] as Record<string, unknown>;
    expect(first.p_run_id).toBe(RUN);
    expect(first.p_blocks).toEqual([
      { court_id: C1, start_at: RANGE.from, end_at: RANGE.to },
      { court_id: C2, start_at: RANGE.from, end_at: RANGE.to },
    ]);
    expect(String(first.p_idempotency_key)).toMatch(/^event\.block:/);

    // Moved: checking again blocks both, with a fresh key (the conflict was an answer).
    await user.click(within(conflict).getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Blocked. The calendar shows them now.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Courts and times' })).getAllByText('Blocked')).toHaveLength(2));
    const keys = rpc.mock.calls.filter(([fn]) => fn === 'block_courts_for_event').map(([, a]) => (a as Record<string, unknown>).p_idempotency_key);
    expect(new Set(keys).size).toBe(2);
    expect(screen.getByText('Every court and time in the plan is blocked.')).toBeTruthy();

    // The courts step goes with every block and the note. The note is marked
    // optional beside its label, not inside its accessible name.
    await user.type(screen.getByRole('textbox', { name: 'What was moved' }), 'Moved one booking to Saturday');
    await user.click(screen.getByRole('button', { name: 'Send courts step' }));
    expect(await screen.findByText('Sent. A manager checks the courts step next.')).toBeTruthy();
    const sent = rpc.mock.calls.find(([fn]) => fn === 'submit_step')![1] as Record<string, unknown>;
    expect(sent).toMatchObject({
      p_run_step_id: STEP,
      p_record: { reservation_ids: blocked.map((b) => b.reservation_id), moved_note: 'Moved one booking to Saturday' },
    });
    // Back: the desk cannot open Protocols, so My tasks once it may open it
    // (D2 widens /tasks), the calendar until then.
    await user.click(screen.getAllByRole('button', { name: 'Back to the tournament' })[0]!);
    expect(navigateSpy).toHaveBeenLastCalledWith(canAccess('court_desk', '/tasks') ? { to: '/tasks' } : { to: '/desk', search: {} });
  });

  it('with part of the plan already held, it offers only the rest and says what is still open', async () => {
    blocked.push({ reservation_id: '0d000000-0000-4000-8000-000000000001', court_id: C1, start_at: RANGE.from, end_at: RANGE.to });
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Block the rest (1)' })).toBeTruthy();
    expect(screen.getByText('Not blocked yet: 1 of the plan’s times. Block them first, or say why in the note.')).toBeTruthy();
    // One block is enough to send, with the note saying why the rest is not held.
    expect(screen.getByRole('button', { name: 'Send courts step' })).toHaveProperty('disabled', false);
  });

  it('a step that is not open is read only, and says what it is', async () => {
    stepStatus = 'submitted';
    renderScreen();
    expect(await screen.findByText('This courts step is not open, so nothing can be blocked here. It is: Awaiting decision.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Block (all|the rest)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send courts step' })).toBeNull();
  });

  it('without run and step it is the plain maintenance form', async () => {
    delete search.run;
    delete search.step;
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Block court' })).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith('tournament_context', expect.anything());
  });
});
