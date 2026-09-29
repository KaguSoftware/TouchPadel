import { useEffect, useState } from 'react';
import { ScrollView, Share, Switch, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  countPhrase,
  formatDateTime,
  formatIQD,
  formatTime,
  isolate,
  isolateLtr,
  type MessageKey,
} from '@touch/i18n';
import { needsTermsAcceptance, pickLocale } from '@touch/core';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { RequireSession } from '../../src/features/auth/RequireSession';
import { useAuth } from '../../src/features/auth/context';
import { bookingGateState } from '../../src/features/auth/social';
import {
  useAllCourts,
  useBranches,
  useCourtsBroadcast,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { branchName } from '../../src/features/availability/branch';
import { DEFAULT_TZ } from '../../src/features/availability/assemble';
import { requestBookingSheet } from '../../src/features/courtTransition/openIntent';
import { useOwnConsent, useOwnProfile } from '../../src/features/profile/hooks';
import { serverNowMs } from '../../src/features/deposit/logic';
import {
  useBlockPlayer,
  useCancelMatch,
  useDecideRequest,
  useJoinMatch,
  useLeaveMatch,
  useMatch,
  useMyTickets,
  usePostMatchMessage,
  useRemovePlayer,
  useRequestMatch,
  useSetMyGender,
  useWithdrawRequest,
} from '../../src/features/matches/hooks';
import {
  byCategory,
  displayName,
  friendsFor,
  LIVE_MATCH_STATUSES,
  missingTickets,
  needsFriendsDeclaration,
  ORGANISER_CANCEL_REASONS,
  seatsOfLabel,
  SEATS_TOTAL,
  type Gender,
  type MatchDetail,
  type MatchSeat,
  type MessageCode,
  type OrganiserCancelReason,
} from '../../src/features/matches/logic';
import {
  actionCardOf,
  guestStateOf,
  leaveConfirm,
  ownSeatOf,
  partyShareIqd,
  stateInputOfDetail,
  stateLine,
} from '../../src/features/matches/state';
import {
  errorCodeOf,
  joinRefusalOf,
  matchErrorText,
  refusalKey,
  ticketsToBuy,
} from '../../src/features/matches/errors';
import { setTicketContinuation, ticketsHref } from '../../src/features/matches/continuation';
import { isMatchToken, matchShareUrl } from '../../src/features/matches/links';
import { callPhone } from '../../src/lib/phone';
import { useBack } from '../../src/navigation/back';
import { space, useTheme } from '../../src/theme';
import {
  Button,
  Card,
  ErrorText,
  LinkText,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { ConfirmAlert, useToast } from '../../src/components/overlays';
import {
  GenderAsk,
  MatchMessages,
  MatchMoneyCard,
  MatchNotice,
  MatchPoster,
  MatchRestrictedCard,
  MatchRulesCard,
  MatchSectionTitle,
  messageLabelKey,
  nightLabel,
  QuickMessageBar,
  RequestRow,
  SeatGrid,
  ShareGlyph,
} from '../../src/components/match';
import { nativeChoice } from '../../src/components/nativeChoice';

/** A preset message rests this long after a send (GD-7): a local courtesy, the server decides. */
const MESSAGE_REST_MS = 2 * 60_000;

const CANCEL_REASON_KEY: Record<OrganiserCancelReason, MessageKey> = {
  not_enough_players: 'matches.detail.reasonNotEnoughPlayers',
  plans_changed: 'matches.detail.reasonPlansChanged',
  other: 'matches.detail.reasonOther',
};

interface Confirm {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  run: () => void;
}

/**
 * One open match (docs/design/open-matches/guest.md §4.14, §4.15, §4.17).
 *
 * Everything the guest may do comes from the server: `me.can` and
 * `me.refusal` pick the action card (`actionCardOf`), `seats[].can` the seat
 * menu, `leave_outcome` the leave warning, `share_iqd` the money. The phone
 * decides none of it (§4.0 rule 4). A restricted viewer (R32) gets the
 * restricted card in place; a match the guest may not see is MATCH_NOT_FOUND.
 *
 * Polled every 20 s while filling or waiting for a court (`useMatch`), and a
 * match push landing in the foreground refreshes it at once (_layout's
 * `onMatchNotice`). Countdowns run on the server's clock (`serverNowMs`).
 */
function MatchDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const back = useBack();
  const toast = useToast();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id?: string; t?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : null;
  const token = isMatchToken(params.t) ? params.t : null;

  const match = useMatch(id, token);
  const view = match.data ?? null;
  const detail: MatchDetail | null = view && !view.restricted ? view : null;
  const venueId = detail?.venueId ?? null;
  // Never the stored branch (DF-1): the match's own branch, or nothing yet.
  useCourtsBroadcast(venueId);
  const settings = useVenueSettings(venueId);
  const branches = useBranches();
  const courts = useAllCourts();
  const wallet = useMyTickets();
  const profile = useOwnProfile(!!session);
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  const consent = useOwnConsent(uid);

  const join = useJoinMatch();
  const request = useRequestMatch();
  const withdraw = useWithdrawRequest();
  const decide = useDecideRequest();
  const leave = useLeaveMatch();
  const remove = useRemovePlayer();
  const cancel = useCancelMatch();
  const message = usePostMatchMessage();
  const block = useBlockPlayer();
  const setGender = useSetMyGender();

  const knobs = settings.data ?? null;
  const tz = knobs?.timezone ?? DEFAULT_TZ;
  const phone = knobs?.phone ?? null;
  const branch = branches.data?.find((b) => b.venue_id === venueId) ?? null;
  const branchLabel = branch ? branchName(branch, locale) : null;
  const multiBranch = (branches.data?.length ?? 0) > 1;

  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setDeviceNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);
  const nowMs = serverNowMs(view?.serverNow ?? null, match.dataUpdatedAt, deviceNow);

  const [seatsWanted, setSeatsWanted] = useState(1);
  // The friends' declaration answers one seat count (OM-39).
  const [declaredFor, setDeclaredFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null);
  const [genderBusy, setGenderBusy] = useState<Gender | null>(null);
  const [restUntil, setRestUntil] = useState<Partial<Record<MessageCode, number>>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // The profile's gender (§4.9): null is "not asked yet". A row cached by an
  // older build has no `gender` at all, and then the server's GENDER_REQUIRED
  // drives the ask.
  const genderUnset = profile.data?.gender === null;
  // A join ends in a court booking, so a phone nobody has verified stops it as
  // it stops a hold (owner, 2026-09-29): Join and Request go to /phone-sign-in
  // in back mode, as Review's "Verify phone number" does, and verify-otp pops
  // back here.
  const unverified = bookingGateState(profile, session?.user) === 'unverified';
  // Unread consent sends TERMS_REQUIRED to /accept-terms, which reads it itself.
  const needsTerms = consent.data === undefined || needsTermsAcceptance(consent.data);
  const money = (n: number) => isolate(formatIQD(n, locale));
  const errorCtx = { locale, timezone: tz, phone, now: new Date(nowMs) };

  const callVenue = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const findAnother = () => {
    requestBookingSheet();
    router.navigate('/(tabs)');
  };

  const onShare = () => {
    if (!detail?.shareToken) return;
    const text = t('matches.link.shareMessage', {
      branch:
        multiBranch && branchLabel ? t('matches.link.shareBranch', { name: branchLabel }) : '',
      when: formatDateTime(new Date(detail.startAt), locale, tz),
      seats: countPhrase('matches.count.seatsLeft', detail.seatsLeft, locale),
      url: matchShareUrl(detail.shareToken),
    });
    void Share.share({ message: text }).catch(() => {});
  };

  const lines = !detail
    ? []
    : detail.messages
        .filter((m) => m.code !== null)
        .map((m, i) => ({
          key: `${m.at ?? ''}|${m.seatNo ?? ''}|${i}`,
          text: t('matches.messages.line', {
            name: m.isMe ? t('matches.common.you') : displayName(m, detail.category, t),
            label: t(messageLabelKey(m.code!)),
            time: m.at ? formatTime(new Date(m.at), locale, tz) : '',
          }),
        }));

  // ── Loading, missing, restricted ──────────────────────────────────────────
  const header = (
    <Stack.Screen
      options={{
        title: t('matches.common.title'),
        headerRight: detail?.shareToken
          ? () => (
              <Pressable
                testID="match-detail.header-share"
                accessibilityRole="button"
                accessibilityLabel={t('matches.detail.share')}
                hitSlop={10}
                onPress={onShare}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  paddingStart: 6,
                  paddingEnd: 6,
                })}
              >
                <ShareGlyph color={colors.blue} />
              </Pressable>
            )
          : undefined,
      }}
    />
  );

  if (!view) {
    const notFound = !id || errorCodeOf(match.error) === 'MATCH_NOT_FOUND';
    return (
      <Screen edges={[]}>
        {header}
        {match.isError || !id ? (
          notFound ? (
            <ErrorState
              testID="match-detail.not-found"
              title={t('matches.detail.notFoundTitle')}
              message={t('matches.errors.notFound')}
              retryLabel={t('common.back')}
              onRetry={back}
            />
          ) : (
            <ErrorState
              testID="match-detail.error"
              title={t('errors.loadFailedTitle')}
              message={t('matches.link.error')}
              retryLabel={t('common.retry')}
              onRetry={() => void match.refetch()}
              busy={match.isRefetching}
            />
          )
        ) : (
          <SkeletonList rows={3} height={140} />
        )}
      </Screen>
    );
  }

  if (view.restricted) {
    return (
      <Screen edges={[]}>
        {header}
        <ScrollView
          contentContainerStyle={{ paddingTop: space.sm, paddingBottom: 40 + insets.bottom }}
        >
          <MatchRestrictedCard
            testID="match-detail"
            when={`${nightLabel(view.startAt, knobs, nowMs, t, locale)} · ${formatTime(new Date(view.startAt), locale, view.timezone ?? tz)}`}
            branch={
              view.venue
                ? pickLocale({ en: view.venue.nameEn ?? '', ar: view.venue.nameAr ?? '' }, locale)
                : null
            }
            category={view.category}
            message={t(refusalKey(view.refusal))}
            onFind={findAnother}
          />
        </ScrollView>
      </Screen>
    );
  }

  const d = view;
  const cat = d.category;
  const me = d.me;
  const start = new Date(d.startAt);
  const state = guestStateOf(stateInputOfDetail(d));
  const ownSeat = ownSeatOf(me.seats);
  const isOrganiser = me.role === 'organiser';
  const live = d.status !== null && LIVE_MATCH_STATUSES.includes(d.status);
  const court = d.courtId ? courts.data?.find((c) => c.id === d.courtId) : null;
  const courtName = court ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale) : null;
  const card = actionCardOf(d, { genderUnset, nowMs });
  // The seats the card shows, and so the seats every write sends: a poll that
  // lowers seats_left under the picked count clamps it (the stepper and the
  // friends' declaration answer this count, OM-39).
  const pickedSeats =
    card.kind === 'join' || card.kind === 'ask' || card.kind === 'buy'
      ? Math.min(seatsWanted, card.maxSeats)
      : 1;
  const available = wallet.data?.available ?? me.ticketsAvailable;
  const share = partyShareIqd(state, me.seats);
  const line = stateLine(
    state,
    {
      t,
      locale,
      category: cat,
      timezone: tz,
      isOrganiser,
      seatsTaken: d.seatsTaken,
      fillDeadlineAt: d.fillDeadlineAt,
    },
    share,
  );

  // ── Poster lines ──────────────────────────────────────────────────────────
  const deadlineMs = d.fillDeadlineAt ? Date.parse(d.fillDeadlineAt) : NaN;
  const minutesLeft = Number.isFinite(deadlineMs)
    ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 60_000))
    : null;
  const fillLine =
    d.status === 'filling' && d.fillDeadlineAt
      ? {
          text: [
            t('matches.detail.fillsBy', {
              time: formatTime(new Date(d.fillDeadlineAt), locale, tz),
            }),
            minutesLeft !== null && minutesLeft < 60
              ? t('matches.detail.timeLeft', {
                  minutes: countPhrase('matches.count.minutes', minutesLeft, locale),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          urgent: minutesLeft !== null && minutesLeft < 30,
        }
      : null;
  const day = nightLabel(d.startAt, knobs, nowMs, t, locale);

  // ── Writes ────────────────────────────────────────────────────────────────
  const busy =
    join.isPending ||
    request.isPending ||
    withdraw.isPending ||
    leave.isPending ||
    cancel.isPending;

  /** §4.10.3: remember the join or request, then buy what is missing. */
  const buyThen = (kind: 'join' | 'request', count: number) => {
    setTicketContinuation({
      kind,
      savedAt: new Date().toISOString(),
      matchId: d.id,
      token,
      friends: friendsFor(cat, pickedSeats),
    });
    router.push(ticketsHref(count, kind));
  };

  const onJoinError = (err: Error, kind: 'join' | 'request') => {
    switch (joinRefusalOf(errorCodeOf(err))) {
      case 'tickets':
        buyThen(kind, ticketsToBuy(err, { seats: pickedSeats, available }));
        return;
      case 'gender':
        setActionError(t('matches.errors.genderRequired'));
        void match.refetch();
        return;
      case 'phone':
        router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
        return;
      case 'terms':
        if (needsTerms) router.push('/accept-terms');
        else setActionError(t('matches.errors.updateApp'));
        return;
      default:
        setActionError(matchErrorText(err, t, errorCtx));
    }
  };

  /** The phone step first, for an unverified guest; true when it went there. */
  const verifyFirst = () => {
    if (!unverified) return false;
    router.push({
      pathname: '/phone-sign-in',
      params: { returnTo: 'back', phone: profile.data?.phone ?? '' },
    });
    return true;
  };

  const onJoin = (kind: 'join' | 'request') => {
    setActionError(null);
    if (verifyFirst()) return;
    const missing = missingTickets(available, pickedSeats);
    if (missing > 0) {
      buyThen(kind, missing);
      return;
    }
    const vars = { matchId: d.id, friends: friendsFor(cat, pickedSeats), token };
    if (kind === 'join') {
      join.mutate(vars, {
        onSuccess: () => toast(t('matches.detail.joined')),
        onError: (err) => onJoinError(err, 'join'),
      });
    } else {
      request.mutate(vars, {
        onSuccess: () => toast(t('matches.detail.requestSent')),
        onError: (err) => onJoinError(err, 'request'),
      });
    }
  };

  const onWithdraw = () => {
    if (!me.request) return;
    setActionError(null);
    withdraw.mutate(me.request.requestId, {
      onSuccess: () => toast(t('matches.detail.withdrawn'), 'info'),
      onError: (err) => setActionError(matchErrorText(err, t, errorCtx)),
    });
  };

  const askLeave = () => {
    const lc = leaveConfirm(d);
    const body = [
      lc?.outcome === 'locked_until_refill'
        ? t('matches.detail.leaveLocked', { start: formatTime(start, locale, tz) })
        : t('matches.detail.leaveRelease'),
      lc?.withFriends && lc.outcome === 'release' ? t('matches.detail.leaveFriends') : null,
      lc?.organiser ? t('matches.detail.leaveOrganiser') : null,
    ]
      .filter(Boolean)
      .join(' ');
    setConfirm({
      title: t('matches.detail.leaveTitle'),
      body,
      confirmLabel: t('matches.detail.leaveConfirm'),
      cancelLabel: t('matches.detail.stay'),
      destructive: true,
      run: () =>
        leave.mutate(
          { matchId: d.id },
          {
            onSuccess: () => toast(t('matches.detail.left'), 'info'),
            onError: (err) => setActionError(matchErrorText(err, t, errorCtx)),
          },
        ),
    });
  };

  const onGender = (gender: Gender) => {
    setActionError(null);
    setGenderBusy(gender);
    setGender.mutate(gender, {
      onError: (err) => {
        if (errorCodeOf(err) === 'GENDER_ALREADY_SET')
          toast(t('matches.errors.genderAlreadySet'), 'info');
        else setActionError(matchErrorText(err, t, errorCtx));
      },
      onSettled: () => setGenderBusy(null),
    });
  };

  const onDecide = (requestId: string, approve: boolean) => {
    setDeciding({ id: requestId, approve });
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    decide.mutate(
      { requestId, approve },
      {
        onSuccess: () =>
          toast(t(approve ? 'matches.detail.approved' : 'matches.detail.declined'), 'info'),
        onError: (err) => {
          // REQUESTER_INELIGIBLE keeps the row, says why on it, and leaves Decline enabled.
          const text =
            errorCodeOf(err) === 'REQUESTER_INELIGIBLE'
              ? t('matches.errors.requesterIneligible')
              : matchErrorText(err, t, errorCtx);
          setRowErrors((prev) => ({ ...prev, [requestId]: text }));
        },
        onSettled: () => setDeciding(null),
      },
    );
  };

  const askCancel = async () => {
    const reason = await nativeChoice<OrganiserCancelReason>({
      title: t('matches.detail.cancelWhy'),
      options: ORGANISER_CANCEL_REASONS.map((r) => ({ value: r, label: t(CANCEL_REASON_KEY[r]) })),
      cancelLabel: t('common.cancel'),
    });
    if (!reason) return;
    setConfirm({
      title: t('matches.detail.cancelTitle'),
      body: t('matches.detail.cancelBody'),
      confirmLabel: t('matches.detail.cancelConfirm'),
      cancelLabel: t('common.keepIt'),
      destructive: true,
      run: () =>
        cancel.mutate(
          { matchId: d.id, reason },
          {
            onSuccess: () => toast(t('matches.detail.cancelled'), 'info'),
            onError: (err) => setActionError(matchErrorText(err, t, errorCtx)),
          },
        ),
    });
  };

  /** Report opens the modal; block and remove confirm first (§4.14 Confirms). */
  const report = (target: { seatId?: string; requestId?: string }, name: string) =>
    router.push({
      pathname: '/match-report',
      params: { matchId: d.id, name, category: cat, ...target },
    });

  const askBlock = (target: { seatId?: string; requestId?: string }, name: string) =>
    setConfirm({
      title: t('matches.detail.blockTitle', { name }),
      body: t(byCategory(cat, 'matches.detail.blockBody')),
      confirmLabel: t('matches.detail.block'),
      destructive: true,
      run: () =>
        block.mutate(
          { matchId: d.id, ...target },
          {
            onSuccess: () => toast(t('matches.detail.blocked'), 'info'),
            onError: (err) => setActionError(matchErrorText(err, t, errorCtx)),
          },
        ),
    });

  const canGiveUp = (s: MatchSeat) =>
    s.isMine && s.kind === 'friend' && s.status === 'in' && me.can.leave;
  const hasMenu = (s: MatchSeat) => s.can.remove || s.can.report || s.can.block || canGiveUp(s);

  const onSeatMenu = async (seat: MatchSeat, name: string) => {
    type Pick = 'remove' | 'report' | 'block' | 'giveUp';
    const options: { value: Pick; label: string; destructive?: boolean }[] = [];
    if (canGiveUp(seat))
      options.push({ value: 'giveUp', label: t('matches.detail.giveUp'), destructive: true });
    if (seat.can.remove)
      options.push({ value: 'remove', label: t('matches.detail.remove'), destructive: true });
    if (seat.can.report) options.push({ value: 'report', label: t('matches.detail.report') });
    if (seat.can.block)
      options.push({ value: 'block', label: t('matches.detail.block'), destructive: true });
    const pick = await nativeChoice<Pick>({
      title: t('matches.detail.seatMenu', { name }),
      options,
      cancelLabel: t('common.cancel'),
    });
    if (pick === 'report') report({ seatId: seat.seatId }, name);
    else if (pick === 'block') askBlock({ seatId: seat.seatId }, name);
    else if (pick === 'remove') {
      setConfirm({
        title: t('matches.detail.removeTitle', { name }),
        body: t(byCategory(cat, 'matches.detail.removeBody')),
        confirmLabel: t('matches.detail.remove'),
        destructive: true,
        run: () =>
          remove.mutate(
            { matchId: d.id, seatId: seat.seatId },
            {
              onSuccess: () => toast(t('matches.detail.removed'), 'info'),
              onError: (err) => setActionError(matchErrorText(err, t, errorCtx)),
            },
          ),
      });
    } else if (pick === 'giveUp') {
      setConfirm({
        title: t('matches.detail.giveUpTitle'),
        body: t('matches.detail.giveUpBody'),
        confirmLabel: t('matches.detail.giveUp'),
        cancelLabel: t('matches.detail.stay'),
        destructive: true,
        run: () =>
          leave.mutate(
            { matchId: d.id, seatIds: [seat.seatId] },
            { onError: (err) => setActionError(matchErrorText(err, t, errorCtx)) },
          ),
      });
    }
  };

  const onRequestMenu = async (requestId: string, name: string) => {
    const pick = await nativeChoice<'report' | 'block'>({
      title: t('matches.detail.seatMenu', { name }),
      options: [
        { value: 'report', label: t('matches.detail.report') },
        { value: 'block', label: t('matches.detail.block'), destructive: true },
      ],
      cancelLabel: t('common.cancel'),
    });
    if (pick === 'report') report({ requestId }, name);
    else if (pick === 'block') askBlock({ requestId }, name);
  };

  const onMessage = (code: MessageCode) => {
    message.mutate(
      { matchId: d.id, code },
      {
        onSuccess: () => {
          toast(t('matches.messages.sent'));
          setRestUntil((prev) => ({ ...prev, [code]: Date.now() + MESSAGE_REST_MS }));
        },
        onError: (err) => toast(matchErrorText(err, t, errorCtx), 'error'),
      },
    );
  };
  const resting = new Set(
    (Object.keys(restUntil) as MessageCode[]).filter((c) => (restUntil[c] ?? 0) > deviceNow),
  );
  const showMessages =
    me.can.message &&
    d.status !== null &&
    LIVE_MATCH_STATUSES.includes(d.status) &&
    Date.parse(d.endAt) > nowMs;

  // ── The action card (§4.14 table) ─────────────────────────────────────────
  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const lead = { fontFamily: fonts.body700, fontSize: 14, lineHeight: 20, color: colors.ink };

  const seatsStepper = (maxSeats: number, wanted: number) =>
    maxSeats > 1 ? (
      <>
        <MicroLabel style={{ marginBottom: 6 }}>{t('matches.detail.seats')}</MicroLabel>
        <SegmentedControl<number>
          testID="match-detail.seats-wanted"
          options={Array.from({ length: maxSeats }, (_, i) => ({
            value: i + 1,
            label:
              i === 0
                ? t('matches.create.seatsMe')
                : t('matches.create.seatsMePlus', { extra: isolateLtr(`+${i}`) }),
          }))}
          value={wanted}
          onChange={setSeatsWanted}
        />
        {needsFriendsDeclaration(cat, wanted) ? (
          <Pressable
            testID="match-detail.friends-gender-row"
            accessibilityRole="switch"
            accessibilityState={{ checked: declaredFor === wanted }}
            onPress={() => setDeclaredFor(declaredFor === wanted ? null : wanted)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              marginTop: space.sm,
            }}
          >
            <Switch
              testID="match-detail.friends-gender"
              value={declaredFor === wanted}
              onValueChange={(on) => setDeclaredFor(on ? wanted : null)}
              trackColor={{ true: colors.blue, false: colors.line }}
              accessibilityLabel={t(
                cat === 'women' ? 'matches.create.friendsWomen' : 'matches.create.friendsMen',
              )}
            />
            <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink }}>
              {t(cat === 'women' ? 'matches.create.friendsWomen' : 'matches.create.friendsMen')}
            </Text>
          </Pressable>
        ) : null}
      </>
    ) : null;

  const leaveButton = me.can.leave ? (
    <Button
      testID="match-detail.leave"
      label={t('matches.detail.leave')}
      variant="dangerOutline"
      size="compact"
      busy={leave.isPending}
      disabled={busy}
      onPress={askLeave}
      style={{ marginTop: space.sm }}
    />
  ) : null;

  const actionCard = (() => {
    switch (card.kind) {
      case 'excluded':
        return <Text style={lead}>{t(byCategory(cat, 'matches.detail.excluded'))}</Text>;
      case 'requested':
        return (
          <>
            <Text style={lead}>
              {t(byCategory(cat, 'matches.detail.requested'), {
                tickets: countPhrase('matches.count.tickets', card.tickets, locale),
              })}
            </Text>
            {me.can.withdraw ? (
              <Button
                testID="match-detail.withdraw"
                label={t('matches.detail.withdraw')}
                variant="secondary"
                size="compact"
                busy={withdraw.isPending}
                disabled={busy}
                onPress={onWithdraw}
                style={{ marginTop: space.sm }}
              />
            ) : null}
          </>
        );
      case 'in':
        return (
          <>
            <Text style={lead}>
              {t('matches.detail.inWaiting', {
                players: countPhrase(
                  byCategory(cat, 'matches.count.playersNeeded'),
                  Math.max(0, SEATS_TOTAL - d.seatsTaken),
                  locale,
                ),
              })}
            </Text>
            {leaveButton}
          </>
        );
      case 'awaitingCourt':
        return (
          <>
            <Text style={lead}>{t('matches.detail.awaitingCourt')}</Text>
            {leaveButton}
          </>
        );
      case 'booked':
        return (
          <>
            <Text style={lead}>
              {share !== null
                ? courtName
                  ? t('matches.detail.booked', { court: courtName, share: money(share) })
                  : t('matches.detail.bookedNoCourt', { share: money(share) })
                : line}
            </Text>
            {leaveButton}
          </>
        );
      case 'gender':
        return <GenderAsk testID="match-detail.gender" busy={genderBusy} onPick={onGender} />;
      case 'join':
      case 'ask':
      case 'buy': {
        const kind =
          card.kind === 'join' || (card.kind === 'buy' && card.mode === 'join')
            ? 'join'
            : 'request';
        const missing =
          card.kind === 'buy'
            ? Math.max(card.missing, missingTickets(available, pickedSeats))
            : missingTickets(available, pickedSeats);
        const declared = !needsFriendsDeclaration(cat, pickedSeats) || declaredFor === pickedSeats;
        return (
          <>
            {seatsStepper(card.maxSeats, pickedSeats)}
            {missing > 0 ? (
              <>
                <Text style={[lead, { marginTop: card.maxSeats > 1 ? space.m : 0 }]}>
                  {/* The zero form is a sentence of its own ("No tickets yet"),
                      so an empty wallet has its own line (§4.24). */}
                  {available > 0
                    ? t('matches.detail.youHave', {
                        ready: countPhrase('matches.count.ticketsReady', available, locale),
                      })
                    : t('matches.detail.youHaveNone')}
                </Text>
                <Button
                  testID="match-detail.buy"
                  label={t(
                    kind === 'join' ? 'matches.detail.buyAndJoin' : 'matches.detail.buyAndAsk',
                    {
                      tickets: countPhrase('matches.count.ticketsGen', missing, locale),
                    },
                  )}
                  variant="cta"
                  disabled={!declared}
                  // Before the purchase: the ticket continuation replays the join.
                  onPress={() => {
                    if (!verifyFirst()) buyThen(kind, missing);
                  }}
                  style={{ marginTop: space.sm }}
                />
              </>
            ) : kind === 'join' ? (
              <Button
                testID="match-detail.join"
                label={t('matches.detail.join')}
                variant="cta"
                busy={join.isPending}
                disabled={busy || !declared}
                onPress={() => onJoin('join')}
                style={{ marginTop: card.maxSeats > 1 ? space.m : 0 }}
              />
            ) : (
              <Button
                testID="match-detail.ask"
                label={t('matches.detail.ask')}
                variant="cta"
                busy={request.isPending}
                disabled={busy || !declared}
                onPress={() => onJoin('request')}
                style={{ marginTop: card.maxSeats > 1 ? space.m : 0 }}
              />
            )}
            <Text style={[body, { marginTop: 6 }]}>
              {kind === 'join'
                ? countPhrase('matches.count.ticketsUse', pickedSeats, locale)
                : t(byCategory(cat, 'matches.detail.askCaption'), {
                    tickets: countPhrase('matches.count.ticketsGen', pickedSeats, locale),
                  })}
            </Text>
          </>
        );
      }
      case 'refusal': {
        const text =
          card.code === 'TERMS_REQUIRED' && !needsTerms
            ? t('matches.errors.updateApp')
            : t(refusalKey(card.code));
        return (
          <>
            <MatchNotice text={text} tone={card.code === 'MATCH_BANNED' ? 'red' : 'amber'} />
            {card.code === 'MATCH_BANNED' && phone ? (
              <Button
                testID="match-detail.call-branch"
                label={t('matches.detail.callBranch', {
                  branch: branchLabel ?? t('common.appName'),
                })}
                variant="secondary"
                size="compact"
                onPress={callVenue}
                style={{ marginTop: space.sm }}
              />
            ) : null}
            {card.code === 'PHONE_REQUIRED' ? (
              <Button
                testID="match-detail.add-phone"
                label={t('auth.addPhoneLink')}
                variant="secondary"
                size="compact"
                onPress={() =>
                  router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } })
                }
                style={{ marginTop: space.sm }}
              />
            ) : null}
          </>
        );
      }
      case 'state':
        return <Text style={lead}>{line}</Text>;
    }
  })();

  // The money card is for members: a seat still in play, or played.
  const member = ownSeat !== null && (ownSeat.status === 'in' || ownSeat.status === 'attended');
  const ticketsHere = me.seats.filter((s) => s.ticketStatus === 'in_use').length;

  return (
    <Screen edges={[]}>
      {header}
      <ScrollView
        contentContainerStyle={{ paddingTop: space.sm, paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <MatchPoster
          time={formatTime(start, locale, tz)}
          when={branchLabel ? t('matches.detail.when', { day, branch: branchLabel }) : day}
          category={cat}
          chips={[
            t(
              d.visibility === 'link'
                ? 'matches.detail.visibilityLink'
                : 'matches.detail.visibilityPublic',
            ),
            d.joinPolicy === 'approve'
              ? t(byCategory(cat, 'matches.detail.policyApprove'))
              : t('matches.detail.policyOpen'),
            t('booking.durationMinutes', { minutes: d.durationMin }),
          ]}
          seatsLine={`${seatsOfLabel(d.seatsTaken, t, d.seatsTotal)} · ${countPhrase('matches.count.seatsLeft', d.seatsLeft, locale)}`}
          fillLine={fillLine}
          courtLine={
            d.status === 'booked' && courtName
              ? t('matches.detail.court', { name: courtName })
              : null
          }
          stateLine={!live && state.state !== 'unknown' ? line : null}
        >
          <SeatGrid
            testID="match-detail.seats"
            seats={d.seats}
            category={cat}
            hasMenu={hasMenu}
            onMenu={onSeatMenu}
          />
        </MatchPoster>

        <Card style={{ marginTop: space.m }}>
          <View testID="match-detail.action">{actionCard}</View>
          <ErrorText>{actionError}</ErrorText>
        </Card>

        {member ? (
          <View style={{ marginTop: space.m }}>
            <MatchMoneyCard
              share={share !== null ? money(share) : null}
              tickets={ticketsHere > 0 ? isolateLtr(String(ticketsHere)) : null}
              desk={ownSeat?.kind === 'desk'}
            />
          </View>
        ) : null}

        {isOrganiser ? (
          <>
            {me.can.decide && d.requests.length > 0 ? (
              <>
                <MatchSectionTitle>{t('matches.detail.requestsTitle')}</MatchSectionTitle>
                <View style={{ gap: space.s }}>
                  {d.requests.map((r) => {
                    const name = displayName(r, cat, t);
                    return (
                      <RequestRow
                        key={r.requestId}
                        testID={`match-detail.request.${r.requestId}`}
                        name={name}
                        line={t('matches.detail.requestLine', {
                          games: countPhrase('matches.count.games', r.gamesPlayed, locale),
                          noShows: countPhrase('matches.count.noShows', r.noShows, locale),
                          seats: countPhrase('matches.count.seats', r.seatsRequested, locale),
                        })}
                        error={rowErrors[r.requestId] ?? null}
                        busy={
                          deciding?.id === r.requestId
                            ? deciding.approve
                              ? 'approve'
                              : 'decline'
                            : null
                        }
                        onApprove={() => onDecide(r.requestId, true)}
                        onDecline={() => onDecide(r.requestId, false)}
                        onMenu={() => void onRequestMenu(r.requestId, name)}
                      />
                    );
                  })}
                </View>
              </>
            ) : null}
            {(d.shareToken && me.can.share) || me.can.cancel ? (
              <View style={{ marginTop: space.m, gap: space.sm }}>
                {d.shareToken && me.can.share ? (
                  <Button
                    testID="match-detail.share"
                    label={t('matches.detail.share')}
                    variant="primary"
                    size="compact"
                    onPress={onShare}
                  />
                ) : null}
                {me.can.cancel ? (
                  <Button
                    testID="match-detail.cancel"
                    label={t('matches.detail.cancel')}
                    variant="dangerOutline"
                    size="compact"
                    busy={cancel.isPending}
                    disabled={busy}
                    onPress={() => void askCancel()}
                  />
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

        {showMessages || lines.length > 0 ? (
          <>
            <MatchSectionTitle>{t('matches.messages.title')}</MatchSectionTitle>
            {showMessages ? (
              <View style={{ marginBottom: space.sm }}>
                <QuickMessageBar
                  testID="match-detail.message"
                  resting={resting}
                  busy={message.isPending ? (message.variables?.code ?? null) : null}
                  onSend={onMessage}
                />
              </View>
            ) : null}
            <MatchMessages lines={lines} />
          </>
        ) : null}

        <View style={{ marginTop: space.l }}>
          <MatchRulesCard testID="match-detail.rules" />
        </View>

        {phone ? (
          <View style={{ marginTop: space.l, alignItems: 'center' }}>
            <LinkText
              testID="match-detail.call-venue"
              label={t('matches.detail.questions', { branch: branchLabel ?? t('common.appName') })}
              onPress={callVenue}
            />
          </View>
        ) : null}
      </ScrollView>

      <ConfirmAlert
        visible={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.confirmLabel ?? ''}
        cancelLabel={confirm?.cancelLabel}
        destructive={confirm?.destructive}
        onConfirm={() => {
          const run = confirm?.run;
          setConfirm(null);
          run?.();
        }}
        onDismiss={() => setConfirm(null)}
      />
    </Screen>
  );
}

export default function GuardedMatchDetailScreen() {
  return (
    <RequireSession>
      <MatchDetailScreen />
    </RequireSession>
  );
}
