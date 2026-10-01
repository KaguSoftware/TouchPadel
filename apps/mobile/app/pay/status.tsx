import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  countPhrase,
  formatDate,
  formatDateTime,
  formatIQD,
  formatTimeRange,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { RequireSession } from '../../src/features/auth/RequireSession';
import { useAuth } from '../../src/features/auth/context';
import { useConfirmBooking, useReleaseHold } from '../../src/features/booking/hooks';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode } from '../../src/features/booking/errors';
import { useAllCourts, useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { requestBookingSheet } from '../../src/features/courtTransition/openIntent';
import {
  forgetPendingPayment,
  loadPendingPayment,
  useDepositStatus,
  useRefreshAfterPayment,
  useStartPayment,
} from '../../src/features/deposit/hooks';
import {
  failureTextKey,
  fetchFailureOf,
  holdIdOf,
  isTerminalScreen,
  isTicketPayment,
  screenFor,
  secondsLeft,
  serverNowMs,
  ticketBeginRefusalOf,
  type DepositStatus,
  type PayScreen,
} from '../../src/features/deposit/logic';
import { claimResume } from '../../src/features/deposit/pendingPayment';
import { useRunTicketContinuation, useStartTicketPurchase } from '../../src/features/matches/tickets';
import {
  clearTicketContinuation,
  continuationBackHref,
  continuationFor,
  continuationPlan,
  setTicketContinuation,
  type TicketContinuation,
} from '../../src/features/matches/continuation';
import { matchErrorText } from '../../src/features/matches/errors';
import { openPaymentPage } from '../../src/features/deposit/browser';
import { PayStateLayout, type PayTone } from '../../src/features/deposit/PayStateLayout';
import { callPhone } from '../../src/lib/phone';
import { useBackGuard } from '../../src/navigation/back';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Card, DashedDivider, ErrorText, Screen } from '../../src/components/ui';
import { SummaryGrid, type SummaryRow } from '../../src/components/booking';
import { ConfirmAlert, useToast } from '../../src/components/overlays';
import { ErrorState } from '../../src/components/states';
import { CalendarIcon, CardIcon, ClockIcon, TagIcon } from '../../src/components/icons';

/**
 * THE payment screen (build-contracts-2026-09-27 §4; plan §5.3).
 *
 * It renders what `deposit-status` says and nothing else: `screenFor` (pure,
 * features/deposit/logic.ts) maps every server answer to exactly one state,
 * and this file only draws that state and wires its buttons. The rules it
 * keeps, each of which is a way a payment screen can lie:
 *
 *  - NEVER "paid" from anything but the server: a return link, a closed
 *    browser sheet or a push is a reason to ask again, not an answer;
 *  - NEVER "failed" from a failed request: offline, the screen holds the last
 *    answer (and the app's offline banner, or its own hint when the phone is
 *    online but the server is not answering);
 *  - NEVER a money action on the guest's side: "Leave" leaves; the reconciler
 *    and push finish the payment whether or not anyone is watching.
 *
 * Polls every 2 s for the first minute, then every 5 s until a minute past the
 * payment window (logic.ts `pollDelayMs`), and again whenever the app comes
 * back to the front. Mounting it twice for one ref (the return link and the
 * resume) is harmless: both read the same query.
 *
 * OPEN-MATCH TICKETS (docs/design/open-matches/guest.md §4.10.4) come through
 * the same screen with `purpose: 'ticket'`: no hold, no booking, no desk, so
 * the success, pay-at-desk and choose-another-time paths are the deposit's
 * alone, and success is `ticketsBought`. A purchase made for an action (a
 * join, a request, a new match) carries it as the pointer's `after`, read
 * here AT MOUNT, before the terminal effect forgets the pointer; once the
 * tickets are in, the same RPC runs once by itself (`continuationPlan`), or on
 * one tap when it is stale (§4.10.3).
 */
function PayStatusScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const params = useLocalSearchParams<{ ref?: string }>();
  const ref = typeof params.ref === 'string' ? params.ref.trim() : '';

  const [startedAtMs] = useState(() => Date.now());
  const status = useDepositStatus(ref, startedAtMs);
  const refresh = useRefreshAfterPayment();
  const confirm = useConfirmBooking();
  const release = useReleaseHold();
  const payment = useStartPayment();
  const ticketPurchase = useStartTicketPurchase();
  const runner = useRunTicketContinuation();
  const courts = useAllCourts();
  const [error, setError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  // This ref is on screen now: neither resume path may open it a second time.
  useEffect(() => {
    if (ref) claimResume(ref);
  }, [ref]);

  // The pointer's continuation, read once at mount (§4.10.3 step 3): the
  // terminal effect below forgets the pointer, so it waits for this read.
  const [pointer, setPointer] = useState<{ read: boolean; after: TicketContinuation | null }>(() => ({
    read: !userId || !ref,
    after: null,
  }));
  useEffect(() => {
    if (!userId || !ref) return;
    let live = true;
    void loadPendingPayment(userId).then((stored) => {
      if (live) setPointer({ read: true, after: stored?.ref === ref ? (stored.after ?? null) : null });
    });
    return () => {
      live = false;
    };
  }, [userId, ref]);
  // This app life's own copy wins for the same ref; the pointer's survives a kill.
  const continuation = useMemo(
    () => (ref && pointer.read ? continuationFor(ref, pointer.after) : null),
    [ref, pointer],
  );

  const data: DepositStatus | null = status.data ?? null;
  const isTicket = isTicketPayment(data);
  // A clock that moves between polls, so the countdown ticks and the window
  // can close on screen even while a poll is paused offline.
  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  const nowMs = serverNowMs(data?.serverNow ?? null, status.dataUpdatedAt, deviceNow);
  const failure = ref ? fetchFailureOf(status.error) : 'not_found';
  const screen: PayScreen = screenFor({ status: data, failure, nowMs });

  useEffect(() => {
    if (screen.kind !== 'checking') return;
    const id = setInterval(() => setDeviceNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [screen.kind]);

  const reservation = data?.reservation ?? null;
  const court = reservation?.courtId
    ? (courts.data ?? []).find((c) => c.id === reservation.courtId)
    : undefined;
  const courtName = court ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale) : '';
  // The booking's own branch: its phone is the one to call about this money.
  const settings = useVenueSettings(reservation?.venueId ?? (data ? undefined : null));
  const phone = venuePhoneOf(settings.data);
  const holdId = data ? holdIdOf(data, null) : null;

  // ── Leaving while the bank is still working ─────────────────────────────
  // The back item and Android's back are guarded while checking: leaving is
  // always allowed, but the guest is told first that it costs them nothing.
  // Every navigation this screen makes itself goes through `leave` too, which
  // lifts the guard for good before it runs.
  const leave = useBackGuard({
    when: screen.kind === 'checking',
    // The blocked pop is discarded either way: confirming goes to My
    // reservations, never back into Review or the booking sheet.
    onBlocked: () => setLeaveOpen(true),
  });
  const go = (to: () => void) => leave(to);

  const toBookings = () => go(() => router.replace('/(tabs)/bookings'));
  const toTickets = () => go(() => router.replace('/tickets'));
  const toGrid = () =>
    go(() => {
      requestBookingSheet();
      router.navigate('/(tabs)');
    });

  // ── The answer is final: forget the pointer, refresh what shows bookings ──
  // (and the wallet: useRefreshAfterPayment covers the match family too).
  const terminal = isTerminalScreen(screen.kind);
  useEffect(() => {
    if (!terminal || !pointer.read) return;
    if (userId && ref) void forgetPendingPayment(userId, ref);
    refresh();
  }, [terminal, pointer.read, userId, ref, refresh]);

  // ── Tickets in: continue into what they were bought for (§4.10.3) ─────────
  const runContinuationNow = (c: TicketContinuation) => {
    setError(null);
    void runner.run(c).then(
      (result) => {
        toast(
          t(
            c.kind === 'join'
              ? 'matches.pay.joined'
              : c.kind === 'request'
                ? 'matches.pay.requestSent'
                : 'matches.pay.started',
          ),
          'success',
        );
        go(() =>
          router.replace({
            pathname: '/match/[id]',
            params: c.kind !== 'start' && c.token ? { id: result.matchId, t: c.token } : { id: result.matchId },
          }),
        );
      },
      (err: unknown) => {
        // Nothing is retried by itself: the refusal, where the tickets are,
        // and back to the match (a start re-quotes on its form).
        toast(`${matchErrorText(err, t, { locale, phone })} ${t('matches.pay.ticketsKept')}`, 'error');
        go(() => router.replace(continuationBackHref(c)));
      },
    );
  };
  const [plan, setPlan] = useState<'auto' | 'tap' | 'none' | null>(null);
  useEffect(() => {
    // Once, when the tickets first show: an `auto` answer spends the ref's claim.
    if (screen.kind !== 'ticketsBought' || !pointer.read || plan !== null) return;
    const next = continuationPlan(ref, continuation, Date.now());
    setPlan(next);
    if (next === 'auto' && continuation) runContinuationNow(continuation);
    // `runContinuationNow` is rebuilt every render; the kind and the read are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.kind, pointer.read, plan]);

  // ── Paid and booked: the success screen takes over, with the deposit line ─
  const navigated = useRef(false);
  useEffect(() => {
    if (screen.kind !== 'confirmed' || !data || navigated.current) return;
    navigated.current = true;
    const start = reservation?.startAt ? new Date(reservation.startAt) : null;
    const end = reservation?.endAt ? new Date(reservation.endAt) : null;
    go(() =>
      router.replace({
        pathname: '/success',
        params: {
          reservationId: reservation?.id ?? '',
          courtNameEn: court?.name_en ?? '',
          courtNameAr: court?.name_ar ?? '',
          startAt: reservation?.startAt ?? '',
          durationMin:
            start && end ? String(Math.round((end.getTime() - start.getTime()) / 60_000)) : '',
          priceIqd: data.priceIqd == null ? '' : String(data.priceIqd),
          paidOnlineIqd: data.amountIqd == null ? '' : String(data.amountIqd),
          deskIqd: data.restIqd == null ? '' : String(data.restIqd),
        },
      }),
    );
    // `go` and `router` are stable for this purpose; the kind is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.kind, data]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const money = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isInteger(n) ? isolate(formatIQD(n, locale)) : '';

  const openAgain = () => {
    if (!data?.formUrl) return;
    // Whatever the sheet ends with, ask the server: the bank may have
    // answered one second before the guest closed it.
    void openPaymentPage(data.formUrl).then(() => void status.refetch());
  };

  const callVenue = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const tryAgain = () => {
    if (!holdId) return;
    setError(null);
    payment.start(holdId, {
      beforeNavigate: () => leave(() => {}),
      onError: (err) => {
        const code = rpcErrorCode(err.message);
        if (code === 'HOLD_EXPIRED' || code === 'TOO_MANY_ATTEMPTS' || code === 'DEPOSITS_OFF') {
          // The server's answer has moved on: show the state it moved to.
          void status.refetch();
        }
        setError(
          isDegradedRefusal(err.message)
            ? phone
              ? t('degraded.bookingRefused', { phone: isolate(phone) })
              : t('degraded.bookingRefusedShort')
            : t(mapErrorToKey(err)),
        );
      },
    });
  };

  /**
   * A new `ticket-begin` for a failed or expired purchase: the same count, and
   * the same continuation riding on it (§4.10.4). A refusal reads as on the
   * tickets screen (§4.10.1).
   */
  const tryAgainTickets = () => {
    const count = data?.ticketCount ?? 0;
    if (count < 1) return;
    setError(null);
    if (continuation) setTicketContinuation(continuation);
    ticketPurchase.start(count, {
      beforeNavigate: () => leave(() => {}),
      onError: (err) => {
        switch (ticketBeginRefusalOf(err)) {
          case 'phone':
            go(() => router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } }));
            return;
          case 'terms':
            go(() => router.push('/accept-terms'));
            return;
          case 'walletLimit':
            setError(t('matches.errors.walletLimit'));
            return;
          case 'tooManyAttempts':
            void status.refetch();
            setError(t('matches.tickets.tooManyAttempts'));
            return;
          case 'inline':
            setError(matchErrorText(err, t, { locale, phone }));
            return;
        }
      },
    });
  };

  /** Leave a purchase that did not go through: back to what it was for, else the wallet. */
  const backFromTickets = () => {
    const c = continuation;
    clearTicketContinuation();
    if (c) go(() => router.replace(continuationBackHref(c)));
    else toTickets();
  };

  const payAtDesk = () => {
    if (!holdId || !data) return;
    setError(null);
    confirm.mutate(
      { holdId },
      {
        onSuccess: (result) => {
          if (userId && ref) void forgetPendingPayment(userId, ref);
          const start = reservation?.startAt ? new Date(reservation.startAt) : null;
          const end = reservation?.endAt ? new Date(reservation.endAt) : null;
          go(() =>
            router.replace({
              pathname: '/success',
              params: {
                reservationId: result.reservation_id ?? holdId,
                courtNameEn: court?.name_en ?? '',
                courtNameAr: court?.name_ar ?? '',
                startAt: reservation?.startAt ?? '',
                durationMin:
                  start && end
                    ? String(Math.round((end.getTime() - start.getTime()) / 60_000))
                    : '',
                priceIqd: String(result.price_iqd ?? data.priceIqd ?? ''),
              },
            }),
          );
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : null;
          // DEPOSIT_REQUIRED: the mode changed under the guest; the refetch
          // takes "Pay at the desk instead" off the screen.
          void status.refetch();
          setError(
            isDegradedRefusal(message)
              ? phone
                ? t('degraded.bookingRefused', { phone: isolate(phone) })
                : t('degraded.bookingRefusedShort')
              : t(mapErrorToKey(err)),
          );
        },
      },
    );
  };

  const chooseAnotherTime = () => {
    // The failed attempt's hold would otherwise sit on the slot until its
    // window ends and spend one of the guest's holds. Fire and forget: the
    // release outlives this screen in the mutation cache.
    if (holdId) release.mutate(holdId);
    toGrid();
  };

  const sandboxPill = data?.sandbox ? (
    // The App Review account pays in Qi's sandbox (contract §1): say
    // so, so a reviewer's screenshot can never pass for real money.
    <View
      style={{
        paddingStart: 9,
        paddingEnd: 9,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: radius.pill,
        backgroundColor: colors.amb,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 10,
          letterSpacing: tracking(0.5),
          textTransform: 'uppercase',
          color: colors.ambtext,
        }}
      >
        {t('deposit.sandbox')}
      </Text>
    </View>
  ) : null;

  const refundish =
    screen.kind === 'slotLost' ||
    screen.kind === 'refundPending' ||
    screen.kind === 'refunded' ||
    screen.kind === 'refundFailed';

  // ── The tickets the payment is for (§4.10.4): no court, date or time ──────
  const ticketSummary = (() => {
    if (!data || !isTicket) return null;
    const count = data.ticketCount ?? 0;
    const rows: SummaryRow[] = [];
    if (refundish) {
      rows.push({
        icon: CardIcon,
        label: t('deposit.refund'),
        value: formatIQD(data.refundAmountIqd ?? data.amountIqd ?? 0, locale),
        valueColor: colors.gtext,
        emphasis: true,
      });
    } else if (screen.kind !== 'expired' && data.amountIqd != null) {
      rows.push({
        icon: CardIcon,
        label: t(screen.kind === 'ticketsBought' ? 'deposit.paidOnline' : 'deposit.payingNow'),
        value: formatIQD(data.amountIqd, locale),
        valueColor: colors.gtext,
        emphasis: true,
      });
    }
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              alignSelf: 'flex-start',
              fontFamily: fonts.display900,
              fontSize: 18,
              textTransform: 'uppercase',
              color: colors.ink,
            }}
          >
            {count > 0
              ? `${t('matches.pay.summaryTitle')} ${t('matches.pay.summaryCount', { count: isolateLtr(String(count)) })}`
              : t('matches.pay.summaryTitle')}
          </Text>
          <View style={{ flex: 1 }} />
          {sandboxPill}
        </View>
        {rows.length > 0 ? (
          <>
            <DashedDivider style={{ marginTop: 12, marginBottom: 12 }} />
            <SummaryGrid rows={rows} />
          </>
        ) : null}
      </Card>
    );
  })();

  // ── The booking the payment is for ──────────────────────────────────────
  const summary = (() => {
    if (isTicket) return ticketSummary;
    if (!data || !reservation?.startAt) return null;
    const start = new Date(reservation.startAt);
    const end = reservation.endAt ? new Date(reservation.endAt) : null;
    const rows: SummaryRow[] = [
      { icon: CalendarIcon, label: t('booking.date'), value: formatDate(start, locale) },
      {
        icon: ClockIcon,
        label: t('booking.time'),
        value: end ? formatTimeRange(start, end, locale) : formatDateTime(start, locale),
      },
    ];
    if (refundish) {
      rows.push({
        icon: CardIcon,
        label: t('deposit.refund'),
        value: formatIQD(data.refundAmountIqd ?? data.amountIqd ?? 0, locale),
        valueColor: colors.gtext,
        emphasis: true,
      });
    } else if (screen.kind !== 'expired' && data.amountIqd != null) {
      rows.push({
        icon: CardIcon,
        label: t(screen.kind === 'paid' ? 'deposit.paidOnline' : 'deposit.payingNow'),
        value: formatIQD(data.amountIqd, locale),
        valueColor: colors.gtext,
        emphasis: true,
      });
      if (data.restIqd != null) {
        rows.push({
          icon: TagIcon,
          label: t('deposit.atDesk'),
          value: formatIQD(data.restIqd, locale),
        });
      }
    }
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text
            numberOfLines={1}
            // Shrink-wrapped to the leading edge: a court with no Arabic name
            // is Latin, which iOS would otherwise align to the trailing edge.
            style={{
              flexShrink: 1,
              alignSelf: 'flex-start',
              fontFamily: fonts.display900,
              fontSize: 18,
              textTransform: 'uppercase',
              color: colors.ink,
            }}
          >
            {courtName || t('booking.court')}
          </Text>
          <View style={{ flex: 1 }} />
          {sandboxPill}
        </View>
        <DashedDivider style={{ marginTop: 12, marginBottom: 12 }} />
        <SummaryGrid rows={rows} />
      </Card>
    );
  })();

  // ── One state ───────────────────────────────────────────────────────────
  const offlineHint =
    status.isError && failure !== 'not_found' && screen.kind !== 'error'
      ? t('deposit.offlineHint')
      : null;

  const view = (() => {
    const layout = (
      tone: PayTone,
      title: string,
      body: string,
      actions: ReactNode,
      notes: (string | null | false | undefined)[] = [],
      withSummary = true,
    ) => (
      <PayStateLayout
        testID={`pay-status.state.${screen.kind}`}
        tone={tone}
        title={title}
        body={body}
        notes={[...notes, offlineHint]}
        actions={
          <>
            <ErrorText>{error}</ErrorText>
            {actions}
          </>
        }
      >
        {withSummary ? summary : null}
      </PayStateLayout>
    );

    switch (screen.kind) {
      case 'loading':
        return layout('progress', t('deposit.checkingTitle'), t('deposit.checkingBody'), null, [], false);

      case 'error':
        return (
          <ErrorState
            testID="pay-status.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapErrorToKey(status.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void status.refetch()}
            busy={status.isRefetching}
          />
        );

      case 'notFound':
        return layout(
          'missing',
          t('deposit.notFoundTitle'),
          t('deposit.notFoundBody'),
          <Button
            testID="pay-status.bookings"
            label={t('booking.myBookings')}
            variant="cta"
            onPress={toBookings}
          />,
          [],
          false,
        );

      case 'checking': {
        const left = secondsLeft(data?.deadlineAt ?? null, nowMs);
        return layout(
          'progress',
          t('deposit.checkingTitle'),
          t('deposit.checkingBody'),
          <>
            {data?.formUrl ? (
              <Button
                testID="pay-status.open-again"
                label={t('deposit.openAgain')}
                variant="cta"
                onPress={openAgain}
              />
            ) : null}
            <Button
              testID="pay-status.leave"
              label={t('deposit.leave')}
              variant="ghost"
              onPress={() => setLeaveOpen(true)}
            />
          </>,
          [
            left !== null
              ? `${t('deposit.timeLeft')} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
              : null,
          ],
        );
      }

      case 'stillChecking':
        return layout(
          'wait',
          t('deposit.stillCheckingTitle'),
          t(isTicket ? 'matches.pay.stillCheckingBody' : 'deposit.stillCheckingBody'),
          <>
            {isTicket ? (
              <Button
                testID="pay-status.view-tickets"
                label={t('matches.pay.viewTickets')}
                variant="cta"
                onPress={toTickets}
              />
            ) : (
              <Button
                testID="pay-status.bookings"
                label={t('booking.myBookings')}
                variant="cta"
                onPress={toBookings}
              />
            )}
            <Button
              testID="pay-status.check-again"
              label={t('deposit.checkAgain')}
              variant="ghost"
              onPress={() => void status.refetch()}
            />
          </>,
        );

      case 'confirmed':
        // One frame: the effect above is already replacing this with /success.
        return layout(
          'good',
          t('booking.successTitle'),
          t('deposit.paidBody', { amount: money(data?.amountIqd) }),
          null,
          [],
          false,
        );

      case 'paid':
        return layout(
          'good',
          t('deposit.paidTitle'),
          t('deposit.paidBody', { amount: money(data?.amountIqd) }),
          reservation?.id ? (
            <Button
              testID="pay-status.view-booking"
              label={t('booking.viewBooking')}
              variant="cta"
              onPress={() =>
                go(() =>
                  router.replace({ pathname: '/booking/[id]', params: { id: reservation.id ?? '' } }),
                )
              }
            />
          ) : (
            <Button
              testID="pay-status.bookings"
              label={t('booking.myBookings')}
              variant="cta"
              onPress={toBookings}
            />
          ),
        );

      case 'ticketsBought': {
        const running = runner.busy;
        const runningKey =
          continuation?.kind === 'join'
            ? 'matches.pay.joining'
            : continuation?.kind === 'request'
              ? 'matches.pay.requesting'
              : 'matches.pay.starting';
        return layout(
          'good',
          t('matches.pay.ticketsBoughtTitle'),
          running
            ? t(runningKey)
            : t('matches.pay.ticketsBoughtBody', {
                tickets: countPhrase('matches.count.tickets', screen.count, locale),
              }),
          <>
            {/* §4.10.3 step 7: a continuation that did not run by itself runs on one tap. */}
            {plan === 'tap' && continuation ? (
              <Button
                testID={continuation.kind === 'start' ? 'pay-status.continue' : 'pay-status.back-to-match'}
                label={t(continuation.kind === 'start' ? 'matches.pay.continueStart' : 'matches.pay.backToMatch')}
                variant="cta"
                busy={running}
                onPress={() => runContinuationNow(continuation)}
              />
            ) : null}
            <Button
              testID="pay-status.view-tickets"
              label={t('matches.pay.viewTickets')}
              variant={plan === 'tap' && continuation ? 'ghost' : 'cta'}
              disabled={running}
              onPress={toTickets}
            />
          </>,
        );
      }

      case 'failed':
        if (isTicket) {
          return layout(
            'bad',
            t('deposit.failedTitle'),
            t(failureTextKey(screen.reason)),
            <>
              {screen.canRetry ? (
                <Button
                  testID="pay-status.try-again"
                  label={t('deposit.tryAgain')}
                  variant="cta"
                  busy={ticketPurchase.busy}
                  onPress={tryAgainTickets}
                />
              ) : null}
              <Button
                testID="pay-status.back"
                label={t('common.back')}
                variant={screen.canRetry ? 'ghost' : 'cta'}
                disabled={ticketPurchase.busy}
                onPress={backFromTickets}
              />
            </>,
            [screen.outOfAttempts ? t('matches.pay.failedNoAttempts') : null],
          );
        }
        return layout(
          'bad',
          t('deposit.failedTitle'),
          t(failureTextKey(screen.reason)),
          <>
            {screen.canRetry ? (
              <Button
                testID="pay-status.try-again"
                label={t('deposit.tryAgain')}
                variant="cta"
                busy={payment.busy}
                disabled={confirm.isPending}
                onPress={tryAgain}
              />
            ) : null}
            {screen.canPayAtDesk ? (
              <Button
                testID="pay-status.pay-at-desk"
                label={t('deposit.payAtDeskInstead')}
                variant={screen.canRetry ? 'secondary' : 'cta'}
                busy={confirm.isPending}
                disabled={payment.busy}
                onPress={payAtDesk}
              />
            ) : null}
            <Button
              testID="pay-status.choose-another-time"
              label={t('deposit.chooseAnotherTime')}
              variant={screen.canRetry || screen.canPayAtDesk ? 'ghost' : 'cta'}
              disabled={payment.busy || confirm.isPending}
              onPress={chooseAnotherTime}
            />
          </>,
          [
            screen.outOfAttempts
              ? t('deposit.failedNoAttempts')
              : screen.holdLive
                ? t('deposit.failedHoldLive')
                : t('deposit.failedHoldGone'),
          ],
        );

      case 'expired':
        if (isTicket) {
          const canRetry = (data?.attemptsLeft ?? 0) > 0;
          return layout(
            'neutral',
            t('deposit.expiredTitle'),
            t('matches.pay.expiredBody'),
            <>
              {canRetry ? (
                <Button
                  testID="pay-status.try-again"
                  label={t('deposit.tryAgain')}
                  variant="cta"
                  busy={ticketPurchase.busy}
                  onPress={tryAgainTickets}
                />
              ) : null}
              <Button
                testID="pay-status.back"
                label={t('common.back')}
                variant={canRetry ? 'ghost' : 'cta'}
                disabled={ticketPurchase.busy}
                onPress={backFromTickets}
              />
            </>,
          );
        }
        return layout(
          'neutral',
          t('deposit.expiredTitle'),
          t('deposit.expiredBody'),
          <Button
            testID="pay-status.book-again"
            label={t('deposit.bookAgain')}
            variant="cta"
            onPress={toGrid}
          />,
        );

      case 'slotLost':
        return layout(
          'wait',
          t('deposit.slotLostTitle'),
          t('deposit.slotLostBody', { amount: money(data?.refundAmountIqd ?? data?.amountIqd) }),
          <>
            <Button
              testID="pay-status.choose-another-time"
              label={t('deposit.chooseAnotherTime')}
              variant="cta"
              onPress={toGrid}
            />
            <Button
              testID="pay-status.call-venue"
              label={t('booking.callVenue')}
              variant="secondary"
              disabled={!phone}
              onPress={callVenue}
            />
          </>,
        );

      case 'refundPending':
        return layout(
          'wait',
          t('deposit.refundPendingTitle'),
          // A fresh purchase refunds only on amount_mismatch: it says no tickets came of it.
          isTicket && (data?.refundReason ?? 'amount_mismatch') === 'amount_mismatch'
            ? t('matches.pay.ticketRefundPending')
            : t('deposit.refundPendingBody', { amount: money(data?.refundAmountIqd ?? data?.amountIqd) }),
          <Button
            testID="pay-status.bookings"
            label={t('booking.myBookings')}
            variant="cta"
            onPress={toBookings}
          />,
        );

      case 'refunded': {
        const amount = money(data?.refundAmountIqd ?? data?.amountIqd);
        const at = data?.refundedAt ? new Date(data.refundedAt) : null;
        return layout(
          'good',
          t('deposit.refundedTitle'),
          at && Number.isFinite(at.getTime())
            ? t('deposit.refundedBody', { amount, date: formatDate(at, locale) })
            : t('deposit.refundedBodyNoDate', { amount }),
          <Button
            testID="pay-status.bookings"
            label={t('booking.myBookings')}
            variant="cta"
            onPress={toBookings}
          />,
        );
      }

      case 'refundFailed':
        return layout(
          'wait',
          t('deposit.refundFailedTitle'),
          t('deposit.refundFailedBody', { amount: money(data?.refundAmountIqd ?? data?.amountIqd) }),
          <>
            <Button
              testID="pay-status.call-venue"
              label={t('booking.callVenue')}
              variant="cta"
              disabled={!phone}
              onPress={callVenue}
            />
            <Button
              testID="pay-status.bookings"
              label={t('booking.myBookings')}
              variant="ghost"
              onPress={toBookings}
            />
          </>,
        );

      default: {
        const unreachable: never = screen;
        return unreachable;
      }
    }
  })();

  return (
    <Screen edges={[]} style={{ paddingTop: space.xs }}>
      <Stack.Screen
        options={{
          title: t('deposit.title'),
          // UIKit commits an edge-swipe before `beforeRemove` can ask, so
          // while the bank is working the swipe is off and the back item (or
          // "Leave") asks first. Every other state swipes as usual.
          gestureEnabled: screen.kind !== 'checking',
        }}
      />
      {view}
      <ConfirmAlert
        visible={leaveOpen}
        title={t('deposit.leaveTitle')}
        body={t(isTicket ? 'matches.pay.leaveBody' : 'deposit.leaveBody')}
        confirmLabel={t('deposit.leave')}
        cancelLabel={t('deposit.stay')}
        onConfirm={() => {
          setLeaveOpen(false);
          // My reservations is where a payment that settles later shows up;
          // the wallet, for tickets (it shows the purchase in progress).
          if (isTicket) toTickets();
          else toBookings();
        }}
        onDismiss={() => setLeaveOpen(false)}
      />
    </Screen>
  );
}

/** Session-gated like the rest of the booking flow (RequireSession). */
export default function GuardedPayStatusScreen() {
  return (
    <RequireSession>
      <PayStatusScreen />
    </RequireSession>
  );
}
