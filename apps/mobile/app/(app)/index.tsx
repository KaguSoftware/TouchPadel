import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useCourts } from '../../src/features/availability/hooks';
import { registerPushToken } from '../../src/features/profile/push';
import { theme } from '../../src/theme';
import { Button, Hint, Loading, Screen, Title } from '../../src/components/ui';

/** Court list from the DB (bilingual names via pickLocale). */
export default function CourtListScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const courts = useCourts();

  // Best-effort push registration once signed in (silently no-ops in dev/simulator).
  useEffect(() => {
    void registerPushToken();
  }, []);

  if (courts.isLoading) return <Loading />;

  return (
    <Screen>
      <Title>{t('courts.title')}</Title>
      <FlatList
        data={courts.data ?? []}
        keyExtractor={(c) => c.id}
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
