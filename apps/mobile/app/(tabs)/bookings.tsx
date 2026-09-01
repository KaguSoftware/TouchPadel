import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { formatDate, formatTime, formatTimeRange } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useMyBookings, useReleaseHold } from '../../src/features/booking/hooks';
import { secondsUntil, splitBookings, type BookingRow } from '../../src/features/booking/logic';
import { mapErrorToKey } from '../../src/features/booking/errors';
import {
  useCourts,
  useCourtsBroadcast,
  useIsDegraded,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { useAuth } from '../../src/features/auth/context';
import { formatPrice } from '../../src/lib/price';
import { radius, space, useTheme } from '../../src/theme';
import { Screen, SectionLabel, Title } from '../../src/components/ui';
import { DateBadge, DegradedBanner, HeldSlotCard, StatusPill } from '../../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';

/**
 * My bookings tab (design 2026-08-31): Upcoming as date-badge cards, Past as a
 * muted list, both routing into booking detail — cancellation lives THERE now.
 * Signed-out shows the empty state with a sign-in path (browsing is public).
 *
 * Above them sits HELD: slots the guest has taken but not confirmed (0058).
 * Nothing in the app used to show a hold, so a guest who left Review had no way
 * to check what was still held in their name — the only symptom was the fourth
 * slot tap failing with HOLD_QUOTA_EXCEEDED. Each hold can be finished or
 * handed straight back from here.
 */
export default function BookingsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const { session } = useAuth();
  const bookings = useMyBookings();
  const courts = useCourts();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();
  const release = useReleaseHold();
  const toast = useToast();
  useCourtsBroadcast(); // desk moves/cancels reflect live

  // The upcoming/past boundary follows the clock, not the last data change —
  // a booking that ended while the screen was open used to stay "Upcoming".
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { holds, upcoming, past } = useMemo(
    () => splitBookings(bookings.data ?? [], now),
    [bookings.data, now],
  );

  // A hold's countdown has to move every second, but re-splitting the whole
  // list that often is waste — so the seconds tick is its own state and runs
  // ONLY while a hold is on screen. It stops on its own when the last one goes.
  const [holdNow, setHoldNow] = useState(() => new Date());
  const hasHolds = holds.length > 0;
  useEffect(() => {
    if (!hasHolds) return;
    setHoldNow(new Date());
    const id = setInterval(() => setHoldNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, [hasHolds]);

  // An expiring countdown must not just freeze at 0:00: the row is gone
  // server-side, so re-split (and refetch, which also frees the grid view).
  useEffect(() => {
    if (holds.some((h) => secondsUntil(h.hold_expires_at ?? null, holdNow) === 0)) {
      setNow(new Date());
      void bookings.refetch();
    }
    // `bookings` is a stable query object; the tick is what drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdNow, holds]);

  // O(1) lookup instead of a per-row find.
  const courtNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courts.data ?? []) {
      m.set(c.id, pickLocale({ en: c.name_en, ar: c.name_ar }, locale));
    }
    return m;
  }, [courts.data, locale]);

  const sections = useMemo(
    () => [
      { title: t('booking.upcoming'), key: 'upcoming', data: upcoming },
      { title: t('booking.past'), key: 'past', data: past },
    ],
    [t, upcoming, past],
  );

  // Pick the hold back up where Review left it. Everything the screen needs is
  // on the row, so this never depends on the tap that created the hold.
  const resumeHold = (row: BookingRow) =>
    router.push({
      pathname: '/review',
      params: {
        holdId: row.id,
        expiresAt: row.hold_expires_at ?? '',
        priceIqd: row.price_iqd == null ? '' : String(row.price_iqd),
        courtName: courtNames.get(row.court_id) ?? '',
        startAt: row.start_at,
        durationMin: String(
          Math.round(
            (new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000,
          ),
        ),
      },
    });

  const releaseHold = (row: BookingRow) =>
    release.mutate(row.id, {
      onSuccess: () => toast(t('booking.holdReleasedToast'), 'info'),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });

  const heldSection = holds.length > 0 && (
    <View>
      <SectionLabel style={{ marginTop: 6 }}>{t('booking.heldSection')}</SectionLabel>
      {holds.map((row) => {
        const left = secondsUntil(row.hold_expires_at ?? null, holdNow) ?? 0;
        const start = new Date(row.start_at);
        return (
          <HeldSlotCard
            key={row.id}
            courtName={courtNames.get(row.court_id) ?? ''}
            when={`${formatDate(start, locale)} · ${formatTimeRange(start, new Date(row.end_at), locale)}`}
            price={formatPrice(row.price_iqd, locale)}
            countdown={`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
            urgent={left <= 60}
            busy={release.isPending && release.variables === row.id}
            onResume={() => resumeHold(row)}
            onRelease={() => releaseHold(row)}
          />
        );
      })}
      <Text
        style={{
          marginTop: 8,
          fontFamily: fonts.body400,
          fontSize: 11.5,
          lineHeight: 17,
          color: colors.fnt,
        }}
      >
        {t('booking.heldSectionBody')}
      </Text>
    </View>
  );

  const phone = venuePhoneOf(settings.data);
  const header = (
    <View style={{ paddingTop: space.l }}>
      <Title>{t('booking.myBookings')}</Title>
      {degraded ? (
        <View style={{ marginTop: 2, marginBottom: 8 }}>
          <DegradedBanner
            tight
            lead={t('degraded.leadConnectionLost')}
            message={t('degraded.bannerBookings', { phone: phone ?? '' })}
            phone={phone}
          />
        </View>
      ) : null}
      {heldSection}
    </View>
  );

  const bottomPad = { paddingBottom: tabBarHeight + 24 };

  // Signed-out: same empty state, with the sign-in path.
  if (!session) {
    return (
      <Screen>
        {header}
        <View style={[{ flex: 1 }, bottomPad]}>
          <EmptyState
            fill
            title={t('booking.noBookingsTitle')}
            message={t('auth.signedOutPitch')}
            actionLabel={t('auth.signIn')}
            onAction={() => router.push('/(auth)/welcome')}
          />
        </View>
      </Screen>
    );
  }

  if (bookings.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList rows={3} height={78} />
      </Screen>
    );
  }

  // An error is never presented as "no bookings" — that lie shipped once.
  if (bookings.isError) {
    return (
      <Screen>
        {header}
        <View style={[{ flex: 1 }, bottomPad]}>
          <ErrorState
            title={t('errors.loadFailedTitle')}
            message={t(mapErrorToKey(bookings.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void bookings.refetch()}
            busy={bookings.isRefetching}
          />
        </View>
      </Screen>
    );
  }

  // A held slot counts: showing "No bookings yet" over a live hold is exactly
  // the blind spot this section exists to close.
  const noBookings = holds.length === 0 && upcoming.length === 0 && past.length === 0;

  const priceSuffix = (row: BookingRow) => {
    const price = formatPrice(row.price_iqd, locale);
    return price ? ` · ${price}` : '';
  };

  const renderUpcoming = (item: BookingRow) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/booking/[id]', params: { id: item.id } })}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        flexDirection: 'row',
        gap: space.sm,
        alignItems: 'center',
        marginTop: 9,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <DateBadge date={new Date(item.start_at)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>
          {courtNames.get(item.court_id) ?? ''}
        </Text>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, marginTop: 2 }}
        >
          {formatDate(new Date(item.start_at), locale)}
          {' · '}
          {formatTimeRange(new Date(item.start_at), new Date(item.end_at), locale)}
          {priceSuffix(item)}
        </Text>
      </View>
      <StatusPill status={item.status} />
    </Pressable>
  );

  const renderPast = (item: BookingRow) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/booking/[id]', params: { id: item.id } })}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: 11,
        paddingBottom: 11,
        flexDirection: 'row',
        gap: space.sm,
        alignItems: 'center',
        marginTop: 9,
        opacity: pressed ? 0.7 : 0.82,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.display800, fontSize: 13, color: colors.mut2 }}>
          {courtNames.get(item.court_id) ?? ''}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body400, fontSize: 11.5, color: colors.fnt, marginTop: 2 }}
        >
          {formatDate(new Date(item.start_at), locale)}
          {' · '}
          {formatTime(new Date(item.start_at), locale)}
          {priceSuffix(item)}
        </Text>
      </View>
      <StatusPill status={item.status} />
    </Pressable>
  );

  return (
    <Screen>
      {noBookings ? (
        <>
          {header}
          <View style={[{ flex: 1 }, bottomPad]}>
            <EmptyState
              fill
              title={t('booking.noBookingsTitle')}
              message={t('booking.noBookingsBody')}
              actionLabel={t('booking.title')}
              onAction={() => router.push('/availability')}
            />
          </View>
        </>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={bottomPad}
          refreshControl={
            <RefreshControl
              refreshing={bookings.isRefetching}
              onRefresh={() => void bookings.refetch()}
              tintColor={colors.blue}
            />
          }
          renderSectionHeader={({ section }) =>
            section.data.length > 0 || section.key === 'upcoming' ? (
              <SectionLabel style={{ marginTop: section.key === 'past' ? 20 : 6 }}>
                {section.title}
              </SectionLabel>
            ) : null
          }
          renderSectionFooter={({ section }) =>
            section.data.length === 0 && section.key === 'upcoming' ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push('/availability')}
                style={({ pressed }) => ({
                  marginTop: 8,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: colors.line2,
                  borderRadius: radius.button,
                  padding: 18,
                  alignItems: 'center',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: fonts.body400,
                    fontSize: 12.5,
                    color: colors.mut,
                    textAlign: 'center',
                  }}
                >
                  {t('booking.emptyUpcoming')}{' '}
                  <Text style={{ fontFamily: fonts.body800 }}>{t('booking.bookNext')}</Text>
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item, section }) =>
            section.key === 'upcoming' ? renderUpcoming(item) : renderPast(item)
          }
        />
      )}
    </Screen>
  );
}
