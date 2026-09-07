import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatTime } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useMyBookings } from '../src/features/booking/hooks';
import { useClearHistory, useHistoryClearedAt } from '../src/features/booking/history';
import { splitBookings, visiblePast, type BookingRow } from '../src/features/booking/logic';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useCourts } from '../src/features/availability/hooks';
import { formatPrice } from '../src/lib/price';
import { space, useTheme } from '../src/theme';
import { Button, Hint, Screen } from '../src/components/ui';
import { ListHeading, PastBookingRow } from '../src/components/booking';
import { ClockIcon } from '../src/components/icons';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmationDialog, useToast } from '../src/components/overlays';

/**
 * Booking history (owner, 2026-09-08) — every previous game, and the only place
 * the list can be cleared.
 *
 * My reservations keeps the two most recent past games and hands the rest here,
 * so the tab stays about what is next while an account that has played for a
 * year still has somewhere to look back from. Same rail, same rows, same route
 * into booking detail: this is the tab's Past section given the whole screen,
 * not a second way of showing a booking.
 *
 * CLEAR HISTORY HIDES; IT DOES NOT DELETE. A reservation is the venue's record
 * too, so the app has no business destroying one to tidy a list — the cut is an
 * ISO timestamp on this device (features/booking/history.ts), the rows stay on
 * the account, and the dialog says so before anything happens.
 */
function BookingHistoryScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bookings = useMyBookings();
  const courts = useCourts();
  const cleared = useHistoryClearedAt();
  const clear = useClearHistory();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  // The boundary is only ever read here, so unlike the tab this needs no minute
  // tick: a game that ends while the panel is open belongs to the tab's Past.
  const history = useMemo(() => {
    const { past } = splitBookings(bookings.data ?? [], new Date());
    return visiblePast(past, cleared.data ?? null);
  }, [bookings.data, cleared.data]);

  const courtNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courts.data ?? []) {
      m.set(c.id, pickLocale({ en: c.name_en, ar: c.name_ar }, locale));
    }
    return m;
  }, [courts.data, locale]);

  const onClear = () =>
    clear.mutate(undefined, {
      onSuccess: () => {
        setDialogOpen(false);
        toast(t('booking.historyClearedToast'), 'info');
      },
      onError: (err) => {
        setDialogOpen(false);
        toast(t(mapErrorToKey(err)), 'error');
      },
    });

  const header = <Stack.Screen options={{ title: t('booking.historyTitle') }} />;

  if (bookings.isLoading) {
    return (
      <Screen edges={[]}>
        {header}
        <SkeletonList rows={4} height={62} />
      </Screen>
    );
  }

  // Never presented as "no past games" — the tab's own rule.
  if (bookings.isError) {
    return (
      <Screen edges={[]}>
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

  const renderRow = (item: BookingRow, index: number) => {
    const start = new Date(item.start_at);
    return (
      <PastBookingRow
        courtName={courtNames.get(item.court_id) ?? ''}
        when={`${formatDate(start, locale)} · ${formatTime(start, locale)}`}
        price={formatPrice(item.price_iqd, locale)}
        status={item.status}
        first={index === 0}
        last={index === history.length - 1}
        onPress={() => router.push({ pathname: '/booking/[id]', params: { id: item.id } })}
      />
    );
  };

  return (
    <Screen edges={[]}>
      {header}
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 + insets.bottom, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={bookings.isRefetching}
            onRefresh={() => void bookings.refetch()}
            tintColor={colors.blue}
          />
        }
        ListHeaderComponent={
          history.length > 0 ? (
            <ListHeading
              icon={ClockIcon}
              label={t('booking.past')}
              count={history.length}
              style={{ marginBottom: 10 }}
            />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState fill title={t('booking.noHistoryTitle')} message={t('booking.noHistoryBody')} />
        }
        renderItem={({ item, index }) => renderRow(item, index)}
        ListFooterComponent={
          history.length > 0 ? (
            <View style={{ marginTop: space.l }}>
              <Button
                label={t('booking.clearHistory')}
                variant="dangerOutline"
                size="compact"
                busy={clear.isPending}
                onPress={() => setDialogOpen(true)}
              />
              <Hint style={{ fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
                {t('booking.clearHistoryHint')}
              </Hint>
            </View>
          ) : null
        }
      />

      <ConfirmationDialog
        visible={dialogOpen}
        danger
        title={t('booking.clearHistoryPrompt')}
        body={t('booking.clearHistoryBody')}
        confirmLabel={t('booking.clearHistory')}
        cancelLabel={t('common.cancel')}
        busy={clear.isPending}
        onConfirm={onClear}
        onDismiss={() => setDialogOpen(false)}
      />
    </Screen>
  );
}

export default function BookingHistoryRoute() {
  return (
    <RequireSession>
      <BookingHistoryScreen />
    </RequireSession>
  );
}
