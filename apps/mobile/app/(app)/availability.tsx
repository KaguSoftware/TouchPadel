import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { pickLocale } from '@touch/core';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import {
  useCourts,
  useCourtsBroadcast,
  useDayGrid,
} from '../../src/features/availability/hooks';
import {
  DEFAULT_TZ,
  groupByStart,
  listBookableDates,
  type GridCell,
} from '../../src/features/availability/assemble';
import { useHoldSlot } from '../../src/features/booking/hooks';
import { isDegradedRefusal, mapErrorToKey } from '../../src/features/booking/errors';
import { theme, slotColors } from '../../src/theme';
import { Button, ErrorText, Hint, Loading, Screen } from '../../src/components/ui';

// TODO: venue phone for the degraded message — venue_settings_public carries no
// phone column yet; falls back to degraded.bookingRefusedShort until it does.
function venuePhoneOf(settings: unknown): string | null {
  const p = (settings as { venue_phone?: unknown } | undefined)?.venue_phone;
  return typeof p === 'string' && p.length > 0 ? p : null;
}

/** Day availability grid: date picker (today + 14) x per-court priced slots. */
export default function AvailabilityScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ courtId?: string }>();
  const courts = useCourts();

  const tzDates = useMemo(() => listBookableDates(new Date(), DEFAULT_TZ), []);
  const [date, setDate] = useState<string>(tzDates[0] ?? '');
  const day = useDayGrid(date);
  useCourtsBroadcast(); // live slot_changed -> availability invalidation

  const [picker, setPicker] = useState<{ courtId: string; cell: GridCell } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useHoldSlot();

  const onPickDuration = (courtId: string, cell: GridCell, durationMin: number, price: number | null) => {
    setPicker(null);
    setError(null);
    hold.mutate(
      { courtId, startAt: cell.startAt, durationMin },
      {
        onSuccess: (result) => {
          const court = courts.data?.find((c) => c.id === courtId);
          router.push({
            pathname: '/(app)/confirm',
            params: {
              holdId: result.reservationId,
              expiresAt: result.holdExpiresAt ?? '',
              priceIqd: String(result.priceIqd ?? price ?? ''),
              courtName: court
                ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale)
                : '',
              startAt: cell.startAt.toISOString(),
              durationMin: String(durationMin),
            },
          });
        },
        onError: (err) => {
          if (isDegradedRefusal(err.message)) {
            const phone = venuePhoneOf(day.settings);
            setError(
              phone
                ? t('degraded.bookingRefused', { phone })
                : t('degraded.bookingRefusedShort'),
            );
          } else {
            setError(t(mapErrorToKey(err)));
          }
          day.refetch();
        },
      },
    );
  };

  const visibleCourts = (courts.data ?? []).filter(
    (c) => !params.courtId || c.id === params.courtId,
  );

  return (
    <Screen>
      {/* Date strip: today + 14 days */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateStrip}>
        {tzDates.map((d) => (
          <Pressable
            key={d}
            accessibilityRole="button"
            onPress={() => setDate(d)}
            style={[styles.dateChip, d === date && styles.dateChipActive]}
          >
            <Text style={[styles.dateChipText, d === date && styles.dateChipTextActive]}>
              {d === tzDates[0]
                ? t('common.today')
                : formatDate(new Date(`${d}T12:00:00Z`), locale)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        {(['free', 'held', 'booked', 'blocked'] as const).map((s) => (
          <View key={s} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: slotColors[s]?.bg }]} />
            <Text style={styles.legendText}>
              {t(
                s === 'free'
                  ? 'booking.stateFree'
                  : s === 'held'
                    ? 'booking.stateHeld'
                    : s === 'booked'
                      ? 'booking.stateBooked'
                      : 'booking.stateBlocked',
              )}
            </Text>
          </View>
        ))}
      </View>

      <ErrorText>{error}</ErrorText>

      {day.isLoading ? (
        <Loading />
      ) : day.isError ? (
        <>
          <Hint>{t('errors.network')}</Hint>
          <Button label={t('common.retry')} onPress={day.refetch} />
        </>
      ) : (
        <ScrollView>
          {day.grid
            .filter((cs) => visibleCourts.some((c) => c.id === cs.courtId))
            .map((courtSlots) => {
              const court = courts.data?.find((c) => c.id === courtSlots.courtId);
              const cells = groupByStart(courtSlots.slots);
              return (
                <View key={courtSlots.courtId} style={styles.courtBlock}>
                  <Text style={styles.courtName}>
                    {court ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale) : ''}
                  </Text>
                  {cells.length === 0 ? (
                    <Hint>{t('courts.noCourts')}</Hint>
                  ) : (
                    <View style={styles.slotWrap}>
                      {cells.map((cell) => {
                        const colors = slotColors[cell.state] ?? slotColors.free!;
                        const minPrice = cell.options
                          .filter((o) => o.priceIqd != null)
                          .reduce<number | null>(
                            (min, o) => (min == null || o.priceIqd! < min ? o.priceIqd : min),
                            null,
                          );
                        const tappable = cell.state === 'free';
                        return (
                          <Pressable
                            key={cell.startAt.toISOString()}
                            accessibilityRole="button"
                            disabled={!tappable}
                            onPress={() =>
                              setPicker({ courtId: courtSlots.courtId, cell })
                            }
                            style={[styles.slotCell, { backgroundColor: colors.bg }]}
                          >
                            <Text style={[styles.slotTime, { color: colors.fg }]}>
                              {formatTime(cell.startAt, locale)}
                            </Text>
                            {tappable && minPrice != null ? (
                              <Text style={[styles.slotPrice, { color: colors.fg }]}>
                                {formatIQD(minPrice, locale)}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
        </ScrollView>
      )}

      {/* Duration picker for the tapped start time */}
      <Modal visible={picker !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('booking.selectDuration')}</Text>
            {picker?.cell.options
              .filter((o) => o.state === 'free')
              .map((o) => (
                <Pressable
                  key={o.durationMin}
                  accessibilityRole="button"
                  style={styles.durationRow}
                  onPress={() => onPickDuration(picker.courtId, picker.cell, o.durationMin, o.priceIqd)}
                >
                  <Text style={styles.durationLabel}>
                    {t('booking.durationMinutes', { minutes: o.durationMin })}
                  </Text>
                  <Text style={styles.durationPrice}>
                    {o.priceIqd != null ? formatIQD(o.priceIqd, locale) : t('booking.noRate')}
                  </Text>
                </Pressable>
              ))}
            <Button
              label={t('common.cancel')}
              variant="secondary"
              onPress={() => setPicker(null)}
              busy={hold.isPending}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateStrip: { flexGrow: 0, marginBottom: 8 },
  dateChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingStart: 12,
    paddingEnd: 12,
    paddingTop: 6,
    paddingBottom: 6,
    marginEnd: 8,
    backgroundColor: theme.surface,
  },
  dateChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  dateChipText: { fontSize: 13, color: theme.fg },
  dateChipTextActive: { color: theme.accentContrast, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, color: theme.mutedFg },
  courtBlock: { marginTop: 12 },
  courtName: { fontSize: 17, fontWeight: '700', color: theme.fg, marginBottom: 6 },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotCell: {
    borderRadius: 8,
    paddingStart: 10,
    paddingEnd: 10,
    paddingTop: 6,
    paddingBottom: 6,
    minWidth: 86,
    alignItems: 'center',
  },
  slotTime: { fontSize: 14, fontWeight: '700' },
  slotPrice: { fontSize: 11, marginTop: 2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: 24,
    paddingEnd: 24,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: theme.bg,
    borderRadius: 12,
    paddingStart: 16,
    paddingEnd: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.fg, marginBottom: 8 },
  durationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  durationLabel: { fontSize: 16, color: theme.fg, fontWeight: '600' },
  durationPrice: { fontSize: 16, color: theme.accent, fontWeight: '700' },
});
