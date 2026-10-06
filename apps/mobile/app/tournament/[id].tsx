import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatDateTime,
  formatIQD,
  formatTime,
  isolate,
  isolateLtr,
  type MessageKey,
} from '@touch/i18n';
import { needsTermsAcceptance } from '@touch/core';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { useOwnConsent } from '../../src/features/profile/hooks';
import { serverNowMs } from '../../src/features/deposit/logic';
import { useSetMyGender } from '../../src/features/matches/hooks';
import { errorCodeOf, matchErrorText } from '../../src/features/matches/errors';
import type { Gender } from '../../src/features/matches/logic';
import {
  useRegisterTournament,
  useTournamentPublic,
  useWithdrawTournament,
} from '../../src/features/tournaments/hooks';
import {
  tournamentErrorText,
  tournamentRefusalOf,
  type TournamentAction,
} from '../../src/features/tournaments/errors';
import {
  DEFAULT_TZ,
  playerLabel,
  prizeText,
  showsPlay,
  tourActionOf,
  tourPlacesOf,
  tournamentName,
  type TournamentPublic,
  type TourPlayer,
} from '../../src/features/tournaments/logic';
import { callPhone } from '../../src/lib/phone';
import { useBranches } from '../../src/features/availability/hooks';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { space, useTheme } from '../../src/theme';
import { Button, Card, MicroLabel, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { ConfirmAlert, useToast } from '../../src/components/overlays';
import { CategoryPill, GenderAsk, MatchNotice } from '../../src/components/match';
import { StandingsTable, TournamentRound } from '../../src/components/tournament';

/** A refusal the server raised, shown under the action: amber, or red for a match ban. */
interface Notice {
  text: string;
  tone: 'amber' | 'red';
  /** MATCH_BANNED offers "Call {branch}". */
  call: boolean;
}

/**
 * One tournament (tournaments plan §5.2), from `tournament_public`: what and when, the places,
 * then the guest's action (Register, Join the waitlist, Withdraw) and own state ("Number 2 on
 * the waitlist", "Pay … at the desk on the day"); the schedule and the standings once play has
 * begun, read again every 30 s while play is under way and this screen is focused.
 *
 * Public: a signed-out Register goes to the welcome. Register runs the open-match eligibility
 * (`app.match_guest`), so its refusals are handled as a match join's: TERMS to /accept-terms,
 * PHONE to the profile, GENDER to the inline ask (then Register again), BANNED to the red notice.
 * The booking gate does not apply: registering books no court.
 */
export default function TournamentDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : null;

  // Polled only while focused (useTournamentPublic reads `poll` with the status).
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const tour = useTournamentPublic(id, { poll: focused });
  const pull = usePullRefresh(tour.refetch);
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  const consent = useOwnConsent(uid);
  const needsTerms = consent.data === undefined || needsTermsAcceptance(consent.data);
  const branches = useBranches();
  const register = useRegisterTournament();
  const withdraw = useWithdrawTournament();
  const setGender = useSetMyGender();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [askGender, setAskGender] = useState(false);
  const [genderBusy, setGenderBusy] = useState<Gender | null>(null);
  const [genderError, setGenderError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setDeviceNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  const header = <Stack.Screen options={{ title: t('tournaments.guest.detail.title') }} />;
  const notFound = (
    <Screen edges={[]}>
      {header}
      <EmptyState
        testID="tournament-detail.not-found"
        fill
        title={t('tournaments.guest.detail.notFound')}
      />
    </Screen>
  );

  if (!id) return notFound;
  if (!tour.data) {
    return (
      <Screen edges={[]}>
        {header}
        {tour.isError ? (
          <ErrorState
            testID="tournament-detail.error"
            title={t('errors.loadFailedTitle')}
            message={tournamentErrorText(tour.error, t)}
            retryLabel={t('common.retry')}
            onRetry={() => void tour.refetch()}
            busy={tour.isRefetching}
          />
        ) : (
          <SkeletonList rows={3} height={96} />
        )}
      </Screen>
    );
  }
  const d: TournamentPublic = tour.data;
  if (d.missing) return notFound;

  const tz = d.branch?.timezone ?? DEFAULT_TZ;
  const nowMs = serverNowMs(d.serverNow, tour.dataUpdatedAt, deviceNow);
  const action = tourActionOf(d, nowMs);
  const money = (n: number) => isolate(formatIQD(n, locale));
  const branchRow = branches.data?.find((b) => b.venue_id === d.venueId) ?? null;
  const phone = branchRow?.phone ?? null;
  const branchLabel = d.branch
    ? locale === 'ar'
      ? (d.branch.nameAr ?? d.branch.nameEn)
      : (d.branch.nameEn ?? d.branch.nameAr)
    : null;
  const busy = register.isPending || withdraw.isPending || setGender.isPending;

  const nameOf = (p: TourPlayer) =>
    playerLabel(p, {
      former: t('tournaments.common.formerPlayer'),
      numbered: (no) => t('tournaments.common.player', { no: isolateLtr(no) }),
    });

  const onRefusal = (err: Error, action: TournamentAction) => {
    switch (tournamentRefusalOf(errorCodeOf(err))) {
      case 'terms':
        if (needsTerms) router.push('/accept-terms');
        else setNotice({ text: t('matches.errors.updateApp'), tone: 'amber', call: false });
        return;
      case 'phone':
        router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
        return;
      case 'gender':
        setAskGender(true);
        return;
      case 'banned':
        setNotice({ text: tournamentErrorText(err, t, { action }), tone: 'red', call: true });
        return;
      case 'refetch':
        setNotice({ text: tournamentErrorText(err, t, { action }), tone: 'amber', call: false });
        void tour.refetch();
        return;
      default:
        setNotice({
          text: tournamentErrorText(err, t, { termsCurrent: !needsTerms, action }),
          tone: 'amber',
          call: false,
        });
    }
  };

  const onRegister = () => {
    setNotice(null);
    if (!session) {
      router.push('/welcome');
      return;
    }
    register.mutate(d.id, {
      onSuccess: (r) =>
        toast(
          t(
            r.status === 'waitlisted'
              ? 'tournaments.guest.detail.waitlistedToast'
              : 'tournaments.guest.detail.registeredToast',
          ),
          'success',
        ),
      onError: (err) => onRefusal(err, 'register'),
    });
  };

  const onWithdraw = () => {
    setNotice(null);
    withdraw.mutate(d.id, {
      onSuccess: (r) =>
        toast(
          r.refundDueIqd > 0
            ? t('tournaments.guest.detail.refundAtDesk', { amount: money(r.refundDueIqd) })
            : t('tournaments.guest.detail.withdrawnToast'),
          'info',
        ),
      onError: (err) => onRefusal(err, 'withdraw'),
    });
  };

  const onGender = (gender: Gender) => {
    setGenderError(null);
    setGenderBusy(gender);
    setGender.mutate(gender, {
      onSuccess: () => {
        setAskGender(false);
        onRegister();
      },
      onError: (err) => {
        if (errorCodeOf(err) === 'GENDER_ALREADY_SET') {
          setAskGender(false);
          onRegister();
        } else setGenderError(matchErrorText(err, t, { locale }));
      },
      onSettled: () => setGenderBusy(null),
    });
  };

  const callVenue = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  // ── The guest's own state ────────────────────────────────────────────────
  const own = d.me?.status ?? null;
  const ownLine: string | null =
    own === 'registered'
      ? t('tournaments.guest.detail.registered')
      : own === 'waitlisted'
        ? d.me?.waitlistPosition !== null && d.me?.waitlistPosition !== undefined
          ? t('tournaments.guest.detail.waitlistPosition', {
              position: isolateLtr(String(d.me.waitlistPosition)),
            })
          : t('tournaments.guest.detail.waitlisted')
        : own === 'no_show'
          ? t('tournaments.guest.detail.noShow')
          : null;
  const owed = own === 'registered' && d.me && d.me.owedIqd > 0 ? d.me.owedIqd : 0;

  const STATUS_NOTE: Partial<Record<NonNullable<TournamentPublic['status']>, MessageKey>> = {
    closed: 'tournaments.guest.detail.closedNote',
    running: 'tournaments.common.status.running',
    finished: 'tournaments.guest.detail.finishedNote',
    cancelled: 'tournaments.guest.detail.cancelledNote',
  };
  const statusNote =
    d.status && STATUS_NOTE[d.status]
      ? t(STATUS_NOTE[d.status]!)
      : action === 'closed'
        ? t('tournaments.guest.detail.closedNote')
        : null;

  const lead = { fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 20, color: colors.ink };
  const sub = { fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 18, color: colors.mut };

  const actionBlock = (() => {
    switch (action) {
      case 'register':
      case 'waitlist':
        return (
          <Button
            testID="tournament-detail.register"
            label={t(
              action === 'register' ? 'tournaments.guest.register' : 'tournaments.guest.waitlist',
            )}
            variant="cta"
            busy={register.isPending}
            disabled={busy}
            onPress={onRegister}
          />
        );
      case 'withdraw':
        return (
          <Button
            testID="tournament-detail.withdraw"
            label={t('tournaments.guest.withdraw')}
            variant="secondary"
            busy={withdraw.isPending}
            disabled={busy}
            onPress={() => setConfirmWithdraw(true)}
          />
        );
      case 'full':
        return <MatchNotice text={t('tournaments.guest.detail.fullNote')} />;
      default:
        return null;
    }
  })();

  const rounds = showsPlay(d) ? d.rounds : [];

  return (
    <Screen edges={[]}>
      {header}
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.sm,
          paddingBottom: 40 + insets.bottom,
          gap: space.m,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
      >
        <Card style={{ gap: space.s }}>
          <CategoryPill category={d.category} />
          <Text style={{ fontFamily: fonts.display900, fontSize: 20, color: colors.ink }}>
            {tournamentName(d, locale)}
          </Text>
          <Text style={sub}>
            {[
              d.format ? t(`tournaments.common.format.${d.format}`) : null,
              d.pointsTarget !== null
                ? t('tournaments.common.pointsTarget', {
                    points: isolateLtr(String(d.pointsTarget)),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={{ gap: 2 }}>
            <MicroLabel>{t('tournaments.guest.detail.when')}</MicroLabel>
            <Text style={lead}>
              {d.endsAt
                ? `${formatDateTime(new Date(d.startsAt), locale, tz)} – ${formatTime(new Date(d.endsAt), locale, tz)}`
                : formatDateTime(new Date(d.startsAt), locale, tz)}
            </Text>
          </View>
          {branchLabel ? (
            <View style={{ gap: 2 }}>
              <MicroLabel>{t('tournaments.guest.detail.branch')}</MicroLabel>
              <Text style={lead}>{branchLabel}</Text>
            </View>
          ) : null}
          <View style={{ gap: 2 }}>
            <MicroLabel>{t('tournaments.common.entryFee')}</MicroLabel>
            <Text style={lead}>
              {d.entryFeeIqd > 0 ? money(d.entryFeeIqd) : t('tournaments.common.free')}
            </Text>
          </View>
          {prizeText(d, locale) ? (
            <View style={{ gap: 2 }}>
              <MicroLabel>{t('tournaments.common.prize')}</MicroLabel>
              <Text style={lead}>{prizeText(d, locale)}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.l }}>
            {/* Places count only while registration is open: the server counts them whatever the status. */}
            {tourPlacesOf(d).kind !== 'status' ? (
              <View style={{ gap: 2 }}>
                <MicroLabel>{t('tournaments.guest.detail.placesLeft')}</MicroLabel>
                <Text style={lead}>{isolateLtr(String(d.placesLeft))}</Text>
              </View>
            ) : null}
            <View style={{ gap: 2 }}>
              <MicroLabel>{t('tournaments.guest.detail.entries')}</MicroLabel>
              <Text style={lead}>
                {d.maxEntries !== null
                  ? isolateLtr(`${d.entriesCount} / ${d.maxEntries}`)
                  : isolateLtr(String(d.entriesCount))}
              </Text>
            </View>
          </View>
          {d.status === 'open' && d.registrationClosesAt ? (
            <Text style={sub}>
              {t('tournaments.guest.detail.closes', {
                time: formatDateTime(new Date(d.registrationClosesAt), locale, tz),
              })}
            </Text>
          ) : null}
        </Card>

        {statusNote ? <MatchNotice text={statusNote} /> : null}

        {ownLine || owed > 0 ? (
          <View style={{ gap: 4 }}>
            {ownLine ? <Text style={lead}>{ownLine}</Text> : null}
            {owed > 0 ? (
              <Text style={[lead, { color: colors.ambtext }]}>
                {t('tournaments.guest.owedAtDesk', { amount: money(owed) })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {askGender ? (
          <GenderAsk
            testID="tournament-detail.gender"
            busy={genderBusy}
            error={genderError}
            onPick={onGender}
          />
        ) : null}

        {notice ? (
          <View style={{ gap: space.sm }}>
            <MatchNotice text={notice.text} tone={notice.tone} />
            {notice.call && phone ? (
              <Button
                testID="tournament-detail.call-branch"
                label={t('matches.detail.callBranch', {
                  branch: branchLabel ?? t('common.appName'),
                })}
                variant="secondary"
                size="compact"
                onPress={callVenue}
              />
            ) : null}
          </View>
        ) : null}

        {actionBlock}

        {rounds.length > 0 ? (
          <View style={{ gap: space.s }}>
            <MicroLabel>{t('tournaments.guest.detail.standings')}</MicroLabel>
            <StandingsTable
              head={{
                rank: t('tournaments.guest.detail.rank'),
                player: t('tournaments.guest.detail.player'),
                points: t('tournaments.guest.detail.pointsWon'),
                diff: t('tournaments.guest.detail.diff'),
                played: t('tournaments.guest.detail.played'),
              }}
              rows={d.standings.map((s, i) => ({
                key: `${s.player.no ?? 'x'}:${i}`,
                rank: s.rank !== null ? isolateLtr(String(s.rank)) : '',
                player: s.withdrawn
                  ? t('tournaments.guest.detail.withdrawn', { name: nameOf(s.player) })
                  : nameOf(s.player),
                points: isolateLtr(String(s.pointsWon)),
                diff: isolateLtr(s.diff > 0 ? `+${s.diff}` : String(s.diff)),
                played: isolateLtr(String(s.played)),
              }))}
            />
            <MicroLabel>{t('tournaments.guest.detail.schedule')}</MicroLabel>
            {rounds.map((r) => (
              <TournamentRound
                key={r.roundNo}
                title={t('tournaments.common.round', { round: isolateLtr(String(r.roundNo)) })}
                vs={t('tournaments.guest.detail.vs')}
                matches={r.matches.map((m, i) => ({
                  key: `${r.roundNo}:${m.courtNo ?? i}`,
                  court: t('tournaments.guest.detail.court', {
                    no: isolateLtr(String(m.courtNo ?? i + 1)),
                  }),
                  a: m.a.map(nameOf).join(' & '),
                  b: m.b.map(nameOf).join(' & '),
                  score:
                    m.pointsA !== null && m.pointsB !== null
                      ? isolateLtr(`${m.pointsA} – ${m.pointsB}`)
                      : null,
                }))}
                sitOut={
                  r.sitOut.length > 0
                    ? t('tournaments.guest.detail.sitOut', {
                        names: r.sitOut.map(nameOf).join(locale === 'ar' ? '، ' : ', '),
                      })
                    : null
                }
              />
            ))}
          </View>
        ) : d.status === 'closed' || d.status === 'running' ? (
          <Text style={sub}>{t('tournaments.guest.detail.scheduleLater')}</Text>
        ) : null}
      </ScrollView>
      <ConfirmAlert
        visible={confirmWithdraw}
        title={t('tournaments.guest.detail.withdrawTitle')}
        body={t(
          own === 'waitlisted'
            ? 'tournaments.guest.detail.withdrawWaitlistBody'
            : 'tournaments.guest.detail.withdrawBody',
        )}
        confirmLabel={t('tournaments.guest.detail.withdrawConfirm')}
        cancelLabel={t('tournaments.guest.detail.keep')}
        destructive
        onConfirm={() => {
          setConfirmWithdraw(false);
          onWithdraw();
        }}
        onDismiss={() => setConfirmWithdraw(false)}
      />
    </Screen>
  );
}
