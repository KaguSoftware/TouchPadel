/**
 * The leaderboard (migration 0364; 0444 Touch Level, Season Race and the four boards). See `src/smoke/auth.smoke.test.tsx` for what a case asserts
 * and `src/test/smokeCase.tsx` for how.
 *
 * The route cases seed the PARSED reads under `ranksKeys`, so the first render draws the podium,
 * the rest of the board and the guest's own level and Race place. After them, the states a first
 * render cannot show under one primary: the board switch and its empty boards, "How ranking
 * works", an older server's board, signed out, the board switched off, a score waiting on the
 * guest, and the report form refusing to send until every player is known.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { countPhrase, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { ranksKeys } from '../features/ranks/keys';
import { parseBoard, parseMyRanks } from '../features/ranks/logic';
import RanksTab from '../../app/(tabs)/ranks';
import { RanksView } from '../features/ranks/RanksView';
import RanksReportScreen from '../../app/ranks-report';
import CoachModeResult from '../../app/(coach-mode)/coach-mode-result';
import { coachMeFixture } from '../test/coachFixtures';
import { supabase } from '../lib/supabase';

type Seeds = [readonly unknown[], unknown][];

const tier = (name_en: string, name_ar: string, min_level: number) => ({ name_en, name_ar, min_level, min_points: 0 });
const ELITE = tier('Elite', 'نخبة', 4);
const CONTENDER = tier('Contender', 'منافس', 3);
const RISING = tier('Rising', 'صاعد', 2);
const ROOKIE = tier('Rookie', 'مبتدئ', 0);

/** app.ranks_public_rules: the defaults (plan §3, §6, §7). */
const RULES = {
  reliable_games: 6, reliable_opponents: 4, reliable_days: 90, inactive_days: 45, provisional_games: 5,
  improved_days: 30, improved_min_games: 4, class_b_from: 2.5, class_a_from: 4, race_win: 10, race_loss: 2,
  race_draw: 4, race_strength_max: 2, race_best_matches: 8, race_best_tournaments: 2, boost_offpeak: 1.5,
  boost_event: 2, boost_welcome: 1.5, boost_max_per_season: 3,
};

/** app.ranks_board() as 0444 sends it: the Race leads (the default headline). */
const boardFixture = (over: Record<string, unknown> = {}) =>
  parseBoard({
    enabled: true,
    headline: 'race',
    show_level: true,
    period: 'quarter',
    from: '2026-09-30T21:00:00Z',
    size: 10,
    race: [
      { rank: 1, name: 'Sara M.', points: 64, level: 4.3, tier: ELITE, class: 'A', mine: false },
      { rank: 2, name: 'Ali K.', points: 50, level: 3.4, tier: CONTENDER, class: 'B', mine: false },
      { rank: 3, name: 'Omar H.', points: 41, level: 2.6, tier: RISING, class: 'B', mine: false },
      { rank: 4, name: 'Zainab R.', points: 36, level: 3.1, tier: CONTENDER, class: 'B', mine: true },
      { rank: 5, name: null, points: 9, level: 1.8, tier: ROOKIE, class: 'C', mine: false },
    ],
    level: [
      { rank: 1, name: 'Sara M.', level: 4.3, tier: ELITE, class: 'A', mine: false },
      { rank: 2, name: 'Ali K.', level: 3.4, tier: CONTENDER, class: 'B', mine: false },
      { rank: 3, name: 'Omar H.', level: 2.6, tier: RISING, class: 'B', mine: false },
      { rank: 4, name: 'Noor A.', level: 2.2, tier: RISING, class: 'C', mine: false },
    ],
    classes: {
      A: [{ rank: 1, name: 'Sara M.', level: 4.3, tier: ELITE, mine: false }],
      B: [
        { rank: 1, name: 'Ali K.', level: 3.4, tier: CONTENDER, mine: false },
        { rank: 2, name: 'Omar H.', level: 2.6, tier: RISING, mine: false },
      ],
      C: [],
    },
    improved: [],
    improved_days: 30,
    rules: RULES,
    rows: [],
    ...over,
  });

const player = (name: string, username: string, me = false) => ({ name, username, former: false, me });

const mineFixture = (over: Record<string, unknown> = {}) =>
  parseMyRanks({
    enabled: true,
    headline: 'race',
    period: 'quarter',
    from: '2026-09-30T21:00:00Z',
    size: 10,
    points: 36,
    lifetime: 34,
    rank: 4,
    level: CONTENDER,
    next_level: ELITE,
    rules: { win: 10, loss: 2, draw: 4, report_hours: 48, reports: true },
    touch: {
      level: 3.12,
      show_level: true,
      rated: true,
      games: 4,
      provisional_left: 1,
      games_window: 4,
      opponents_window: 3,
      reliable: false,
      needs_games: 2,
      needs_opponents: 1,
      reliable_days: 90,
      class: 'B',
      tier: CONTENDER,
      next_tier: ELITE,
      to_next: 0.88,
      rank: null,
      higher_than_pct: 62,
      history: [
        { played_at: '2026-10-10T18:00:00Z', level: 2.95 },
        { played_at: '2026-10-15T18:00:00Z', level: 3.0 },
        { played_at: '2026-10-19T18:00:00Z', level: 3.12 },
      ],
    },
    public_rules: RULES,
    race: {
      points: 36,
      rank: 4,
      matches: 12,
      matches_counted: 8,
      best_matches: 8,
      tournaments: 0,
      best_tournaments: 2,
      boosts_used: 1,
      boosts_max: 3,
    },
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
        points: 15,
        level_change: 0.12,
        boost: 'offpeak',
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

// The states below render the shared view bare; the tab itself is cased in CASES.
const RanksScreen = () => <RanksView bottomPad={0} />;

const CASES: SmokeCase[] = [
  // Rankings, the bar's first tab (2026-11-12). Signed out the board is public and the sign-in
  // sits under it.
  {
    route: 'ranks',
    Component: RanksTab,
    labelKey: 'auth.signIn',
    nearbyKey: 'tabs.ranks',
    options: { session: 'out', queryData: [[ranksKeys.board, boardFixture()]] },
  },
  {
    route: 'ranks-report',
    Component: RanksReportScreen,
    labelKey: 'ranks.report.submit',
    options: { session: 'in', queryData: [[ranksKeys.mine, mineFixture()]], params: reportParams },
  },
  // A coach enters a game they watched (0444), from coach mode's actions.
  {
    route: 'coach-mode-result',
    Component: CoachModeResult,
    labelKey: 'coaching.coach.result.submit',
    options: { coach: coachMeFixture() },
  },
];

runSmokeCases('the leaderboard', CASES);

describe.each<Locale>(['en', 'ar'])('the Rankings tab in %s', (locale) => {
  const t = makeT(locale);

  it('titles the tab Rankings and shows the board with the guest on it', () => {
    const screen = renderRoute(RanksTab, { locale, session: 'in', queryData: signedInSeeds() });
    try {
      expect(screen.getByText(t('tabs.ranks'))).toBeTruthy();
      expect(screen.getByTestId('ranks.account')).toBeTruthy();
      expect(screen.getByTestId('ranks.podium')).toBeTruthy();
      expect(screen.getByTestId('ranks.me')).toBeTruthy();
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
      expect(screen.getByText(t('ranks.touch.title'))).toBeTruthy();
      expect(screen.getByTestId('ranks.race')).toBeTruthy();
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

  it('a long press on another player reports the name to the club by email (App Review 1.2)', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds() });
    try {
      // The guest's own row and a row with no name offer nothing.
      expect(screen.queryByTestId('ranks.board.row.4')).toBeNull();
      expect(screen.queryByTestId('ranks.board.row.5')).toBeNull();
      fireEvent(screen.getByTestId('ranks.board.row.2'), 'longPress');
      expect(alert).toHaveBeenCalledTimes(1);
      const [title, , buttons] = alert.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
      expect(title).toBe(t('ranks.reportName.title', { name: 'Ali K.' }));
      buttons.find((b) => b.text === t('ranks.reportName.send'))!.onPress!();
      const url = String(open.mock.calls[0]?.[0]);
      expect(url.startsWith('mailto:info@touch-padel.com?subject=')).toBe(true);
      expect(decodeURIComponent(url)).toContain('Ali K.');
    } finally {
      screen.unmount();
      alert.mockRestore();
      open.mockRestore();
    }
  });

  it('the guest\'s own level: the number, the percent line, what is still needed, the Race', () => {
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds() });
    try {
      expect(within(screen.getByTestId('ranks.me.level')).getByText('3.1', { exact: false })).toBeTruthy();
      // Majed's exact words, with the server's number.
      expect(
        within(screen.getByTestId('ranks.me.higher')).getByText(t('ranks.touch.higherThan', { pct: '62' }), {
          exact: false,
          normalizer: (x) => x.replace(/[\u2066-\u2069\u202A-\u202E]/g, ''),
        }),
      ).toBeTruthy();
      const standing = screen.getByTestId('ranks.me.standing');
      const games = countPhrase('ranks.count.moreGames', 2, locale);
      const players = countPhrase('ranks.count.morePlayers', 1, locale);
      expect(String(standing.props.children)).toContain(t('ranks.touch.needsBoth', { games, players }));
      expect(screen.getByTestId('ranks.race.counted')).toBeTruthy();
      // A confirmed game shows its Race points, its level change and its boost.
      const gain = screen.getByTestId('ranks.result.res-won.gain');
      // Its size from the rules in force: "Off-peak ×1.5".
      expect(
        within(gain).getByText(t('ranks.boostSized.offpeak', { x: '1.5' }), {
          normalizer: (x) => x.replace(/[\u2066-\u2069\u202A-\u202E]/g, ''),
        }),
      ).toBeTruthy();
      expect(within(gain).getByText('+0.12', { exact: false })).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('hides the percent line when the server counted nobody', () => {
    const base = mineFixture();
    if (!base.enabled || !base.touch) throw new Error('fixture');
    const mine = { ...base, touch: { ...base.touch, higherThanPct: null } };
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds(mine) });
    try {
      expect(screen.queryByTestId('ranks.me.higher')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('opens on the owner\'s headline board and switches between the four', () => {
    const screen = renderRoute(RanksScreen, {
      locale,
      session: 'in',
      queryData: [
        [ranksKeys.board, boardFixture({ headline: 'level' })],
        [ranksKeys.mine, mineFixture()],
      ],
    });
    try {
      // Level is the headline: its board, its hint, no Race points.
      expect(screen.getByTestId('ranks.view-switch')).toBeTruthy();
      expect(screen.getByText(t('ranks.board.levelHint'))).toBeTruthy();
      expect(within(screen.getByTestId('ranks.view-switch.race')).getByText(t('ranks.view.race'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('ranks.view-switch.race'));
      expect(screen.getByText(t('ranks.board.raceHint'))).toBeTruthy();
      expect(within(screen.getByTestId('ranks.board')).getAllByText(t('ranks.you')).length).toBe(1);
      // Classes opens on the guest's own class, B; C is empty and says who appears there.
      fireEvent.press(screen.getByTestId('ranks.view-switch.classes'));
      expect(screen.getByTestId('ranks.class-switch')).toBeTruthy();
      expect(within(screen.getByTestId('ranks.class-switch.B')).getByText(t('ranks.class.B'))).toBeTruthy();
      expect(screen.getByTestId('ranks.podium')).toBeTruthy();
      fireEvent.press(screen.getByTestId('ranks.class-switch.C'));
      expect(screen.getByTestId('ranks.empty-class')).toBeTruthy();
      expect(
        screen.getByText(
          t('ranks.emptyLevel.rule', { games: '6', players: '4', days: '90' }),
          { exact: false, normalizer: (x) => x.replace(/[\u2066-\u2069\u202A-\u202E]/g, '') },
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByTestId('ranks.view-switch.improved'));
      expect(screen.getByText(t('ranks.emptyImproved.title'))).toBeTruthy();
      expect(
        screen.getByText(t('ranks.emptyImproved.messageMin', { games: '4', days: '30' }), {
          normalizer: (x) => x.replace(/[\u2066-\u2069\u202A-\u202E]/g, ''),
        }),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('signed out, an empty Touch Level board still gives the rule with its numbers (board.rules)', () => {
    const screen = renderRoute(RanksScreen, {
      locale,
      session: 'out',
      queryData: [[ranksKeys.board, boardFixture({ headline: 'level', level: [] })]],
    });
    try {
      expect(screen.getByTestId('ranks.empty-level')).toBeTruthy();
      expect(
        screen.getByText(t('ranks.emptyLevel.rule', { games: '6', players: '4', days: '90' }), {
          normalizer: (x) => x.replace(/[\u2066-\u2069\u202A-\u202E]/g, ''),
        }),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('"How ranking works" says the two numbers with the server\'s figures', () => {
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds() });
    try {
      expect(within(screen.getByTestId('ranks.how')).getByText(t('ranks.how.open'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('ranks.how'));
      const sheet = screen.getByTestId('ranks.how-sheet');
      expect(within(sheet).getByText(t('ranks.how.levelTitle'))).toBeTruthy();
      expect(within(sheet).getByText(t('ranks.how.raceTitle'))).toBeTruthy();
      expect(within(sheet).getByText(t('ranks.how.raceNeverLevel'))).toBeTruthy();
      expect(
        within(sheet).getByText(t('ranks.how.raceBoostsSized', { offpeak: '1.5', welcome: '1.5', max: '3' }), {
          normalizer: (x) => x.replace(/[\u2066-\u2069\u202A-\u202E]/g, ''),
        }),
      ).toBeTruthy();
      expect(within(screen.getByTestId('ranks.how-sheet.close')).getByText(t('ranks.how.close'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('an older server (0364 rows only) still shows the Race, with no switch and no level card', () => {
    const legacyBoard = parseBoard({
      enabled: true,
      period: 'month',
      size: 10,
      rows: [
        { rank: 1, name: 'Sara M.', points: 24, level: { name_en: 'Contender', name_ar: 'منافس', min_points: 60 }, mine: false },
        { rank: 2, name: 'Ali K.', points: 20, level: { name_en: 'Rising', name_ar: 'صاعد', min_points: 20 }, mine: true },
      ],
    });
    const base = mineFixture();
    if (!base.enabled) throw new Error('fixture');
    const legacyMine = { ...base, touch: null, race: null };
    const screen = renderRoute(RanksScreen, {
      locale,
      session: 'in',
      queryData: [
        [ranksKeys.board, legacyBoard],
        [ranksKeys.mine, legacyMine],
      ],
    });
    try {
      expect(screen.getByTestId('ranks.podium')).toBeTruthy();
      expect(screen.queryByTestId('ranks.view-switch')).toBeNull();
      expect(screen.queryByTestId('ranks.me')).toBeNull();
      expect(screen.getByTestId('ranks.race')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('your type: picked by you, with Change while it is open, and the picker sends the code', async () => {
    const rpc = jest.fn((_name: string, _args?: unknown) => Promise.resolve({ data: { play_level: 'advanced' }, error: null }));
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const base = mineFixture();
    if (!base.enabled || !base.touch) throw new Error('fixture');
    const mine = { ...base, touch: { ...base.touch, selfType: 'intermediate' as const, canChangeType: true } };
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds(mine) });
    try {
      expect(
        within(screen.getByTestId('ranks.me.type.value')).getByText(
          t('ranks.myType.line', { type: t('coaching.coach.level.type.intermediate') }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('ranks.myType.self'))).toBeTruthy();
      expect(screen.queryByTestId('ranks.me.type.locked')).toBeNull();
      fireEvent.press(screen.getByTestId('ranks.me.type.change'));
      const sheet = screen.getByTestId('ranks.type-sheet');
      expect(within(sheet).getByText(t('coaching.coach.level.type.advanced'))).toBeTruthy();
      expect(screen.getByTestId('ranks.type-sheet.option.intermediate').props.accessibilityState.checked).toBe(true);
      fireEvent.press(screen.getByTestId('ranks.type-sheet.option.advanced'));
      fireEvent.press(screen.getByTestId('ranks.type-sheet.save'));
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_my_play_level', { p_level: 'advanced' }));
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('your type checked by the desk: who set it, no Change, and who to ask', () => {
    const base = mineFixture();
    if (!base.enabled || !base.touch) throw new Error('fixture');
    const mine = {
      ...base,
      touch: {
        ...base.touch,
        selfType: 'beginner' as const,
        checked: { type: 'intermediate' as const, role: 'court_desk' as const, at: '2026-11-10T10:00:00Z' },
        canChangeType: false,
      },
    };
    const screen = renderRoute(RanksScreen, { locale, session: 'in', queryData: signedInSeeds(mine) });
    try {
      expect(
        within(screen.getByTestId('ranks.me.type.value')).getByText(
          t('ranks.myType.line', { type: t('coaching.coach.level.type.intermediate') }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('ranks.myType.checked', { by: t('coaching.coach.level.by.court_desk') }))).toBeTruthy();
      expect(screen.queryByTestId('ranks.me.type.change')).toBeNull();
      expect(within(screen.getByTestId('ranks.me.type.locked')).getByText(t('ranks.myType.locked'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a coach\'s result waits for known players, then is sent confirmed with an empty second seat', async () => {
    const rpc = jest.fn((_name: string, _args?: unknown) => Promise.resolve({ data: { id: 'g1', status: 'confirmed' }, error: null }));
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(CoachModeResult, {
      locale,
      coach: coachMeFixture(),
      queryData: [
        [ranksKeys.player('sara'), { username: 'sara', name: 'Sara M.', me: false }],
        [ranksKeys.player('ali'), { username: 'ali', name: 'Ali K.', me: false }],
      ],
    });
    try {
      const submit = () => screen.getByTestId('coach-mode-result.submit');
      expect(submit().props.accessibilityState?.disabled).toBe(true);
      expect(within(screen.getByTestId('coach-mode-result.winner.draw')).getByText(t('coaching.coach.result.draw'))).toBeTruthy();
      fireEvent.changeText(screen.getByTestId('coach-mode-result.a1'), 'sara');
      fireEvent.changeText(screen.getByTestId('coach-mode-result.b1'), 'ali');
      await waitFor(() => expect(submit().props.accessibilityState?.disabled).toBe(false), { timeout: 3000 });
      fireEvent.press(screen.getByTestId('coach-mode-result.winner.b'));
      fireEvent.press(submit());
      await waitFor(() =>
        expect(rpc).toHaveBeenCalledWith('ranks_coach_record', {
          p_a1: 'sara',
          p_a2: null,
          p_b1: 'ali',
          p_b2: null,
          p_winner: 'b',
          p_score: null,
        }),
      );
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
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
      queryData: [[ranksKeys.board, boardFixture({ race: [] })]],
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
