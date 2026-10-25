/**
 * The leaderboard (migration 0364). See `src/smoke/auth.smoke.test.tsx` for what a case asserts
 * and `src/test/smokeCase.tsx` for how.
 *
 * The route cases seed the PARSED reads under `ranksKeys`, so the first render draws the podium,
 * the rest of the board and the guest's own place. After them, the states a first render cannot
 * show under one primary: signed out, the board switched off, a score waiting on the guest, and
 * the report form refusing to send until every player is known.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { ranksKeys } from '../features/ranks/keys';
import { parseBoard, parseMyRanks } from '../features/ranks/logic';
import ClubScreen from '../../app/(tabs)/club';
import { RanksView } from '../features/ranks/RanksView';
import RanksReportScreen from '../../app/ranks-report';

type Seeds = [readonly unknown[], unknown][];

const level = (name_en: string, name_ar: string, min_points: number) => ({ name_en, name_ar, min_points });

const boardFixture = (over: Record<string, unknown> = {}) =>
  parseBoard({
    enabled: true,
    period: 'month',
    from: '2026-09-30T21:00:00Z',
    size: 10,
    rows: [
      { rank: 1, name: 'Sara M.', points: 24, level: level('Contender', 'منافس', 60), mine: false },
      { rank: 2, name: 'Ali K.', points: 20, level: level('Rising', 'صاعد', 20), mine: false },
      { rank: 3, name: 'Omar H.', points: 18, level: level('Rising', 'صاعد', 20), mine: false },
      { rank: 4, name: 'Zainab R.', points: 12, level: level('Rookie', 'مبتدئ', 0), mine: true },
      { rank: 5, name: null, points: 9, level: level('Rookie', 'مبتدئ', 0), mine: false },
    ],
    ...over,
  });

const player = (name: string, username: string, me = false) => ({ name, username, former: false, me });

const mineFixture = (over: Record<string, unknown> = {}) =>
  parseMyRanks({
    enabled: true,
    period: 'month',
    from: '2026-09-30T21:00:00Z',
    size: 10,
    points: 12,
    lifetime: 34,
    rank: 4,
    level: level('Rising', 'صاعد', 20),
    next_level: level('Contender', 'منافس', 60),
    rules: { win: 2, loss: 1, draw: 1, report_hours: 48, reports: true },
    username: 'zainab',
    results: [
      {
        id: 'res-wait',
        source: 'player',
        status: 'pending',
        played_at: '2026-10-21T18:00:00Z',
        score: '6-4, 6-3',
        outcome: 'lost',
        us: [player('Zainab R.', 'zainab', true), player('Noor A.', 'noor')],
        them: [player('Sara M.', 'sara'), player('Ali K.', 'ali')],
        reported_by_me: false,
        can_confirm: true,
        expires_at: '2026-10-23T18:00:00Z',
        points: 0,
      },
      {
        id: 'res-won',
        source: 'desk',
        status: 'confirmed',
        played_at: '2026-10-19T18:00:00Z',
        score: null,
        outcome: 'won',
        us: [player('Zainab R.', 'zainab', true), player('Noor A.', 'noor')],
        them: [player('Omar H.', 'omar'), null],
        reported_by_me: false,
        can_confirm: false,
        expires_at: null,
        points: 2,
      },
    ],
    to_report: [
      {
        reservation_id: 'rv-1',
        start_at: '2026-10-22T17:00:00Z',
        end_at: '2026-10-22T18:30:00Z',
        court: { name_en: 'Court 2', name_ar: 'الملعب 2' },
      },
    ],
    recent: [{ username: 'noor', name: 'Noor A.' }],
    ...over,
  });

const signedInSeeds = (mine = mineFixture()): Seeds => [
  [ranksKeys.board, boardFixture()],
  [ranksKeys.mine, mine],
];

const reportParams = {
  reservationId: 'rv-1',
  startAt: '2026-10-22T17:00:00Z',
  courtEn: 'Court 2',
  courtAr: 'الملعب 2',
};

// The leaderboard is a segment of Club (2026-10-25); its view is rendered bare here.
const RanksScreen = () => <RanksView bottomPad={0} />;

const CASES: SmokeCase[] = [
  {
    route: 'ranks-report',
    Component: RanksReportScreen,
    labelKey: 'ranks.report.submit',
    options: { session: 'in', queryData: [[ranksKeys.mine, mineFixture()]], params: reportParams },
  },
];

runSmokeCases('the leaderboard', CASES);

describe.each<Locale>(['en', 'ar'])('Club carries the leaderboard in %s', (locale) => {
  const t = makeT(locale);

  it('offers Ranks between the member card and the café menu, and opens it on a show=ranks', () => {
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      params: { show: 'ranks' },
      queryData: signedInSeeds(),
    });
    try {
      const labels = [t('loyalty.guest.card.title'), t('tabs.ranks'), t('profile.cafeMenu')];
      const view = screen.getByTestId('club.view');
      for (const label of labels) expect(within(view).getByText(label)).toBeTruthy();
      expect(screen.getByTestId('ranks.podium')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

// ── The states a first render cannot show under the primary ─────────────────

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('leaderboard states in %s', (locale) => {
  const t = makeT(locale);

  it('signed in: the board, the guest tinted on it, their place, a game to score and their games', () => {
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds() });
    try {
      expect(screen.getByTestId('ranks.podium')).toBeTruthy();
      expect(within(screen.getByTestId('ranks.board')).getAllByText(t('ranks.you')).length).toBe(1);
      expect(screen.getByTestId('ranks.me')).toBeTruthy();
      expect(screen.getByText(t('ranks.me.place'))).toBeTruthy();
      expect(screen.getByTestId('ranks.result.res-won')).toBeTruthy();
      fireEvent.press(screen.getByTestId('ranks.report.rv-1'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/ranks-report', params: reportParams },
      });
    } finally {
      screen.unmount();
    }
  });

  it('a score waiting on the guest asks first, with both answers', () => {
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds() });
    try {
      const card = screen.getByTestId('ranks.waiting.res-wait');
      expect(within(card).getByText(t('ranks.waiting.title'))).toBeTruthy();
      expect(within(screen.getByTestId('ranks.waiting.res-wait.yes')).getByText(t('ranks.waiting.yes'))).toBeTruthy();
      expect(within(screen.getByTestId('ranks.waiting.res-wait.no')).getByText(t('ranks.waiting.no'))).toBeTruthy();
      // It is not also listed among the guest's games.
      expect(screen.queryByTestId('ranks.result.res-wait')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('signed out: the board is public, and the rest asks the guest to sign in', () => {
    const screen = renderRoute(RanksScreen, {
      locale,
      session: 'out',
      queryData: [[ranksKeys.board, boardFixture()]],
    });
    try {
      expect(screen.getByTestId('ranks.podium')).toBeTruthy();
      expect(screen.queryByTestId('ranks.me')).toBeNull();
      const signIn = screen.getByTestId('ranks.sign-in');
      expect(within(signIn).getByText(t('auth.signIn'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('switched off by the owner, the tab says so and draws no board', () => {
    const screen = renderRoute(RanksScreen, {
      locale,
      session: 'out',
      queryData: [[ranksKeys.board, parseBoard({ enabled: false })]],
    });
    try {
      expect(screen.getByText(t('ranks.off.title'))).toBeTruthy();
      expect(screen.queryByTestId('ranks.podium')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('an empty board invites the first win', () => {
    const screen = renderRoute(RanksScreen, {
      locale,
      session: 'out',
      queryData: [[ranksKeys.board, boardFixture({ rows: [] })]],
    });
    try {
      expect(screen.getByText(t('ranks.empty.title'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the report form will not send until all three players are known', () => {
    const screen = renderRoute(RanksReportScreen, {
      locale,
      session: 'in',
      params: reportParams,
      queryData: [
        [ranksKeys.mine, mineFixture()],
        [ranksKeys.player('noor'), { username: 'noor', name: 'Noor A.', me: false }],
      ],
    });
    try {
      const submit = screen.getByTestId('ranks-report.submit');
      expect(submit.props.accessibilityState?.disabled).toBe(true);
      // A recent partner fills the first empty place.
      fireEvent.press(screen.getByTestId('ranks-report.recent.noor'));
      expect(screen.getByTestId('ranks-report.partner').props.value).toBe('noor');
      expect(screen.getByTestId('ranks-report.submit').props.accessibilityState?.disabled).toBe(true);
    } finally {
      screen.unmount();
    }
  });
});
