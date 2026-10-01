import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t, type MessageKey, type TParams } from '@touch/i18n';
import { LocaleProvider } from '../../lib/i18n';

// The match screen (operator.md §5.12): every banner of §5.12.1, the history
// sentences of §5.12.2, sandbox, not found, the header's actions, the requests
// of an ask-to-join match, and a customer handed back opening Add player.

const navigate = vi.fn();
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };
let search: Record<string, string> = {};

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ id: 'm1' }),
  useSearch: () => search,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/realtime', () => ({ useBroadcast: vi.fn() }));
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: vi.fn(async () => ({ timezone: 'Asia/Baghdad' })),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role: 'court_desk' } }) };
});
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable: true }) }));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { MATCH_EVENT_TYPES } from './matchLogic';
import { readMatchDetail, type MatchEvent } from './matchPayloads';
import { bannerOf, eventSentence, MatchDetailScreen } from './MatchDetail';

const rpc = vi.mocked(appRpc);
type Raw = Record<string, unknown>;
const en = (key: MessageKey, params?: TParams) => t('en', key, params);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩]/g, '');

function rawSeat(no: number, over: Raw = {}): Raw {
  return { seat_id: `s${no}`, seat_no: no, kind: 'desk', status: 'in', carrying: true, full_name: `Player ${no}`, can: {}, ...over };
}

function rawDetail(match: Raw, seats: Raw[] = [rawSeat(1), rawSeat(2)], rest: Raw = {}): Raw {
  return {
    match: {
      id: 'm1',
      status: 'filling',
      ended_reason: null,
      start_at: '2026-10-01T18:00:00.000Z',
      end_at: '2026-10-01T19:30:00.000Z',
      category: 'open',
      join_policy: 'open',
      visibility: 'public',
      shares_iqd: [10000, 10000, 10000, 10000],
      fill_deadline_at: '2026-10-01T16:00:00.000Z',
      share_token: 'tok123',
      reservation_id: null,
      court_id: null,
      court_name_en: 'Indoor Court 1',
      court_name_ar: 'الملعب الداخلي 1',
      sandbox: false,
      started: false,
      marks_open: true,
      server_now: '2026-10-01T15:00:00.000Z',
      can: { add_seat: true, cancel: true, call_off: false },
      ...match,
    },
    seats,
    requests: [],
    money: null,
    events: [],
    ...rest,
  };
}

let raw: Raw | Error;
const calls: { fn: string; args: Record<string, unknown> }[] = [];
let cancelAnswer: () => unknown;

beforeEach(() => {
  search = {};
  calls.length = 0;
  navigate.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  cancelAnswer = () => ({ status: 'cancelled' });
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'desk_match_detail') {
      if (raw instanceof Error) throw raw;
      return structuredClone(raw);
    }
    if (fn === 'desk_cancel_match') return cancelAnswer();
    if (fn === 'customer_record') return { customer: { id: 'c9', full_name: 'Noor Salem', phone: null, email: null, preferred_lang: 'ar' }, flags: [] };
    return [];
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MatchDetailScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('bannerOf (§5.12.1)', () => {
  const banner = (match: Raw, seats?: Raw[]) => {
    const b = bannerOf(readMatchDetail(rawDetail(match, seats))!, en, 'en', 'Asia/Baghdad');
    return { ...b, text: plain(b.text) };
  };

  it('filling: the count, what is missing and the deadline', () => {
    const b = banner({ status: 'filling' }, [rawSeat(1), rawSeat(2), rawSeat(3)]);
    expect(b.tone).toBe('info');
    expect(b.text).toMatch(/^Players 3 of 4 · needs one player more by /);
  });

  it('awaiting a court, and booked on its court', () => {
    expect(banner({ status: 'awaiting_court' }).text).toMatch(/^All four are in\. The last free court is held by a guest who is paying/);
    expect(banner({ status: 'booked', court_id: 'c1' }).text).toBe('Booked on Indoor Court 1');
  });

  it.each([
    ['played', null, 'Played', 'success'],
    ['no_show', 'all_no_show', 'Nobody came. Every ticket in it was lost.', 'refused'],
    ['cancelled', 'organiser_cancelled', 'Cancelled by the organiser. Tickets went back.', 'refused'],
    ['cancelled', 'staff_cancelled', 'Cancelled at the desk. Tickets went back.', 'refused'],
    ['cancelled', 'reservation_cancelled', 'The booking was cancelled. Tickets went back; no-show tickets were given back too.', 'refused'],
    ['cancelled', 'called_off_short', 'Called off: a player was missing. Players who came kept their tickets.', 'refused'],
    ['cancelled', 'empty', 'Everyone left before it filled.', 'refused'],
    ['cancelled', 'venue_closed', 'The branch is closed at that time. Tickets went back.', 'refused'],
    ['bumped', 'bumped', 'A booking took the last free court. Tickets went back.', 'refused'],
    ['bumped', 'no_court', 'No court offers this length any more. Tickets went back.', 'refused'],
    ['expired', 'deadline', 'Not full by the deadline. Tickets went back.', 'refused'],
    ['expired', 'no_court', 'Four players, but no court came free. Tickets went back.', 'refused'],
  ])('%s / %s', (status, reason, text, tone) => {
    const b = banner({ status, ended_reason: reason });
    expect(b.text).toBe(text);
    expect(b.tone).toBe(tone);
  });

  it('an unknown status prints raw, neutral', () => {
    expect(banner({ status: 'archived' })).toEqual({ tone: 'info', text: 'archived' });
  });
});

describe('eventSentence (§5.12.2)', () => {
  const event = (over: Partial<MatchEvent>): MatchEvent => ({ at: null, type: 'started', actor: 'u1', actor_name: 'Sara', seat_no: null, code: null, ...over });

  it('every known type has its own sentence, with the actor appended', () => {
    for (const type of MATCH_EVENT_TYPES) {
      const s = plain(eventSentence(event({ type, seat_no: 2, code: 'conduct' }), en));
      expect(s.endsWith(' · Sara'), type).toBe(true);
      expect(s, type).not.toContain('ws.matches.events');
    }
    expect(plain(eventSentence(event({ type: 'removed', seat_no: 3, code: 'conduct' }), en))).toBe('Seat 3 removed (Conduct) · Sara');
    expect(plain(eventSentence(event({ type: 'seat_no_show', seat_no: 4 }), en))).toBe('Seat 4 marked no-show · Sara');
  });

  it("a removal by the organiser or the ban sweep, and a quick message, read words rather than the DB's codes", () => {
    expect(plain(eventSentence(event({ type: 'removed', seat_no: 2, code: 'removed_by_organiser' }), en))).toBe('Seat 2 removed (by the organiser) · Sara');
    expect(eventSentence(event({ type: 'removed', seat_no: 2, code: 'banned', actor: 'system', actor_name: null }), en)).toBe(
      'Seat 2 removed (banned from open matches) · automatic',
    );
    expect(plain(eventSentence(event({ type: 'message', code: 'running_late' }), en))).toBe('Quick message (Running late) · Sara');
  });

  it('an automatic event reads "automatic"; an unknown type its raw word', () => {
    expect(eventSentence(event({ type: 'expired', actor: null, actor_name: null }), en)).toBe('Deadline passed · automatic');
    expect(eventSentence(event({ type: 'bumped', actor: 'system', actor_name: null }), en)).toBe('Cancelled by a booking · automatic');
    expect(plain(eventSentence(event({ type: 'teleported' }), en))).toBe('teleported · Sara');
  });
});

describe('MatchDetailScreen', () => {
  it('a filling match: header, banner, Players, invite link and history', async () => {
    const user = userEvent.setup();
    raw = rawDetail(
      { visibility: 'link', join_policy: 'approve' },
      [rawSeat(1), rawSeat(2)],
      {
        requests: [{ request_id: 'q1', full_name: 'Omar Khalid', phone: '0770 123 4567', flags: [], seats_requested: 2, games_played: 12, no_shows: 1, created_at: '2026-10-01T14:40:00.000Z' }],
        events: [{ at: '2026-10-01T14:00:00.000Z', type: 'started', actor: 'u1', actor_name: 'Desk Ali' }],
      },
    );
    mount();
    expect(await screen.findByText(/^Players 2 of 4 · needs/)).toBeTruthy();
    expect(screen.getByText('Needs players')).toBeTruthy();
    expect(screen.getByText(/^Closes /)).toBeTruthy();
    expect(screen.getByText('Ask to join')).toBeTruthy();
    expect(screen.getByText('Link only')).toBeTruthy();
    // Players panel: four rows.
    expect(await screen.findAllByTestId(/^seat-\d$/)).toHaveLength(4);
    // Requests, read only.
    expect(screen.getByText('Requests 1')).toBeTruthy();
    expect(screen.getByText('The organiser answers requests in the app.')).toBeTruthy();
    expect(screen.getByText('Seats 2')).toBeTruthy();
    expect(screen.getByText('Games 12')).toBeTruthy();
    expect(screen.getByText('No-shows 1')).toBeTruthy();
    // Invite link.
    expect(screen.getByText(/\/m\/tok123$/)).toBeTruthy();
    expect(screen.getByText('Only people with this link can find it.')).toBeTruthy();
    // History.
    expect(plain(screen.getByText(/Match started/).textContent)).toBe('Match started · Desk Ali');
    await user.click(screen.getAllByRole('button', { name: 'Copy invite link' })[0]!);
    await waitFor(() => expect(toast.ok).toHaveBeenCalledWith('Link copied'));
  });

  it('a sandbox match says so and offers nothing', async () => {
    raw = rawDetail({ sandbox: true, can: { add_seat: false, cancel: false, call_off: false } }, [rawSeat(1)]);
    mount();
    // Said once, above the panel.
    expect(await screen.findAllByText('Test match: not a real booking. Nothing here can be changed.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Copy invite link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel match' })).toBeNull();
    expect(within(await screen.findByTestId('match-players')).queryAllByRole('button')).toHaveLength(0);
  });

  it('not found: says the match is not at this branch, with a way back to Today', async () => {
    const user = userEvent.setup();
    raw = new AppRpcError('MATCH_NOT_FOUND', 'MATCH_NOT_FOUND');
    mount();
    expect(await screen.findByText("That open match isn't at this branch.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to Today' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/today' });
  });

  it('a server without matches (RPC_MISSING) reads the same, never "offline"', async () => {
    raw = new AppRpcError('RPC_MISSING', 'PGRST202');
    mount();
    expect(await screen.findByText("That open match isn't at this branch.")).toBeTruthy();
    expect(screen.queryByText("Open matches can't be shown without a connection")).toBeNull();
  });

  it('a booked match opens its booking; there is no Cancel match', async () => {
    const user = userEvent.setup();
    raw = rawDetail({ status: 'booked', reservation_id: 'r1', court_id: 'c1', can: { add_seat: false, cancel: false, call_off: false } });
    mount();
    expect(await screen.findByText(/^Booked on .Indoor Court 1.$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel match' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open booking' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/bookings/$id', params: { id: 'r1' } });
  });

  it('Cancel match sends the reason form; a match that booked meanwhile points at its booking', async () => {
    const user = userEvent.setup();
    raw = rawDetail({});
    mount();
    await user.click(await screen.findByRole('button', { name: 'Cancel match' }));
    const prompt = await screen.findByRole('dialog');
    expect(within(prompt).getByText('Cancels the match for everyone in it. Tickets go back to the players; nobody is charged.')).toBeTruthy();
    await user.type(within(prompt).getByLabelText(/note/i), 'Asked by phone');
    await user.click(within(prompt).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(calls.find((c) => c.fn === 'desk_cancel_match')?.args).toEqual({ p_match_id: 'm1', p_reason: 'customer_request: Asked by phone' }));
    expect(toast.ok).toHaveBeenCalledWith('Match cancelled.');
  });

  it('MATCH_NOT_FILLING closes the prompt and says a booked match is changed from its booking', async () => {
    const user = userEvent.setup();
    raw = rawDetail({});
    cancelAnswer = () => {
      raw = rawDetail({ status: 'booked', reservation_id: 'r1', court_id: 'c1', can: { add_seat: false, cancel: false, call_off: false } });
      throw new AppRpcError('MATCH_NOT_FILLING', 'MATCH_NOT_FILLING');
    };
    mount();
    await user.click(await screen.findByRole('button', { name: 'Cancel match' }));
    const prompt = await screen.findByRole('dialog');
    await user.click(within(prompt).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText("This match isn't filling any more. A booked match is changed from its booking.")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open booking' }).length).toBeGreaterThan(0));
  });

  it('a customer handed back (?customer=) opens Add player with them picked', async () => {
    search = { customer: 'c9' };
    raw = rawDetail({});
    mount();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/Linked to Noor Salem/)).toBeTruthy());
  });
});
