import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button, MicroLabel, SegmentedControl } from '../../components/ui';
import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { useToast } from '../../components/overlays';
import { usePullRefresh } from '../../lib/usePullRefresh';
import { usePullBall } from '../../components/PullBall';
import { useScreenFocused } from '../../lib/useScreenFocused';
import { space, useTheme } from '../../theme';
import { useAuth } from '../auth/context';
import { mapErrorToKey } from '../booking/errors';
import { useAnswerResult, useMyRanks, useRanksBoard } from './hooks';
import { BoardRest, Podium } from './Board';
import { HowItWorksSheet } from './HowItWorks';
import { MyTypeSheet } from './MyTypeSheet';
import { useRanksLive } from './live';
import { MyLevel, MyRaceCard, ResultRow, ToReportRow, WaitingCard } from './Mine';
import {
  BOARD_VIEWS,
  RANK_CLASSES,
  initialView,
  reliableRule,
  rowsFor,
  rulesOf,
  type Board,
  type BoardView,
  type RankClass,
} from './logic';

/**
 * Ranks, the leaderboard (Majed, 2026-10-22; migration 0364), the Club tab's middle segment
 * (Sait, 2026-10-25: it was a tab of its own).
 *
 * Read top to bottom: the period and "How ranking works", a score waiting on the guest (nothing
 * counts until an opponent says yes), the board (public, the top `size` only, a podium for the
 * first three) behind a switch of four views, Season Race · Touch Level · Classes (A/B/C) · Most
 * improved, opening on the owner's headline board (0444, Majed 2026-11-16; default the Race),
 * then the guest's own Touch Level and Race place, the games they can still add a score to, and
 * their last games with what each did. Signed out, the board shows and the rest asks them to sign
 * in. An older server (0364) sends the Race alone: no switch, the Race board as before.
 */
export function RanksView({ bottomPad, testID }: { bottomPad: number; testID?: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;
  const board = useRanksBoard();
  const my = useMyRanks(member);
  const answer = useAnswerResult();
  // Live over the 0364 broadcasts: a point written anywhere, or a score reported to this guest,
  // re-reads the board and their page (features/ranks/live.ts), only while this screen is in front.
  useRanksLive(useScreenFocused());
  const pull = usePullRefresh(() => Promise.all([board.refetch(), member ? my.refetch() : null]));
  const ball = usePullBall(pull);

  const mine = my.data?.enabled ? my.data : null;
  const waiting = mine ? mine.results.filter((r) => r.canConfirm) : [];
  const games = mine ? mine.results.filter((r) => !r.canConfirm) : [];
  const live = board.data?.enabled ? board.data : null;
  // The view the guest picked; until they pick one, the owner's headline board.
  const [picked, setPicked] = useState<BoardView | null>(null);
  const view: BoardView = live && !live.legacy ? (picked ?? initialView(live)) : 'race';
  const [pickedClass, setPickedClass] = useState<RankClass | null>(null);
  const klass: RankClass = pickedClass ?? mine?.touch?.klass ?? 'A';
  const [howOpen, setHowOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const onAnswer = (resultId: string, accept: boolean) =>
    answer.mutate(
      { resultId, accept },
      {
        onSuccess: () => toast(t(accept ? 'ranks.waiting.confirmed' : 'ranks.waiting.declined'), 'info'),
        onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
      },
    );

  const boardBlock = () => {
    if (!board.data) {
      return board.isError ? (
        <ErrorState
          testID="ranks.error"
          title={t('errors.loadFailedTitle')}
          message={t('ranks.error')}
          retryLabel={t('common.retry')}
          onRetry={() => void board.refetch()}
          busy={board.isRefetching}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <Skeleton height={150} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </View>
      );
    }
    if (!live) {
      return <EmptyState testID="ranks.off" title={t('ranks.off.title')} message={t('ranks.off.message')} />;
    }
    const rows = rowsFor(live, view, klass);
    return (
      <View style={{ gap: space.m }}>
        {!live.legacy ? (
          <View style={{ gap: space.s }}>
            <SegmentedControl
              testID="ranks.view-switch"
              options={BOARD_VIEWS.map((v) => ({ value: v, label: t(`ranks.view.${v}`) }))}
              value={view}
              onChange={setPicked}
            />
            {view === 'classes' ? (
              <SegmentedControl
                testID="ranks.class-switch"
                options={RANK_CLASSES.map((c) => ({ value: c, label: t(`ranks.class.${c}`) }))}
                value={klass}
                onChange={setPickedClass}
              />
            ) : null}
            <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
              {boardHint(live, view, t)}
            </Text>
          </View>
        ) : null}
        {rows.length === 0 ? (
          emptyBoard(view)
        ) : (
          <View key={`${view}-${klass}`}>
            <Podium testID="ranks.podium" rows={rows} view={view} />
            <BoardRest testID="ranks.board" rows={rows} view={view} />
          </View>
        )}
      </View>
    );
  };

  // A board with nobody on it, in plain words: who appears there and when.
  const emptyBoard = (v: BoardView) => {
    const rules = rulesOf(board.data, my.data);
    const rule = reliableRule(mine?.touch ?? null, rules);
    const gate = rule
      ? t('ranks.emptyLevel.rule', {
          games: isolateLtr(String(rule.games)),
          players: isolateLtr(String(rule.players)),
          days: isolateLtr(String(rule.days)),
        })
      : t('ranks.emptyLevel.ruleNoNumbers');
    switch (v) {
      case 'race':
        return <EmptyState testID="ranks.empty" title={t('ranks.empty.title')} message={t('ranks.empty.message')} />;
      case 'level':
        return <EmptyState testID="ranks.empty-level" title={t('ranks.emptyLevel.title')} message={gate} />;
      case 'classes':
        return (
          <EmptyState
            testID="ranks.empty-class"
            title={t('ranks.emptyClass.title', { klass: isolateLtr(klass) })}
            message={gate}
          />
        );
      case 'improved':
        return (
          <EmptyState
            testID="ranks.empty-improved"
            title={t('ranks.emptyImproved.title')}
            message={
              rules?.improvedMinGames && live?.improvedDays
                ? t('ranks.emptyImproved.messageMin', {
                    games: isolateLtr(String(rules.improvedMinGames)),
                    days: isolateLtr(String(live.improvedDays)),
                  })
                : t('ranks.emptyImproved.message')
            }
          />
        );
    }
  };

  return (
    <View style={{ flex: 1 }} {...ball.wrapHandlers}>
      <ScrollView
        testID={testID ?? 'ranks.scroll'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad, gap: space.xxl }}
        onScroll={ball.onScroll}
        bounces={ball.bounces}
        scrollEventThrottle={16}
        refreshControl={ball.refreshControl}
      >
        {/* The period, said once, quietly, and the way to the rules in plain words. */}
        {live ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <MicroLabel style={{ flex: 1, color: colors.blue }}>{t(`ranks.period.${live.period}`)}</MicroLabel>
            <Pressable
              testID="ranks.how"
              accessibilityRole="button"
              onPress={() => setHowOpen(true)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 4 })}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.blue }}>{t('ranks.how.open')}</Text>
            </Pressable>
          </View>
        ) : null}

        {waiting.length > 0 ? (
          <View style={{ gap: space.sm }}>
            {waiting.map((r) => (
              <WaitingCard
                key={r.id}
                testID={`ranks.waiting.${r.id}`}
                result={r}
                busy={answer.isPending && answer.variables?.resultId === r.id}
                onAnswer={(accept) => onAnswer(r.id, accept)}
              />
            ))}
          </View>
        ) : null}

        {boardBlock()}

        {!member ? (
          <View style={{ gap: space.s }}>
            <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink }}>{t('ranks.signIn.title')}</Text>
            <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.mut }}>
              {t('ranks.signIn.message')}
            </Text>
            <Button
              testID="ranks.sign-in"
              label={t('auth.signIn')}
              variant="primary"
              size="compact"
              onPress={() => router.push('/sign-in')}
              style={{ alignSelf: 'flex-start', marginTop: space.xs, paddingHorizontal: space.xl }}
            />
          </View>
        ) : mine ? (
          <>
            {mine.touch ? (
              <MyLevel testID="ranks.me" touch={mine.touch} onChangeType={() => setTypeOpen(true)} />
            ) : null}
            <MyRaceCard testID="ranks.race" mine={mine} />

            {mine.rules.reports && mine.toReport.length > 0 ? (
              <View>
                <MicroLabel>{t('ranks.toReport.title')}</MicroLabel>
                {mine.toReport.map((item, i) => (
                  <View
                    key={item.reservationId}
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.line } : null}
                  >
                    <ToReportRow
                      testID={`ranks.report.${item.reservationId}`}
                      item={item}
                      onPress={() =>
                        router.push({
                          pathname: '/ranks-report',
                          params: {
                            reservationId: item.reservationId,
                            startAt: item.startAt,
                            courtEn: item.courtEn,
                            courtAr: item.courtAr,
                          },
                        })
                      }
                    />
                  </View>
                ))}
                <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 18, color: colors.fnt, marginTop: space.xs }}>
                  {t('ranks.toReport.hint')}
                </Text>
              </View>
            ) : null}

            {games.length > 0 ? (
              <View>
                <MicroLabel>{t('ranks.results.title')}</MicroLabel>
                {games.map((r, i) => (
                  <View key={r.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.line } : null}>
                    <ResultRow testID={`ranks.result.${r.id}`} result={r} rules={rulesOf(board.data, my.data)} />
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : my.isPending ? (
          <Skeleton height={120} />
        ) : null}
        {mine?.touch ? (
          <MyTypeSheet
            key={typeOpen ? 'open' : 'closed'}
            testID="ranks.type-sheet"
            visible={typeOpen}
            current={mine.touch.selfType}
            provisionalGames={rulesOf(board.data, my.data)?.provisionalGames ?? null}
            onClose={() => setTypeOpen(false)}
          />
        ) : null}
        <HowItWorksSheet
          testID="ranks.how-sheet"
          visible={howOpen}
          board={board.data}
          mine={my.data}
          onClose={() => setHowOpen(false)}
        />
      </ScrollView>
      {ball.overlay}
    </View>
  );
}

/** The line under the switch: what the board in front of the guest is. */
function boardHint(
  board: Extract<Board, { enabled: true }>,
  view: BoardView,
  t: ReturnType<typeof useLocale>['t'],
): string {
  switch (view) {
    case 'race':
      return t('ranks.board.raceHint');
    case 'level':
      return t('ranks.board.levelHint');
    case 'classes':
      return t('ranks.board.classesHint');
    case 'improved':
      return board.improvedDays !== null
        ? t('ranks.board.improvedHint', { days: isolateLtr(String(board.improvedDays)) })
        : t('ranks.board.improvedHintNoDays');
  }
}
