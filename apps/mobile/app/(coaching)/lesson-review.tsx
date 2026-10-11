import { useContext, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { needsTermsAcceptance } from '@touch/core';
import {
  countPhrase,
  formatDayNumber,
  formatIQD,
  formatMonthShort,
  formatTime,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { RequireSession } from '../../src/features/auth/RequireSession';
import { useAuth } from '../../src/features/auth/context';
import { bookingGateState } from '../../src/features/auth/social';
import { useOwnConsent, useOwnProfile } from '../../src/features/profile/hooks';
import { useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { rpcErrorDetail } from '../../src/features/booking/errors';
import { coachingKeys, useBookPrivate, useCoachProfile } from '../../src/features/coaching/hooks';
import { useStartLessonPayment } from '../../src/features/coaching/payment';
import {
  bookRefusalOf,
  lessonErrorCode,
  lessonErrorText,
} from '../../src/features/coaching/errors';
import { parsePriceChanged } from '../../src/features/matches/errors';
import {
  displayCoachName,
  effectiveChoice,
  friendNamesFor,
  paymentChoices,
  pick,
  type LessonWrite,
  type PaymentChoice,
} from '../../src/features/coaching/logic';
import { useBack } from '../../src/navigation/back';
import { brand, radius, shadows, space, useTheme } from '../../src/theme';
import { Button, ErrorText, Field, FormScreen, Hint, Screen } from '../../src/components/ui';
import { DegradedBanner } from '../../src/components/booking';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice } from '../../src/components/match';
import { CoachAvatar } from '../../src/components/coaching';
import { useToast } from '../../src/components/overlays';

/** How far the light sheet rides up over the blue header. */
const SHEET_OVERLAP = 28;
/** The header's air under its chips, above the sheet's overlap. */
const HERO_FOOT = 24;
/** Room the floating book bar takes over the sheet's foot. */
const BOOK_BAR_SPACE = 92;

/**
 * The private lesson's review (docs/design/coaching/guest.md §4.8.6, §4.9.1):
 * the coach, the lesson, the time, the party (1..the type's largest), the
 * friends' names, the payment choice and Book.
 *
 * Layout is the "Pick a time" page's (lesson-times): the brand-blue header
 * (the coach's avatar and name, the lesson, its chips) under a transparent
 * native bar, a light sheet over it with the picked time, the people (count
 * and friends' names in one card) and the payment switch, and the floating
 * navy book bar.
 *
 * The profile read decides the price (the `priceIqd` param is a hint); the
 * phone sends it as `p_expected_price_iqd` and the server answers
 * PRICE_CHANGED when it moved. The booking gate stands first (a private
 * lesson takes a court): no phone → /complete-profile, a phone nobody
 * verified → /phone-sign-in, both in back mode. The key is the intent's
 * (`lessonIntentKey(privateIntent(…))`), kept across the refusals the guest
 * fixes. Desk: booked, the lesson opens. Qi: held, the payment opens.
 */
function LessonReviewScreen() {
  const { t, locale, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The native bar as the navigator measured it, for the header's top.
  const headerHeight = useContext(HeaderHeightContext);
  const toast = useToast();
  const queryClient = useQueryClient();
  // Back to the coach's grid; a review opened with no history lands on the coaches.
  const back = useBack('/coaches');
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    coachId?: string;
    lessonTypeId?: string;
    venueId?: string;
    startAt?: string;
  }>();
  const coachId = typeof params.coachId === 'string' && params.coachId ? params.coachId : null;
  const lessonTypeId = typeof params.lessonTypeId === 'string' ? params.lessonTypeId : '';
  const venueId = typeof params.venueId === 'string' && params.venueId ? params.venueId : null;
  const startAt =
    typeof params.startAt === 'string' && Number.isFinite(Date.parse(params.startAt))
      ? params.startAt
      : null;

  const coachRead = useCoachProfile(coachId, venueId);
  const settings = useVenueSettings(venueId);
  const degraded = useIsDegraded(venueId);
  const profile = useOwnProfile(!!session);
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  const consent = useOwnConsent(uid);
  // Unread consent sends TERMS_REQUIRED to /accept-terms, which reads it itself.
  const needsTerms = consent.data === undefined || needsTermsAcceptance(consent.data);
  const book = useBookPrivate();
  const payment = useStartLessonPayment();

  const [party, setParty] = useState(1);
  const [friends, setFriends] = useState<string[]>(['', '', '']);
  const [picked, setPicked] = useState<PaymentChoice>('desk');
  const [error, setError] = useState<string | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState<string | null>(null);

  const data = coachRead.data ?? null;
  const offer =
    data?.offers.find((o) => o.lessonTypeId === lessonTypeId && o.kind === 'private') ?? null;
  const venue = data?.venue ?? null;
  const tz = venue?.timezone ?? settings.data?.timezone ?? 'Asia/Baghdad';
  const phone = venue?.phone ?? venuePhoneOf(settings.data);
  const mode = effectiveChoice(venue?.paymentMode ?? 'desk', picked);
  const maxParty = offer?.maxPlaces ?? 1;
  const partySize = Math.min(party, maxParty);
  const money = (n: number | null | undefined) =>
    typeof n === 'number' ? isolate(formatIQD(n, locale)) : '';
  const errorCtx = { locale, phone, termsCurrent: !needsTerms };
  const busy = book.isPending || payment.busy;

  // The root layout makes this route's bar transparent from the first frame
  // (the blue header runs under it); the states without it take a plain bar.
  const header = (
    <Stack.Screen
      options={{
        title: t('coaching.guest.review.title'),
        headerTransparent: false,
        headerStyle: { backgroundColor: colors.bg },
      }}
    />
  );

  if (!coachId || !venueId || !startAt || !lessonTypeId) {
    return (
      <Screen edges={[]}>
        {header}
        <View style={{ paddingTop: space.m }}>
          <MatchNotice text={t('coaching.common.errors.typeNotFound')} />
        </View>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen edges={[]}>
        {header}
        {coachRead.isError ? (
          <ErrorState
            testID="lesson-review.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(coachRead.error, t, { locale, phone })}
            retryLabel={t('common.retry')}
            onRetry={() => void coachRead.refetch()}
            busy={coachRead.isRefetching}
          />
        ) : (
          <SkeletonList rows={3} height={96} />
        )}
      </Screen>
    );
  }

  const opened = (result: LessonWrite) => {
    if (result.status === 'held') {
      payment.start(result.enrolmentId, {
        onError: (err) => {
          toast(lessonErrorText(err, t, errorCtx), 'error');
          router.replace({ pathname: '/lesson/[id]', params: { id: result.enrolmentId } });
        },
      });
      return;
    }
    toast(t('coaching.guest.review.booked'), 'success');
    router.replace({ pathname: '/lesson/[id]', params: { id: result.enrolmentId } });
  };

  const onError = (err: Error) => {
    const code = lessonErrorCode(err);
    const detail = rpcErrorDetail(err);
    switch (bookRefusalOf(code, detail)) {
      case 'phone':
        router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
        return;
      case 'terms':
        if (needsTerms) router.push('/accept-terms');
        else setError(t('coaching.common.errors.updateApp'));
        return;
      case 'priceChanged': {
        const current = parsePriceChanged(detail)?.currentIqd ?? null;
        void coachRead.refetch();
        setPriceNote(
          current !== null
            ? t('coaching.common.errors.priceChangedTo', { price: money(current) })
            : lessonErrorText(err, t, errorCtx),
        );
        return;
      }
      case 'backToGrid':
        toast(lessonErrorText(err, t, errorCtx), 'error');
        void queryClient.invalidateQueries({ queryKey: coachingKeys.slotsAll });
        back();
        return;
      case 'party': {
        const max = detail && /^\d+$/.test(detail) ? Number(detail) : null;
        if (max !== null) setParty(Math.max(1, max));
        setPartyError(lessonErrorText(err, t, errorCtx));
        return;
      }
      case 'mode':
        void coachRead.refetch();
        void settings.refetch();
        setError(lessonErrorText(err, t, errorCtx));
        return;
      case 'banner':
        setBanner(lessonErrorText(err, t, errorCtx));
        return;
      default:
        setError(lessonErrorText(err, t, errorCtx));
    }
  };

  const onBook = () => {
    if (!offer || offer.priceIqd === null || !session) return;
    setError(null);
    setPartyError(null);
    setPriceNote(null);
    const gate = bookingGateState(profile, session.user);
    if (gate === 'incomplete') {
      router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
      return;
    }
    if (gate === 'unverified') {
      router.push({
        pathname: '/phone-sign-in',
        params: { returnTo: 'back', phone: profile.data?.phone ?? '' },
      });
      return;
    }
    book.mutate(
      {
        coachId,
        lessonTypeId,
        startAt,
        partySize,
        friendNames: friendNamesFor(friends, partySize),
        mode,
        expectedPriceIqd: offer.priceIqd,
      },
      { onSuccess: opened, onError },
    );
  };

  const partyLabel =
    partySize <= 1
      ? t('coaching.guest.review.justMe')
      : t('coaching.guest.review.mePlus', { count: isolateLtr(String(partySize - 1)) });
  const hours = venue?.cancellationWindowHours ?? settings.data?.cancellation_window_hours ?? 0;
  const name = displayCoachName(data.coach, locale);
  const start = new Date(startAt);
  const end = offer ? new Date(start.getTime() + offer.durationMin * 60_000) : null;
  const startLabel = formatTime(start, locale, tz);
  const dayLabel = `${formatWeekdayShort(start, locale, tz)} ${formatDayNumber(start, locale, tz)} ${formatMonthShort(start, locale, tz)}`;
  const branchLabel = venue ? pick(venue.nameEn, venue.nameAr, locale) : '';
  const friendCount = partySize - 1;
  // Two names to a row; an odd last one keeps its half.
  const friendRows = Array.from({ length: Math.ceil(friendCount / 2) }, (_, r) =>
    [r * 2, r * 2 + 1].filter((i) => i < friendCount),
  );

  // The "Pick a time" page's header: the coach, the lesson, and chips for its facts.
  const chip = (label: string, strong = false) => (
    <View
      style={{
        backgroundColor: strong ? brand.green : 'rgba(255,255,255,0.16)',
        borderRadius: radius.pill,
        paddingTop: 4,
        paddingBottom: 4,
        paddingStart: 9,
        paddingEnd: 9,
      }}
    >
      <Text
        style={{
          fontFamily: strong ? fonts.display800 : fonts.body700,
          fontSize: 12,
          color: strong ? brand.greenInk : brand.white,
        }}
      >
        {label}
      </Text>
    </View>
  );
  const hero = (
    <View
      testID="lesson-review.hero"
      style={{
        backgroundColor: brand.blue,
        paddingTop: (headerHeight ?? insets.top + 52) + space.s,
        paddingBottom: HERO_FOOT + SHEET_OVERLAP,
        paddingStart: space.xl,
        paddingEnd: space.xl,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.l,
      }}
    >
      <View style={{ borderRadius: 40, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)' }}>
        <CoachAvatar photoPath={data.coach?.photoPath ?? null} name={name} size={64} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body700, fontSize: 13, color: brand.navyText }}
        >
          {name}
        </Text>
        <Text style={{ fontFamily: fonts.display800, fontSize: 24, color: brand.white }}>
          {offer ? pick(offer.nameEn, offer.nameAr, locale) : t('coaching.common.lesson')}
        </Text>
        {offer ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {chip(t('coaching.common.durationMin', { minutes: offer.durationMin }))}
            {chip(
              t('coaching.common.upTo', {
                people: countPhrase('coaching.common.count.people', offer.maxPlaces, locale),
              }),
            )}
            {offer.priceIqd != null ? chip(money(offer.priceIqd), true) : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  // The picked time: a date tile, the start and end, the branch, and Change
  // (back to the times).
  const tileText = {
    fontFamily: fonts.body600,
    fontSize: 10.5,
    lineHeight: 13,
    color: brand.navyText,
    textTransform: 'uppercase',
  } as const;
  const timeCard = (
    <View
      testID="lesson-review.time"
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.sheet,
        padding: space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
      }}
    >
      <View
        style={{
          width: 56,
          height: 64,
          borderRadius: radius.cell,
          backgroundColor: brand.blue,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text numberOfLines={1} style={tileText}>
          {formatWeekdayShort(start, locale, tz)}
        </Text>
        <Text
          style={{ fontFamily: fonts.display800, fontSize: 20, lineHeight: 24, color: brand.white }}
        >
          {formatDayNumber(start, locale, tz)}
        </Text>
        <Text numberOfLines={1} style={tileText}>
          {formatMonthShort(start, locale, tz)}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>
          {end ? `${startLabel} – ${formatTime(end, locale, tz)}` : startLabel}
        </Text>
        {branchLabel ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}
          >
            {branchLabel}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID="lesson-review.change"
        accessibilityRole="button"
        onPress={back}
        hitSlop={8}
        style={({ pressed }) => ({
          minHeight: 44,
          justifyContent: 'center',
          paddingStart: space.xs,
          paddingEnd: space.xs,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.blue }}>
          {t('coaching.guest.review.change')}
        </Text>
      </Pressable>
    </View>
  );

  // People: the count and its stepper on one row, the friends' names under it,
  // in one card.
  const stepButton = (id: string, glyph: string, disabled: boolean, delta: number) => (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={delta > 0 ? '+1' : '-1'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        setParty(Math.max(1, Math.min(maxParty, partySize + delta)));
        setPartyError(null);
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 40,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.seg : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 22, color: colors.blue }}>{glyph}</Text>
    </Pressable>
  );
  const peopleCard =
    offer && offer.maxPlaces > 1 ? (
      <View>
        <View
          testID="lesson-review.party"
          style={{ backgroundColor: colors.card, borderRadius: radius.sheet }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 10,
              paddingBottom: 10,
              paddingStart: space.l,
              paddingEnd: 10,
              borderBottomWidth: friendCount > 0 ? 1 : 0,
              borderBottomColor: colors.line,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.ink }}>
                {t('coaching.guest.review.party')}
              </Text>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
                {`${partyLabel} · ${t('coaching.guest.review.upToCount', {
                  count: isolateLtr(String(maxParty)),
                })}`}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colors.tint,
                borderRadius: radius.pill,
                padding: 2,
              }}
            >
              {stepButton('lesson-review.party.minus', '−', partySize <= 1, -1)}
              <Text
                style={{
                  width: 16,
                  textAlign: 'center',
                  fontFamily: fonts.display800,
                  fontSize: 16,
                  color: colors.ink,
                }}
              >
                {isolateLtr(String(partySize))}
              </Text>
              {stepButton('lesson-review.party.plus', '+', partySize >= maxParty, 1)}
            </View>
          </View>
          {friendCount > 0 ? (
            <View
              style={{
                paddingTop: space.sm,
                paddingBottom: space.sm,
                paddingStart: space.l,
                paddingEnd: space.l,
                gap: space.s,
              }}
            >
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
                {t('coaching.guest.review.friendsOptional')}
              </Text>
              {friendRows.map((row) => (
                <View key={row[0]} style={{ flexDirection: 'row', gap: space.s }}>
                  {[0, 1].map((col) => {
                    const i = row[col];
                    if (i === undefined) return <View key={col} style={{ flex: 1 }} />;
                    return (
                      <View key={col} style={{ flex: 1, minWidth: 0 }}>
                        <Field
                          testID={`lesson-review.friend.${i + 1}`}
                          placeholder={t('coaching.guest.review.friend', {
                            n: isolateLtr(String(i + 1)),
                          })}
                          value={friends[i] ?? ''}
                          maxLength={40}
                          onChangeText={(v) =>
                            setFriends((prev) => prev.map((f, j) => (j === i ? v : f)))
                          }
                          // Field sits 12 below its label slot; with no label
                          // the box pulls back up to the row's top.
                          style={{ marginTop: -space.sm, fontSize: 14 }}
                          boxStyle={{ height: 44, backgroundColor: colors.bg }}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <ErrorText>{partyError}</ErrorText>
      </View>
    ) : null;

  const paymentSection = (
    <View style={{ gap: space.s }}>
      <Text
        style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink, paddingStart: 4 }}
      >
        {t('coaching.guest.review.payment')}
      </Text>
      <PaySwitch
        testID="lesson-review.mode"
        choices={paymentChoices(venue?.paymentMode ?? 'desk')}
        value={mode}
        onChange={setPicked}
        labels={{
          desk: t('coaching.guest.review.payDesk'),
          online: t('coaching.guest.review.payOnline'),
        }}
      />
      <Text
        style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut, paddingStart: 4 }}
      >
        {`${t(
          mode === 'online' ? 'coaching.guest.review.onlineLine' : 'coaching.guest.review.deskLine',
        )} ${t('coaching.guest.class.cancelGroup', {
          hours: countPhrase('coaching.common.count.hours', hours, locale),
        })}`}
      </Text>
      {priceNote ? <Hint>{priceNote}</Hint> : null}
    </View>
  );

  return (
    <Screen edges={[]} padded={false}>
      <Stack.Screen
        options={{
          title: t('coaching.guest.review.title'),
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: brand.white,
          headerTitleStyle: {
            fontFamily: fonts.display800,
            fontSize: dir === 'rtl' ? 16 : 17,
            color: brand.white,
          },
        }}
      />
      <View style={{ flex: 1 }}>
        {hero}
        {/* The light sheet rides up over the blue header; only it scrolls. */}
        <View
          style={{
            flex: 1,
            minHeight: 0,
            marginTop: -SHEET_OVERLAP,
            backgroundColor: colors.bg,
            borderTopStartRadius: radius.sheet,
            borderTopEndRadius: radius.sheet,
            overflow: 'hidden',
          }}
        >
          <FormScreen
            bottomInset={BOOK_BAR_SPACE + space.l}
            contentStyle={{
              paddingTop: space.l,
              paddingStart: space.l,
              paddingEnd: space.l,
              gap: space.sm,
            }}
          >
            {degraded && phone ? (
              <DegradedBanner
                testID="lesson-review.degraded"
                tight
                message={t('degraded.bannerAvailability', { phone: isolate(phone) })}
                phone={phone}
              />
            ) : null}
            {timeCard}
            {peopleCard}
            {paymentSection}
            {banner ? (
              <View testID="lesson-review.refusal">
                <MatchNotice text={banner} />
              </View>
            ) : null}
            <ErrorText>{error}</ErrorText>
            {error &&
            !banner &&
            !needsTerms &&
            venue?.paymentMode === 'online_optional' &&
            mode === 'online' ? (
              <Button
                testID="lesson-review.pay-desk-instead"
                label={t('coaching.guest.review.payDeskInstead')}
                variant="ghost"
                onPress={() => {
                  setPicked('desk');
                  setError(null);
                }}
              />
            ) : null}
          </FormScreen>
        </View>
      </View>
      {/* The "Pick a time" page's book bar: the time, the price and Book. A
        refusal the guest cannot fix here takes it away. */}
      {banner ? null : (
        <View
          style={{
            position: 'absolute',
            start: space.sm,
            end: space.sm,
            bottom: insets.bottom + space.s,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: brand.navy,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: brand.navyLine,
            paddingTop: space.sm,
            paddingBottom: space.sm,
            paddingStart: space.xl,
            paddingEnd: space.sm,
            boxShadow: shadows.dialog,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.body400, fontSize: 12.5, color: brand.navyText }}
            >
              {`${dayLabel} · ${startLabel}`}
            </Text>
            {offer?.priceIqd != null ? (
              <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: brand.white }}>
                {money(offer.priceIqd)}
              </Text>
            ) : null}
          </View>
          <Button
            testID="lesson-review.book"
            label={t(
              mode === 'online' ? 'coaching.guest.review.bookAndPay' : 'coaching.guest.review.book',
            )}
            variant="cta"
            size="compact"
            busy={busy}
            disabled={!offer || offer.priceIqd === null}
            onPress={onBook}
            style={{ borderRadius: radius.pill, paddingStart: space.xl, paddingEnd: space.xl }}
          />
        </View>
      )}
    </Screen>
  );
}

/**
 * Desk or Qi Card: a pill track with the picked one lifted white when the
 * branch offers both (`online_optional`), else the one mode as a line. The
 * track is `testID`; each segment `${testID}.desk` / `${testID}.online`.
 */
function PaySwitch({
  testID,
  choices,
  value,
  onChange,
  labels,
}: {
  testID: string;
  choices: readonly PaymentChoice[];
  value: PaymentChoice;
  onChange: (next: PaymentChoice) => void;
  labels: Record<PaymentChoice, string>;
}) {
  const { colors, fonts } = useTheme();
  if (choices.length < 2) {
    return (
      <View testID={testID} style={{ paddingStart: 4 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
          {labels[value]}
        </Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        gap: 4,
        padding: 4,
        borderRadius: radius.pill,
        backgroundColor: colors.seg,
      }}
    >
      {choices.map((c) => {
        const on = c === value;
        return (
          <Pressable
            key={c}
            testID={`${testID}.${c}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(c)}
            style={{
              flex: 1,
              height: 40,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              paddingStart: space.xs,
              paddingEnd: space.xs,
              backgroundColor: on ? colors.card : 'transparent',
              boxShadow: on ? shadows.thumb : undefined,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: on ? fonts.body700 : fonts.body600,
                fontSize: 13.5,
                color: on ? colors.ink : colors.mut,
              }}
            >
              {labels[c]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Session-gated like the rest of the booking flow (RequireSession). */
export default function GuardedLessonReviewScreen() {
  return (
    <RequireSession>
      <LessonReviewScreen />
    </RequireSession>
  );
}
