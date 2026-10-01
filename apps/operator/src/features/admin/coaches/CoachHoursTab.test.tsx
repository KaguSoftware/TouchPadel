import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import { readCoachesAdmin } from '../../coaching/lessonPayloads';

// /admin/coaches › Hours (coaching operator.md §5.13.3, §5.21; C-4, CD-10,
// R73): 24:00 as an end, Copy to every day, the other-branch hint, the
// server's overlap mapped back to its window, and the time-off refusal.

const toast = vi.hoisted(() => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../components/toast', () => ({ useToast: () => toast }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CoachHoursTab } from './CoachHoursTab';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');
const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

function coach(over: Record<string, unknown> = {}) {
  return {
    coach_id: 'c1',
    profile_id: 'p1',
    display_name_en: 'Coach Sara',
    display_name_ar: 'المدرّبة سارة',
    status: 'active',
    public_accepted_at: '2026-09-30T10:00:00Z',
    venue_ids: ['v1', 'v2'],
    lesson_type_ids: [],
    prices: [],
    hours: [{ weekday: 1, start_time: '09:00:00', end_time: '13:00:00' }],
    hours_set_by: 'coach',
    hours_set_by_name: null,
    hours_updated_at: '2026-09-29T08:00:00Z',
    hours_elsewhere: [
      {
        venue_id: 'v2',
        venue_name_en: 'Mansour',
        venue_name_ar: 'المنصور',
        weekday: 1,
        start_time: '14:00:00',
        end_time: '16:00:00',
      },
    ],
    time_off: [
      {
        id: 'off1',
        starts_at: '2026-10-20T06:00:00Z',
        ends_at: '2026-10-22T21:00:00Z',
        reason: 'Tournament',
        set_by: 'staff',
        set_by_name: 'Huda',
      },
    ],
    upcoming_lessons: 0,
    open_courses: 0,
    ...over,
  };
}

const DATA = readCoachesAdmin({
  coaching_enabled: true,
  server_now: '2026-10-01T09:00:00Z',
  coaches: [
    coach(),
    coach({
      coach_id: 'c2',
      display_name_en: 'Coach Omar',
      status: 'paused',
      hours: [],
      hours_set_by: null,
      hours_elsewhere: [],
      time_off: [],
    }),
    coach({ coach_id: 'c3', display_name_en: 'Coach Huda', status: 'retired' }),
  ],
  lesson_types: [],
});

const onPickCoach = vi.fn();

function mount(coachId: string | null = 'c1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ConfirmProvider>
          <CoachHoursTab data={DATA} coachId={coachId} reachable onPickCoach={onPickCoach} />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(screen.getByRole('option', { name: option }));
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({});
  toast.ok.mockReset();
  onPickCoach.mockReset();
});

describe('CoachHoursTab', () => {
  it('lists active and paused coaches, never a retired one', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('combobox', { name: 'Coach' }));
    expect(screen.getByRole('option', { name: 'Coach Sara' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Coach Omar' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Coach Huda' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Coach Omar' }));
    expect(onPickCoach).toHaveBeenCalledWith('c2');
  });

  it('offers 24:00 as an end and sends it as one', async () => {
    const user = userEvent.setup();
    mount();
    await pick(user, 'Mon, window 1 · End', '24:00');
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(calls('set_coach_hours')).toHaveLength(1));
    expect(calls('set_coach_hours')[0]![1]).toEqual({
      p_coach_id: 'c1',
      p_venue_id: null,
      p_windows: [{ weekday: 1, start: '09:00', end: '24:00' }],
    });
  });

  it('Copy to every day sends the same window for all seven days, Sunday first', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Copy Mon to every day' }));
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(calls('set_coach_hours')).toHaveLength(1));
    const windows = (calls('set_coach_hours')[0]![1] as { p_windows: unknown[] }).p_windows;
    expect(windows).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '13:00' })),
    );
  });

  it("shows the coach's hours at another branch under the day, who set these, and warns on an overlap", async () => {
    const user = userEvent.setup();
    mount();
    const hours = within(screen.getByTestId('coach-hours'));
    expect(plain(hours.getByText(/^At .*Mansour/).textContent)).toBe('At Mansour: 14:00–16:00');
    expect(hours.getByText(/^Set by the coach on/)).toBeTruthy();
    await pick(user, 'Mon, window 1 · End', '15:00');
    expect(plain(hours.getByText(/overlaps the hours at/).textContent)).toBe(
      'Mon: overlaps the hours at Mansour. Saving may be refused.',
    );
  });

  it('an inverted window is refused before anything is sent', async () => {
    const user = userEvent.setup();
    mount();
    await pick(user, 'Mon, window 1 · Start', '15:00');
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(await screen.findByText('The window has to start before it ends.')).toBeTruthy();
    expect(calls('set_coach_hours')).toHaveLength(0);
  });

  it("HOURS_OVERLAP's window index lands on the window it names (R73)", async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(new AppRpcError('HOURS_OVERLAP', 'HOURS_OVERLAP', undefined, '1'));
    mount();
    await user.click(screen.getByRole('button', { name: 'Add a window: Wed' }));
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(calls('set_coach_hours')).toHaveLength(1));
    // Sent: Mon (index 0), Wed (index 1).
    const wednesday = within(screen.getByRole('listitem', { name: 'Wed' }));
    expect(plain((await wednesday.findByRole('alert')).textContent)).toBe(
      "Wed: these hours overlap the coach's hours here or at another branch.",
    );
    expect(within(screen.getByRole('listitem', { name: 'Mon' })).queryByRole('alert')).toBeNull();
  });

  it('adds time off in the branch time zone, and TIME_OFF_HAS_LESSONS names the count', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(
      new AppRpcError('TIME_OFF_HAS_LESSONS', 'TIME_OFF_HAS_LESSONS', undefined, '3'),
    );
    mount();
    const panel = within(screen.getByTestId('coach-time-off'));
    await user.click(panel.getByRole('button', { name: 'Add time off' }));
    fireEvent.change(panel.getByLabelText('From · Date'), { target: { value: '2026-10-13' } });
    fireEvent.change(panel.getByLabelText('To · Date'), { target: { value: '2026-10-15' } });
    await user.type(panel.getByRole('textbox', { name: /^Reason/ }), 'Away');
    await user.click(panel.getByRole('button', { name: 'Add time off' }));
    await waitFor(() => expect(calls('add_coach_time_off')).toHaveLength(1));
    // 00:00 on the 13th to 24:00 on the 15th, Baghdad (UTC+3).
    expect(calls('add_coach_time_off')[0]![1]).toEqual({
      p_coach_id: 'c1',
      p_starts_at: '2026-10-12T21:00:00.000Z',
      p_ends_at: '2026-10-15T21:00:00.000Z',
      p_reason: 'Away',
    });
    expect(plain((await panel.findByText(/in that time/)).textContent)).toBe(
      'Coach Sara has 3 lessons in that time. Cancel or move them first.',
    );
  });

  it('lists time off to come and cancels a row after asking', async () => {
    const user = userEvent.setup();
    mount();
    const panel = within(screen.getByTestId('coach-time-off'));
    expect(plain(panel.getByText(/Tournament/).closest('li')?.textContent)).toContain(
      'set by Huda',
    );
    expect(plain(panel.getByText(/Tournament/).closest('li')?.textContent)).toContain('24:00');
    await user.click(panel.getByRole('button', { name: /^Cancel time off/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Cancel this time off?' })).getByRole(
        'button',
        { name: 'Cancel time off' },
      ),
    );
    await waitFor(() => expect(calls('cancel_coach_time_off')).toHaveLength(1));
    expect(calls('cancel_coach_time_off')[0]![1]).toEqual({ p_id: 'off1' });
  });
});
