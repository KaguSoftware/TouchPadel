import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useCourts } from '../../src/features/availability/hooks';
import { registerPushToken } from '../../src/features/profile/push';
import { addBreadcrumb } from '../../src/lib/telemetry';
import { theme } from '../../src/theme';
import { Button, Hint, Screen, Title } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { mapErrorToKey } from '../../src/features/booking/errors';

/** Court list from the DB (bilingual names via pickLocale). */
export default function CourtListScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const courts = useCourts();

  // Best-effort push registration once signed in. The outcome is recorded —
  // this used to be a bare `void` over a function whose every failure path was
  // swallowed, which is why push being dead on device was invisible for days.
  useEffect(() => {
    void registerPushToken().then((state) => addBreadcrumb('push.register', { state }));
  }, []);

  // A content-shaped skeleton instead of a bare centred spinner: nothing jumps
  // when the data lands.
  if (courts.isLoading) {
    return (
      <Screen>
        <Title>{t('courts.title')}</Title>
        <SkeletonList rows={4} height={92} />
      </Screen>
    );
  }

  // THIS BRANCH IS THE POINT. Previously only isLoading was checked, so a failed
  // fetch fell through to ListEmptyComponent and the screen said "No courts are
  // available right now" — presenting a network error as fact, with no retry.
  if (courts.isError) {
    return (
      <Screen>
        <Title>{t('courts.title')}</Title>
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(courts.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void courts.refetch()}
          busy={courts.isRefetching}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t('courts.title')}</Title>
      <FlatList
        data={courts.data ?? []}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl
            refreshing={courts.isRefetching}
            onRefresh={() => void courts.refetch()}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={<Hint>{t('courts.noCourts')}</Hint>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.card}
            onPress={() => router.push({ pathname: '/(app)/availability', params: { courtId: item.id } })}
          >
            {/* Photo placeholder — real court photos land with the client pack. */}
            <View style={styles.photo}>
              <Text style={styles.photoGlyph}>TP</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>
                {pickLocale({ en: item.name_en, ar: item.name_ar }, locale)}
              </Text>
              <Text style={styles.cardMeta}>
                {item.indoor ? t('courts.indoor') : t('courts.outdoor')}
                {' · '}
                {item.duration_options
                  .map((d) => t('booking.durationMinutes', { minutes: d }))
                  .join(' / ')}
              </Text>
              {pickLocale({ en: item.description_en, ar: item.description_ar }, locale) ? (
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {pickLocale({ en: item.description_en, ar: item.description_ar }, locale)}
                </Text>
              ) : null}
              <Text style={styles.cardLink}>{t('courts.viewAvailability')}</Text>
            </View>
          </Pressable>
        )}
      />
      <Button
        label={t('booking.myBookings')}
        variant="secondary"
        onPress={() => router.push('/(app)/bookings')}
      />
      <Button
        label={t('settings.title')}
        variant="secondary"
        onPress={() => router.push('/(app)/settings')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  photo: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent2,
  },
  photoGlyph: { fontSize: 20, fontWeight: '800', color: theme.accent2Contrast },
  cardBody: { flex: 1, paddingStart: 12, paddingEnd: 12, paddingTop: 10, paddingBottom: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: theme.fg },
  cardMeta: { fontSize: 13, color: theme.mutedFg, marginTop: 2 },
  cardDesc: { fontSize: 13, color: theme.mutedFg, marginTop: 4 },
  cardLink: { fontSize: 13, color: theme.accent, fontWeight: '600', marginTop: 6 },
});
