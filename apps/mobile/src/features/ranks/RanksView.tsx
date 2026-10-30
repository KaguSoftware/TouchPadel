import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button, MicroLabel } from '../../components/ui';
import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { useToast } from '../../components/overlays';
import { usePullRefresh } from '../../lib/usePullRefresh';
import { space, useTheme } from '../../theme';
import { useAuth } from '../auth/context';
import { mapErrorToKey } from '../booking/errors';
import { useAnswerResult, useMyRanks, useRanksBoard } from './hooks';
import { BoardRest, Podium } from './Board';
import { useRanksLive } from './live';
import { ResultRow, ToReportRow, WaitingCard, YourPlace } from './Mine';

/**
 * Ranks, the leaderboard (Majed, 2026-10-22; migration 0364), the Club tab's middle segment
 * (Sait, 2026-10-25: it was a tab of its own).
 *
 * Read top to bottom: a score waiting on the guest (nothing counts until an opponent says yes),
 * the board itself (public, the top `size` only, a podium for the first three), the guest's own
 * place and level, the games they played and can still add a score to, and their last games.
 * Signed out, the board shows and the rest asks them to sign in. The owner sets the rules on the
 * operator; the line under the title says them, so a player knows what a win is worth.
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
  // re-reads the board and their page (features/ranks/live.ts).
  useRanksLive();
  const pull = usePullRefresh(() => Promise.all([board.refetch(), member ? my.refetch() : null]));

  const mine = my.data?.enabled ? my.data : null;
  const waiting = mine ? mine.results.filter((r) => r.canConfirm) : [];
  const games = mine ? mine.results.filter((r) => !r.canConfirm) : [];
  const live = board.data?.enabled ? board.data : null;

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
    if (live.rows.length === 0) {
      return <EmptyState testID="ranks.empty" title={t('ranks.empty.title')} message={t('ranks.empty.message')} />;
    }
    return (
      <View>
        <Podium testID="ranks.podium" rows={live.rows} />
        <BoardRest testID="ranks.board" rows={live.rows} />
      </View>
    );
  };

  return (
      <ScrollView
        testID={testID ?? 'ranks.scroll'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad, gap: space.xxl }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.blue} />
        }
      >
        {/* The period and what a game is worth, said once, quietly. */}
        {live ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <MicroLabel style={{ color: colors.blue }}>{t(`ranks.period.${live.period}`)}</MicroLabel>
            {mine ? (
              <MicroLabel>
                {t('ranks.rules', {
                  win: isolateLtr(String(mine.rules.win)),
                  loss: isolateLtr(String(mine.rules.loss)),
                })}
              </MicroLabel>
            ) : null}
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
            <YourPlace testID="ranks.me" mine={mine} />

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
                    <ResultRow testID={`ranks.result.${r.id}`} result={r} />
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : my.isPending ? (
          <Skeleton height={120} />
        ) : null}
      </ScrollView>
  );
}
