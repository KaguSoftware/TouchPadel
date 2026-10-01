import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { needsTermsAcceptance } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatIQD,
  formatTime,
  formatWeekdayShort,
  isolate,
  isolateLtr,
  type MessageKey,
} from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { useOwnConsent } from '../src/features/profile/hooks';
import { useVenueSettings } from '../src/features/availability/hooks';
import { DEFAULT_TZ, venuePhoneOf } from '../src/features/availability/assemble';
import { mapErrorToKey } from '../src/features/booking/errors';
import { ticketBeginRefusalOf } from '../src/features/deposit/logic';
import { useMyTickets } from '../src/features/matches/hooks';
import { useStartTicketPurchase } from '../src/features/matches/tickets';
import { clearTicketContinuation, type ContinuationKind } from '../src/features/matches/continuation';
import { buyCounts, type WalletTicket } from '../src/features/matches/logic';
import { matchErrorText } from '../src/features/matches/errors';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { ChevronIcon } from '../src/components/icons';
import { ErrorState, SkeletonList } from '../src/components/states';

/** "How tickets work" (guest.md §4.10.1), in order. */
const RULES: readonly MessageKey[] = [
  'matches.tickets.rule1',
  'matches.tickets.rule2',
  'matches.tickets.rule3',
  'matches.tickets.rule4',
  'matches.tickets.rule5',
  'matches.tickets.rule6',
  'matches.tickets.rule7',
];

const NEED_LINE: Record<ContinuationKind, MessageKey> = {
  join: 'matches.tickets.needJoin',
  request: 'matches.tickets.needRequest',
  start: 'matches.tickets.needStart',
};

const isKind = (v: unknown): v is ContinuationKind => v === 'join' || v === 'request' || v === 'start';

/**
 * The ticket wallet (docs/design/open-matches/guest.md §4.10.1): how many
 * tickets are ready, a purchase still in progress, the buy card, how tickets
 * work, and every ticket still held plus the recent history.
 *
 * Reached from Profile, from My Reservations' wallet line, and from any
 * shortage (`NEED_TICKETS`, or a "Buy and join" pre-check): those arrive as
 * `/tickets?buy=<missing>&for=<join|request|start>`, having recorded what the
 * guest was doing (`setTicketContinuation`). Buying writes that into the
 * payment pointer, and the payment screen continues into the same action once
 * the tickets land (§4.10.3). Backing out of this screen without buying drops
 * it: the guest chose not to go on.
 *
 * Nothing here decides a count the server has not: the stepper offers what the
 * wallet cap leaves room for (`buyCounts`), and `ticket-begin` stays the
 * authority (a `reused` answer opens the attempt already running, with its own
 * count).
 */
function TicketsScreen() {
  const { t, locale, dir } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ buy?: string; for?: string }>();
  const { session } = useAuth();
  const consent = useOwnConsent(session && !session.user.is_anonymous ? session.user.id : null);
  const wallet = useMyTickets();
  const pull = usePullRefresh(wallet.refetch);
  const settings = useVenueSettings();
  const phone = venuePhoneOf(settings.data);
  const tz = settings.data?.timezone ?? DEFAULT_TZ;
  const purchase = useStartTicketPurchase();
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const wanted = Number.parseInt(typeof params.buy === 'string' ? params.buy : '', 10);
  const need = Number.isInteger(wanted) && wanted >= 1 && wanted <= 3 ? wanted : null;
  const context = isKind(params.for) ? params.for : null;

  const counts = useMemo(() => (wallet.data ? buyCounts(wallet.data) : []), [wallet.data]);
  const [picked, setPicked] = useState<number | null>(null);
  // The shortage preselects its count; the cap may leave less room than that.
  const count =
    picked !== null && counts.includes(picked)
      ? picked
      : counts.length === 0
        ? 0
        : Math.min(need ?? 1, counts[counts.length - 1] ?? 1);

  // Leaving without buying ends the continuation (§4.10.3 step 1). A purchase
  // that started hands it to the pointer first, so it is kept.
  const started = useRef(false);
  useEffect(
    () => () => {
      if (!started.current) clearTicketContinuation();
    },
    [],
  );

  const money = (n: number) => isolate(formatIQD(n, locale));

  const onBuy = () => {
    if (count < 1) return;
    setError(null);
    purchase.start(count, {
      onStarted: () => {
        started.current = true;
      },
      onError: (err) => {
        switch (ticketBeginRefusalOf(err)) {
          case 'phone':
            router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
            return;
          case 'terms':
            // A build whose terms are all accepted cannot accept newer ones;
            // unread consent goes to /accept-terms, which reads it itself.
            if (consent.data === undefined || needsTermsAcceptance(consent.data)) {
              router.push('/accept-terms');
            } else {
              setError(t('matches.errors.updateApp'));
            }
            return;
          case 'walletLimit':
            // The cap moved under the stepper: re-read it, so the card matches.
            void wallet.refetch();
            setError(t('matches.errors.walletLimit'));
            return;
          case 'tooManyAttempts':
            setError(t('matches.tickets.tooManyAttempts'));
            return;
          case 'inline':
            setError(matchErrorText(err, t, { locale, phone }));
            return;
        }
      },
    });
  };

  const openMatch = (ticket: WalletTicket) => {
    if (!ticket.match) return;
    router.push({ pathname: '/match/[id]', params: { id: ticket.match.matchId } });
  };

  const whenOf = (iso: string | null) => {
    if (!iso) return '';
    const at = new Date(iso);
    return `${formatWeekdayShort(at, locale, tz)} ${formatTime(at, locale, tz)}`;
  };
  const dayOf = (iso: string | null) => (iso ? formatDate(new Date(iso), locale, tz) : '');

  const body = (() => {
    if (wallet.isPending) return <SkeletonList rows={3} height={84} />;
    if (wallet.isError || !wallet.data) {
      return (
        <ErrorState
          testID="tickets.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(wallet.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void wallet.refetch()}
          busy={wallet.isRefetching}
        />
      );
    }
    const w = wallet.data;
    const live = w.tickets.filter((k) => k.status === 'reserved' || k.status === 'in_use');
    const ended = w.tickets.filter((k) => k.status === 'forfeited' || k.status === 'cashed_out');
    const lineStyle = { fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.mut } as const;
    return (
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.blue} />
        }
      >
        {/* 1. The wallet: not pressable, the count is the whole point. */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text
              testID="tickets.ready"
              style={{
                flexShrink: 1,
                fontFamily: fonts.display900,
                fontSize: 22,
                textTransform: 'uppercase',
                color: colors.ink,
              }}
            >
              {countPhrase('matches.count.ticketsReady', w.available, locale)}
            </Text>
            <View style={{ flex: 1 }} />
            {w.sandbox ? (
              // The App Review account buys in Qi's sandbox: never real tickets.
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
                  {t('matches.tickets.sandbox')}
                </Text>
              </View>
            ) : null}
          </View>
          {w.reserved > 0 ? (
            <Text style={[lineStyle, { marginTop: 6 }]}>
              {countPhrase('matches.count.ticketsHeld', w.reserved, locale)}
            </Text>
          ) : null}
          {w.inUse > 0 ? (
            <Text style={[lineStyle, { marginTop: w.reserved > 0 ? 2 : 6 }]}>
              {countPhrase('matches.count.ticketsInMatch', w.inUse, locale)}
            </Text>
          ) : null}
        </Card>

        {/* 2. A purchase still open (rules review §4.1 item 9): finish it rather than start another. */}
        {w.pending ? (
          <Pressable
            testID="tickets.pending"
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/pay/status', params: { ref: w.pending?.requestId ?? '' } })
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              backgroundColor: pressed ? colors.sub : colors.amb,
              borderWidth: 1,
              borderColor: colors.ambline,
              borderRadius: radius.cell,
              paddingStart: space.sm,
              paddingEnd: space.sm,
              paddingTop: 12,
              paddingBottom: 12,
            })}
          >
            <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13, color: colors.ambtext }}>
              {`${t('matches.tickets.pending')} · ${t('matches.tickets.pendingContinue')}`}
            </Text>
            <ChevronIcon size={15} color={colors.ambtext} />
          </Pressable>
        ) : null}

        {/* 3 + 4. Why the guest is here, and the purchase. */}
        {counts.length === 0 ? (
          <Card>
            <Text style={lineStyle}>{t('matches.errors.walletLimit')}</Text>
          </Card>
        ) : (
          <Card>
            <MicroLabel>{t('matches.tickets.buyTitle')}</MicroLabel>
            {need !== null && context !== null ? (
              <Text
                style={{ marginTop: 8, fontFamily: fonts.body700, fontSize: 13.5, lineHeight: 20, color: colors.ink }}
              >
                {t(NEED_LINE[context], { tickets: countPhrase('matches.count.tickets', need, locale) })}
              </Text>
            ) : null}
            <View style={{ marginTop: space.sm }}>
              <SegmentedControl<number>
                testID="tickets.count"
                options={counts.map((n) => ({ value: n, label: String(n) }))}
                value={count}
                onChange={setPicked}
              />
            </View>
            {w.priceIqd !== null ? (
              <Text
                style={{
                  marginTop: space.sm,
                  fontFamily: fonts.body700,
                  fontSize: 14,
                  color: colors.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {t('matches.tickets.priceLine', {
                  count: isolateLtr(String(count)),
                  price: money(w.priceIqd),
                  total: money(w.priceIqd * count),
                })}
              </Text>
            ) : null}
            <ErrorText>{error}</ErrorText>
            <Button
              testID="tickets.buy"
              label={t('matches.tickets.buy')}
              variant="cta"
              busy={purchase.busy}
              disabled={count < 1}
              onPress={onBuy}
              style={{ marginTop: space.sm }}
            />
            <Hint>{t('matches.tickets.buyNote')}</Hint>
          </Card>
        )}

        {/* 5. How tickets work: folded, it is read once. */}
        <Card style={{ paddingTop: 0, paddingBottom: 0 }}>
          <Pressable
            testID="tickets.rules"
            accessibilityRole="button"
            accessibilityState={{ expanded: rulesOpen }}
            onPress={() => setRulesOpen((open) => !open)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 14 }}
          >
            <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
              {t('matches.tickets.rulesTitle')}
            </Text>
            {/* The chevron is mirrored in Arabic, so "open" turns it the other way to point down. */}
            <View style={{ transform: [{ rotate: rulesOpen ? (dir === 'rtl' ? '-90deg' : '90deg') : '0deg' }] }}>
              <ChevronIcon size={15} color={colors.fnt2} />
            </View>
          </Pressable>
          {rulesOpen ? (
            <View style={{ paddingBottom: 14, gap: 8 }}>
              {RULES.map((key, i) => (
                <View key={key} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={[lineStyle, { color: colors.fnt, fontVariant: ['tabular-nums'] }]}>
                    {isolateLtr(`${i + 1}.`)}
                  </Text>
                  <Text style={[lineStyle, { flex: 1, fontFamily: fonts.body400 }]}>{t(key)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        {/* 6. Every ticket still held, then the recent history. Ready tickets are the count, not rows. */}
        {live.length + ended.length > 0 ? (
          <View style={{ gap: 7, marginTop: 4 }}>
            <MicroLabel>{t('matches.tickets.historyTitle')}</MicroLabel>
            {live.map((k) => (
              <Pressable
                key={k.id}
                testID={`tickets.row.${k.id}`}
                accessibilityRole="button"
                disabled={!k.match}
                onPress={() => openMatch(k)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  backgroundColor: pressed ? colors.sub : colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.cell,
                  paddingStart: space.sm,
                  paddingEnd: space.sm,
                  paddingTop: 12,
                  paddingBottom: 12,
                })}
              >
                <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
                  {t(k.status === 'reserved' ? 'matches.tickets.rowHeld' : 'matches.tickets.rowInMatch', {
                    when: whenOf(k.match?.startAt ?? null),
                  })}
                </Text>
                {k.match ? <ChevronIcon size={15} color={colors.fnt2} /> : null}
              </Pressable>
            ))}
            {ended.map((k) => (
              <View
                key={k.id}
                testID={`tickets.row.${k.id}`}
                style={{
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.cell,
                  paddingStart: space.sm,
                  paddingEnd: space.sm,
                  paddingTop: 12,
                  paddingBottom: 12,
                }}
              >
                <Text style={lineStyle}>
                  {k.status === 'forfeited'
                    ? t('matches.tickets.rowLost', { date: dayOf(k.forfeitedAt) })
                    : t('matches.tickets.rowRefunded', { date: dayOf(k.cashedOutAt) })}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* 7. Money back (OM-48, R13): at the desk, never here. */}
        <Hint style={{ marginTop: space.xs }}>{t('matches.tickets.cashOut')}</Hint>
      </ScrollView>
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('matches.tickets.title') }} />
      {body}
    </Screen>
  );
}

/** Signed-in only: a wallet belongs to an account (RequireSession). */
export default function GuardedTicketsScreen() {
  return (
    <RequireSession>
      <TicketsScreen />
    </RequireSession>
  );
}
