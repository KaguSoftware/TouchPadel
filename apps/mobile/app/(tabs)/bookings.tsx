import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { formatDate, formatTime, formatTimeRange } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useMyBookings } from '../../src/features/booking/hooks';
import { splitBookings, type BookingRow } from '../../src/features/booking/logic';
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
import { DateBadge, DegradedBanner, StatusPill } from '../../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';

/**
 * My bookings tab (design 2026-08-31): Upcoming as date-badge cards, Past as a
 * muted list, both routing into booking detail — cancellation lives THERE now.
 * Signed-out shows the empty state with a sign-in path (browsing is public).
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
  useCourtsBroadcast(); // desk moves/cancels reflect live

  // The upcoming/past boundary follows the clock, not the last data change —
  // a booking that ended while the screen was open used to stay "Upcoming".
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { upcoming, past } = useMemo(
    () => splitBookings(bookings.data ?? [], now),
    [bookings.data, now],
  );

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

  const noBookings = upcoming.length === 0 && past.length === 0;

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
