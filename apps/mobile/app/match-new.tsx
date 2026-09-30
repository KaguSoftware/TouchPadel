import { useMemo, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { countPhrase, formatDate, formatIQD, formatTime, isolate, isolateLtr } from '@touch/i18n';
import { needsTermsAcceptance } from '@touch/core';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { bookingGateState } from '../src/features/auth/social';
import { useBranches, useVenueSettings } from '../src/features/availability/hooks';
import { branchName } from '../src/features/availability/branch';
import { DEFAULT_TZ } from '../src/features/availability/assemble';
import { requestBookingSheet } from '../src/features/courtTransition/openIntent';
import { useOwnConsent, useOwnProfile } from '../src/features/profile/hooks';
import {
  useMatchQuote,
  useMyTickets,
  useSetMyGender,
  useStartMatch,
} from '../src/features/matches/hooks';
import {
  friendsFor,
  matchStartIntent,
  missingTickets,
  needsFriendsDeclaration,
  type Gender,
  type JoinPolicy,
  type MatchCategory,
  type Visibility,
} from '../src/features/matches/logic';
import { rpcErrorDetail } from '../src/features/booking/errors';
import {
  errorCodeOf,
  matchErrorText,
  parsePriceChanged,
  refusalKey,
  startRefusalOf,
  ticketsToBuy,
} from '../src/features/matches/errors';
import { setTicketContinuation, ticketsHref } from '../src/features/matches/continuation';
import { matchIntentKey } from '../src/lib/idempotency';
import { useBack } from '../src/navigation/back';
import { space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  FormScreen,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { GenderAsk, MatchNotice, MatchRulesCard } from '../src/components/match';

/**
 * Start an open match (docs/design/open-matches/guest.md §4.13), from a free
 * time on the Book tab. The price param is a hint only: `match_quote` decides
 * (DF-3) and is re-read on every visit.
 *
 * The form asks, top to bottom: the gender once (OM-28; the rest waits for
 * it), who can play (the quote's categories, DF-10), who can see it, how
 * players join, and the guest's seats (friends' seats use the guest's
 * tickets, OM-20; a gendered match with friends needs the declaration,
 * OM-39). A wallet short of the seats swaps Start for "Buy {tickets} and
 * start" (§4.10.3), which remembers the start and continues it after the
 * purchase with the same idempotency key.
 *
 * `match_start` refusals follow the §4.13 table (`startRefusalOf`); the key
 * survives the ones the guest fixes and retries (`useStartMatch`).
 *
 * A start ends in a court booking, so a phone nobody has verified stops it as
 * it stops a hold (owner, 2026-09-29): Start goes to /phone-sign-in in back
 * mode, as Review's "Verify phone number" does, and verify-otp pops back to
 * this form with its choices and key intact.
 */
function MatchNewScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const back = useBack();
  const toast = useToast();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    venueId?: string;
    courtId?: string;
    startAt?: string;
    durationMin?: string;
    priceIqd?: string;
  }>();
  const venueId = typeof params.venueId === 'string' && params.venueId ? params.venueId : null;
  const courtId = typeof params.courtId === 'string' && params.courtId ? params.courtId : null;
  const startAt =
    typeof params.startAt === 'string' && Number.isFinite(Date.parse(params.startAt))
      ? params.startAt
      : null;
  const durationMin = Number(params.durationMin);
  const valid =
    !!venueId && !!courtId && !!startAt && Number.isInteger(durationMin) && durationMin > 0;
  const args = useMemo(
    () => (valid ? { venueId: venueId!, courtId: courtId!, startAt: startAt!, durationMin } : null),
    [valid, venueId, courtId, startAt, durationMin],
  );

  const quote = useMatchQuote(args);
  const wallet = useMyTickets();
  const settings = useVenueSettings(venueId);
  const branches = useBranches();
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  const consent = useOwnConsent(uid);
  // Unread consent sends TERMS_REQUIRED to /accept-terms, which reads it itself.
  const needsTerms = consent.data === undefined || needsTermsAcceptance(consent.data);
  const profile = useOwnProfile(!!session);
  const unverified = bookingGateState(profile, session?.user) === 'unverified';
  const start = useStartMatch();
  const setGender = useSetMyGender();

  const knobs = settings.data ?? null;
  const tz = knobs?.timezone ?? DEFAULT_TZ;
  const phone = knobs?.phone ?? null;
  const q = quote.data ?? null;

  const [picked, setCategory] = useState<MatchCategory>('open');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [policy, setPolicy] = useState<JoinPolicy>('open');
  const [seatsPicked, setSeats] = useState(1);
  // The friends' declaration answers one category and seat count (OM-39):
  // changing either asks it again.
  const [declaredFor, setDeclaredFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [genderBusy, setGenderBusy] = useState<Gender | null>(null);
  const [genderError, setGenderError] = useState<string | null>(null);

  // The categories the server offers (DF-10); a pick it no longer offers falls back.
  const categories: readonly MatchCategory[] = q?.categories ?? ['open'];
  const category = categories.includes(picked) ? picked : (categories[0] ?? 'open');
  const seatsMax = q?.seatsMax ?? 3;
  const seats = Math.min(seatsPicked, seatsMax);
  const declarationKey = `${category}|${seats}`;
  const friendsDeclared = declaredFor === declarationKey;

  const genderUnset = !!q && q.myGender === null;
  const refusal = q?.refusal && q.refusal !== 'GENDER_REQUIRED' ? q.refusal : null;
  const off = !!q && !q.enabled && !refusal;
  const available = wallet.data?.available ?? q?.ticketsAvailable ?? 0;
  const missing = wallet.data || q ? missingTickets(available, seats) : 0;
  const needsDeclaration = needsFriendsDeclaration(category, seats);
  const friends = friendsFor(category, seats);
  const money = (n: number) => isolate(formatIQD(n, locale));
  const errorCtx = { locale, timezone: tz, phone };

  const branchLabel = (() => {
    const open = branches.data ?? [];
    if (open.length < 2) return null;
    const b = open.find((x) => x.venue_id === venueId);
    return b ? branchName(b, locale) : null;
  })();

  const vars = () => ({
    venueId: venueId!,
    courtId: courtId!,
    startAt: startAt!,
    durationMin,
    category,
    visibility,
    joinPolicy: policy,
    friends,
    quotedPriceIqd: q?.priceIqd ?? 0,
  });

  /** §4.10.3: remember the start (with its key), then buy what is missing. */
  const buyThenStart = (count: number) => {
    const v = vars();
    setTicketContinuation({
      kind: 'start',
      savedAt: new Date().toISOString(),
      ...v,
      idempotencyKey: matchIntentKey(matchStartIntent(v)),
    });
    router.push(ticketsHref(count, 'start'));
  };

  const onStartError = (err: Error) => {
    const code = errorCodeOf(err);
    switch (startRefusalOf(code)) {
      case 'tickets':
        buyThenStart(ticketsToBuy(err, { seats, available }));
        return;
      case 'gender':
        setError(t('matches.errors.genderRequired'));
        void quote.refetch();
        return;
      case 'phone':
        router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
        return;
      case 'terms':
        if (needsTerms) router.push('/accept-terms');
        else setError(t('matches.errors.updateApp'));
        return;
      case 'priceChanged': {
        const current = parsePriceChanged(rpcErrorDetail(err))?.currentIqd ?? null;
        void quote.refetch().then((r) => {
          const price = current ?? r.data?.priceIqd ?? null;
          if (price !== null)
            setPriceNote(t('matches.create.priceChanged', { price: money(price) }));
        });
        return;
      }
      case 'tooLate':
      case 'backToSheet':
        toast(matchErrorText(err, t, errorCtx), 'error');
        requestBookingSheet();
        router.navigate('/(tabs)');
        return;
      default:
        setError(matchErrorText(err, t, errorCtx));
    }
  };

  const onStart = () => {
    if (!args || !q || q.priceIqd === null) return;
    setError(null);
    // Before any purchase too: the ticket continuation replays the start.
    if (unverified) {
      router.push({
        pathname: '/phone-sign-in',
        params: { returnTo: 'back', phone: profile.data?.phone ?? '' },
      });
      return;
    }
    if (missing > 0) {
      buyThenStart(missing);
      return;
    }
    setPriceNote(null);
    start.mutate(vars(), {
      onSuccess: (result) => {
        toast(t('matches.create.started'));
        router.replace({ pathname: '/match/[id]', params: { id: result.matchId } });
      },
      onError: onStartError,
    });
  };

  const onGender = (gender: Gender) => {
    setGenderError(null);
    setGenderBusy(gender);
    setGender.mutate(gender, {
      onError: (err) => {
        if (errorCodeOf(err) === 'GENDER_ALREADY_SET')
          toast(t('matches.errors.genderAlreadySet'), 'info');
        else setGenderError(matchErrorText(err, t, errorCtx));
      },
      onSettled: () => setGenderBusy(null),
    });
  };

  const refusalText = (code: string) =>
    code === 'TERMS_REQUIRED' && !needsTerms ? t('matches.errors.updateApp') : t(refusalKey(code));

  const label = (text: string) => (
    <MicroLabel style={{ marginTop: space.l, marginBottom: 6 }}>{text}</MicroLabel>
  );
  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };

  const content = (() => {
    if (!valid) {
      return (
        <ErrorState
          testID="match-new.not-found"
          title={t('errors.loadFailedTitle')}
          message={t('matches.errors.notFound')}
          retryLabel={t('common.back')}
          onRetry={back}
        />
      );
    }
    if (!q) {
      if (quote.isError) {
        return (
          <ErrorState
            testID="match-new.error"
            title={t('errors.loadFailedTitle')}
            message={matchErrorText(quote.error, t, errorCtx)}
            retryLabel={t('common.retry')}
            onRetry={() => void quote.refetch()}
            busy={quote.isRefetching}
          />
        );
      }
      return <SkeletonList rows={3} height={110} />;
    }
    const startsAt = new Date(startAt!);
    const locked = genderUnset || start.isPending;
    const share = q.sharesIqd?.[0] ?? null;
    return (
      <FormScreen>
        <Card>
          <Text style={{ fontFamily: fonts.display900, fontSize: 22, color: colors.ink }}>
            {formatTime(startsAt, locale, tz)}
          </Text>
          <Text
            style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.mut2, marginTop: 2 }}
          >
            {[
              formatDate(startsAt, locale, tz),
              t('booking.durationMinutes', { minutes: q.durationMin || durationMin }),
              branchLabel,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {q.fillDeadlineAt ? (
            <Text style={{ ...body, marginTop: 6 }}>
              {t('matches.create.fillsBy', {
                time: formatTime(new Date(q.fillDeadlineAt), locale, tz),
              })}
            </Text>
          ) : null}
        </Card>

        {refusal ? (
          <View testID="match-new.refusal" style={{ marginTop: space.m }}>
            <MatchNotice text={refusalText(refusal)} />
            {refusal === 'PHONE_REQUIRED' ? (
              <Button
                testID="match-new.add-phone"
                label={t('auth.addPhoneLink')}
                variant="secondary"
                size="compact"
                onPress={() =>
                  router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } })
                }
                style={{ marginTop: space.sm }}
              />
            ) : null}
          </View>
        ) : off ? (
          <View testID="match-new.refusal" style={{ marginTop: space.m }}>
            <MatchNotice text={t('matches.errors.off')} />
          </View>
        ) : null}

        {genderUnset ? (
          <View style={{ marginTop: space.m }}>
            <GenderAsk
              testID="match-new.gender"
              busy={genderBusy}
              error={genderError}
              onPick={onGender}
            />
          </View>
        ) : null}

        {/* Everything below waits for the gender answer (OM-28). */}
        <View pointerEvents={locked ? 'none' : 'auto'} style={{ opacity: genderUnset ? 0.45 : 1 }}>
          {label(t('matches.create.whoCanPlay'))}
          <SegmentedControl<MatchCategory>
            testID="match-new.category"
            options={categories.map((c) => ({
              value: c,
              label: t(
                c === 'women'
                  ? 'matches.common.categoryWomen'
                  : c === 'men'
                    ? 'matches.common.categoryMen'
                    : 'matches.common.categoryOpen',
              ),
            }))}
            value={category}
            onChange={setCategory}
          />

          {label(t('matches.create.whoCanSee'))}
          <SegmentedControl<Visibility>
            testID="match-new.visibility"
            options={[
              { value: 'public', label: t('matches.create.visibilityPublic') },
              { value: 'link', label: t('matches.create.visibilityLink') },
            ]}
            value={visibility}
            onChange={setVisibility}
          />
          <Text style={{ ...body, marginTop: 6 }}>
            {t(
              visibility === 'public'
                ? 'matches.create.visibilityPublicHint'
                : 'matches.create.visibilityLinkHint',
            )}
          </Text>

          {label(t('matches.create.joining'))}
          <SegmentedControl<JoinPolicy>
            testID="match-new.policy"
            options={[
              { value: 'open', label: t('matches.create.policyOpen') },
              { value: 'approve', label: t('matches.create.policyApprove') },
            ]}
            value={policy}
            onChange={setPolicy}
          />

          {label(t('matches.create.seatsForYou'))}
          <SegmentedControl<number>
            testID="match-new.seats"
            options={Array.from({ length: seatsMax }, (_, i) => ({
              value: i + 1,
              label:
                i === 0
                  ? t('matches.create.seatsMe')
                  : t('matches.create.seatsMePlus', { extra: isolateLtr(`+${i}`) }),
            }))}
            value={seats}
            onChange={setSeats}
          />
          <Text style={{ ...body, marginTop: 6 }}>{t('matches.create.seatsNote')}</Text>

          {needsDeclaration ? (
            <Pressable
              testID="match-new.friends-gender-row"
              accessibilityRole="switch"
              accessibilityState={{ checked: friendsDeclared, disabled: locked }}
              disabled={locked}
              onPress={() => setDeclaredFor(friendsDeclared ? null : declarationKey)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                marginTop: space.m,
              }}
            >
              <Switch
                testID="match-new.friends-gender"
                value={friendsDeclared}
                disabled={locked}
                onValueChange={(on) => setDeclaredFor(on ? declarationKey : null)}
                trackColor={{ true: colors.blue, false: colors.line }}
                accessibilityLabel={t(
                  category === 'women'
                    ? 'matches.create.friendsWomen'
                    : 'matches.create.friendsMen',
                )}
              />
              <Text
                style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink }}
              >
                {t(
                  category === 'women'
                    ? 'matches.create.friendsWomen'
                    : 'matches.create.friendsMen',
                )}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Card style={{ marginTop: space.l }}>
          {q.priceIqd !== null && share !== null ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
              {t('matches.create.money', { price: money(q.priceIqd), share: money(share) })}
            </Text>
          ) : null}
          <Text style={{ ...body, marginTop: 4 }}>
            {t('matches.create.wallet', {
              use: countPhrase('matches.count.ticketsUse', seats, locale),
              ready: countPhrase('matches.count.ticketsReady', available, locale),
            })}
          </Text>
        </Card>

        <View style={{ marginTop: space.m }}>
          <MatchRulesCard testID="match-new.rules" />
        </View>

        {priceNote ? (
          <View style={{ marginTop: space.m }}>
            <MatchNotice text={priceNote} />
          </View>
        ) : null}
        <ErrorText>{error}</ErrorText>

        {refusal || off ? null : (
          <>
            {needsDeclaration && !friendsDeclared ? (
              <Text style={{ ...body, marginTop: space.m }}>
                {t('matches.create.friendsNeeded')}
              </Text>
            ) : null}
            <Button
              testID="match-new.start"
              label={
                missing > 0
                  ? t('matches.create.buyAndStart', {
                      tickets: countPhrase('matches.count.ticketsGen', missing, locale),
                    })
                  : t('matches.create.start')
              }
              variant="cta"
              busy={start.isPending}
              disabled={
                genderUnset || q.priceIqd === null || (needsDeclaration && !friendsDeclared)
              }
              onPress={onStart}
              style={{ marginTop: space.m }}
            />
          </>
        )}
      </FormScreen>
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('matches.create.title') }} />
      {content}
    </Screen>
  );
}

export default function GuardedMatchNewScreen() {
  return (
    <RequireSession>
      <MatchNewScreen />
    </RequireSession>
  );
}
