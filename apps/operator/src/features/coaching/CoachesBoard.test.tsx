import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { LocaleProvider } from '../../lib/i18n';
import { appRpc } from '../../lib/appRpc';
import { CoachesBoardScreen } from './CoachesBoard';
import type * as UseCoaching from './useCoaching';

// The court desk's Coaches tab (0356) over a real query client: the night is
// fixed at the hook, the reads are mocked at appRpc, the router and the
// station's reach at their hooks.

const TZ = 'Asia/Baghdad';
// A Sunday (weekday 0), far enough ahead that every start is in the future.
const DATE = '2099-10-18';
const at = (hh: number, mm = 0) => wallTimeToUtc(DATE, hh * 60 + mm, TZ).toISOString();

const { navigateSpy, runLessons } = vi.hoisted(() => ({ navigateSpy: vi.fn(), runLessons: { on: true } }));

vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {},
  isRpcMissing: () => false,
  appRpc: vi.fn(async (fn: string) => {
    if (fn === 'desk_coach_schedule') return schedule;
    if (fn === 'desk_lessons') return desk;
    if (fn === 'coach_slots') {
      return {
        off: false,
        venue_id: 'v1',
        lesson_type_id: 'p60',
        duration_min: 60,
        bookable: true,
        starts: [
          { start_at: at(12), end_at: at(13) },
          { start_at: at(12, 30), end_at: at(13, 30) },
        ],
      };
    }
    return [];
  }),
}));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable: true }) }));
vi.mock('../../components/toast', () => ({
  useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('./useCoaching', async (orig) => {
  const real = await orig<typeof UseCoaching>();
  return {
    ...real,
    useCoachingCaps: () => ({ ...real.coachingCapsFor('court_desk'), runLessons: runLessons.on }),
  };
});
vi.mock('../desk/useTradingNight', () => ({
  todayInTz: () => DATE,
  tonightInTz: () => DATE,
  useTradingNight: () => ({
    date: DATE,
    tz: TZ,
    settingsQ: {
      data: { timezone: TZ, opening_hours: {} },
      isSuccess: true,
    },
    courts: [{ id: 'c1', name_en: 'Court 1', name_ar: 'الملعب 1', duration_options: [60], sort_order: 1 }],
    openMin: 9 * 60,
    closeMin: 24 * 60,
    dayStart: new Date(wallTimeToUtc(DATE, 0, TZ)),
    dayEnd: new Date(wallTimeToUtc(DATE, 24 * 60, TZ)),
    closed: false,
  }),
}));

const schedule = {
  venue_id: 'v1',
  timezone: TZ,
  server_now: at(9),
  coaches: [
    {
      coach_id: 'sara',
      display_name_en: 'Coach Sara',
      display_name_ar: 'المدرّبة سارة',
      status: 'active',
      photo_path: null,
      hours: [{ weekday: 0, start_time: '10:00', end_time: '14:00' }],
      time_off: [],
      busy: [{ lesson_id: 'l1', here: true, start_at: at(10), end_at: at(11) }],
    },
    {
      coach_id: 'omar',
      display_name_en: 'Coach Omar',
      display_name_ar: 'المدرّب عمر',
      status: 'paused',
      photo_path: null,
      hours: [],
      time_off: [],
      busy: [],
    },
  ],
};

const coach = (id: string, name: string, status = 'active') => ({
  coach_id: id,
  display_name_en: name,
  display_name_ar: name,
  status,
  photo_path: null,
  public_accepted: true,
  lesson_type_ids: ['p60'],
  prices: [{ lesson_type_id: 'p60', price_iqd: 30000 }],
});

const desk = {
  venue_id: 'v1',
  coaching_enabled: true,
  lesson_payment_mode: 'desk',
  server_now: at(9),
  coaches: [coach('sara', 'Coach Sara'), coach('omar', 'Coach Omar', 'paused')],
  lesson_types: [
    {
      lesson_type_id: 'p60',
      kind: 'private',
      name_en: 'Private 60 min',
      name_ar: 'خاصة 60 دقيقة',
      duration_min: 60,
      price_iqd: 30000,
      max_places: 2,
      min_places: 1,
      cutoff_hours: 0,
      sessions_count: 1,
    },
  ],
  lessons: [
    {
      lesson_id: 'l1',
      court_id: 'c1',
      court_name_en: 'Court 1',
      court_name_ar: 'الملعب 1',
      kind: 'private',
      status: 'scheduled',
      start_at: at(10),
      end_at: at(11),
      coach_id: 'sara',
      coach_name_en: 'Coach Sara',
      coach_name_ar: 'المدرّبة سارة',
      lesson_type_id: 'p60',
      type_name_en: 'Private 60 min',
      type_name_ar: 'خاصة 60 دقيقة',
      label: 'Walk In',
      party_size: 1,
    },
  ],
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CoachesBoardScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

beforeEach(() => {
  runLessons.on = true;
  vi.mocked(appRpc).mockClear();
  navigateSpy.mockClear();
});

describe('CoachesBoardScreen', () => {
  it("shows each coach's hours, lessons and free times, and a paused coach without them", async () => {
    show();
    const sara = (await screen.findByRole('heading', { name: 'Coach Sara' })).closest('section')!;
    expect(plain(sara.textContent)).toContain('Works 10:00 AM–2:00 PM');
    await within(sara).findByRole('button', { name: '12:00 PM' });
    expect(within(sara).getByRole('button', { name: '12:30 PM' })).toBeTruthy();
    expect(plain(sara.textContent)).toContain('Free times · Private 60 min');
    const omar = screen.getByRole('heading', { name: 'Coach Omar' }).closest('section')!;
    expect(plain(omar.textContent)).toContain('Paused: not taking lessons');
    expect(within(omar).queryByRole('button', { name: 'New lesson' })).toBeNull();
    expect(vi.mocked(appRpc).mock.calls.filter(([fn]) => fn === 'coach_slots')).toHaveLength(1);
  });

  it('opens New lesson on the coach, type and start of a pressed free time', async () => {
    const user = userEvent.setup();
    show();
    const sara = (await screen.findByRole('heading', { name: 'Coach Sara' })).closest('section')!;
    await user.click(await within(sara).findByRole('button', { name: '12:30 PM' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Coach' }).textContent).toContain('Coach Sara');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '12:30 PM' }).getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('opens a lesson from its row', async () => {
    const user = userEvent.setup();
    show();
    const sara = (await screen.findByRole('heading', { name: 'Coach Sara' })).closest('section')!;
    const row = await within(sara).findByRole('button', { name: /Walk In/ });
    await user.click(row);
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/lessons/$id', params: { id: 'l1' } });
  });

  it('shows free times but no booking when the person cannot run lessons', async () => {
    runLessons.on = false;
    show();
    const sara = (await screen.findByRole('heading', { name: 'Coach Sara' })).closest('section')!;
    const chip = (await within(sara).findByRole('button', { name: '12:00 PM' })) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(within(sara).queryByRole('button', { name: 'New lesson' })).toBeNull();
  });
});
