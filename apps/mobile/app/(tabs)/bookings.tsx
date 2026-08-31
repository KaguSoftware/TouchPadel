import { useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
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
import { radius, space, useTheme } from '../../src/theme';
import { Hint, Screen, SectionLabel, Title } from '../../src/components/ui';
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
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const bookings = useMyBookings();
  const courts = useCourts();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();
  useCourtsBroadcast(); // desk moves/cancels reflect live

  const { upcoming, past } = useMemo(
    () => splitBookings(session ? (bookings.data ?? []) : [], new Date()),
    [session, bookings.data],
  );

  // O(1) lookup instead of a per-row find.
  const courtNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courts.data ?? []) {
      m.set(c.id, pickLocale({ en: c.name_en, ar: c.name_ar }, locale));
    }
    return m;
  }, [courts.data, locale]);

  const header = (
    <View style={{ paddingTop: space.l }}>
      <Title>{t('booking.myBookings')}</Title>
      {degraded ? (
        <View style={{ marginTop: 2, marginBottom: 8 }}>
          <DegradedBanner
            message={t('degraded.bannerBookings', { phone: venuePhoneOf(settings.data) ?? '' })}
          />
        </View>
      ) : null}
    </View>
  );

  // Signed-out: same empty state, with the sign-in path.
  if (!session) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        {header}
        <EmptyState
          title={t('booking.noBookingsTitle')}
          message={t('auth.signedOutPitch')}
          actionLabel={t('auth.signIn')}
          onAction={() => router.push('/(auth)/welcome')}
        />
      </Screen>
    );
  }

  if (bookings.isLoading) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        {header}
        <SkeletonList rows={3} height={78} />
      </Screen>
    );
  }

  // An error is never presented as "no bookings" — that lie shipped once.
  if (bookings.isError) {
    return (
      <Screen style={{ paddingTop: insets.top }}>
        {header}
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(bookings.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void bookings.refetch()}
          busy={bookings.isRefetching}
        />
      </Screen>
    );
  }

  const noBookings = upcoming.length === 0 && past.length === 0;

  const sections = [
    { title: t('booking.upcoming'), key: 'upcoming', data: upcoming },
    { title: t('booking.past'), key: 'past', data: past },
  ];

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
        <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>
          {courtNames.get(item.court_id) ?? ''}
        </Text>
        <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, marginTop: 2 }}>
          {formatDate(new Date(item.start_at), locale)}
          {' · '}
          {formatTime(new Date(item.start_at), locale)}–{formatTime(new Date(item.end_at), locale)}
          {item.price_iqd != null ? ` · ${formatIQD(item.price_iqd, locale)}` : ''}
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
        <Text style={{ fontFamily: fonts.display800, fontSize: 13, color: colors.mut2 }}>
          {courtNames.get(item.court_id) ?? ''}
        </Text>
        <Text style={{ fontFamily: fonts.body400, fontSize: 11.5, color: colors.fnt, marginTop: 2 }}>
          {formatDate(new Date(item.start_at), locale)}
          {' · '}
          {formatTime(new Date(item.start_at), locale)}
          {item.price_iqd != null ? ` · ${formatIQD(item.price_iqd, locale)}` : ''}
        </Text>
      </View>
      <StatusPill status={item.status} />
    </Pressable>
  );

  return (
    <Screen style={{ paddingTop: insets.top }}>
      {noBookings ? (
        <>
          {header}
          <EmptyState
            title={t('booking.noBookingsTitle')}
            message={t('booking.noBookingsBody')}
            actionLabel={t('booking.title')}
            onAction={() => router.push('/availability')}
          />
        </>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 90 }}
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
              <View
                style={{
                  marginTop: 8,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: colors.line2,
                  borderRadius: radius.button,
                  padding: 18,
                  alignItems: 'center',
                }}
              >
                <Hint>
                  {t('booking.emptyUpcoming')}{' '}
                  <Text
                    onPress={() => router.push('/availability')}
                    style={{ fontFamily: fonts.body800, color: colors.ink }}
                  >
                    {t('booking.bookNext')}
                  </Text>
                </Hint>
              </View>
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
