import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatIQD, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, space, useTheme } from '../../src/theme';
import { Button, Hint, Screen, SegmentedControl } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { PurchaseCard, usePurchaseDelivery } from '../../src/features/staff/supplies/PurchaseParts';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { useHeaderAddOptions } from '../../src/navigation/headerAdd';
import { fetchMyPurchases, type PurchaseRow } from '../../src/features/staff/supplies/api';
import {
  PURCHASE_FILTERS,
  PURCHASE_ROLES,
  filterPurchases,
  type PurchaseFilter,
} from '../../src/features/staff/supplies/logic';

/**
 * Purchases (build-contracts-2026-09-23 §6.1, §2.24.10; plan #70).
 *
 * The venue's purchases, each a card headed by its status band (amber while
 * the goods are still to receive, green once delivered) with the shop, when it
 * was bought and what was paid. "Details" opens the purchase's own page
 * (`staff-purchase-detail`: items, info and the receipt) and "Delivered"
 * confirms the goods are at the venue. The driver records a new purchase on its
 * own page (`staff-purchase-new`), opened from the + in the native bar like
 * every other "new" in the app. Managers and the owner read the list
 * (my_purchases answers them every purchase) and may confirm a delivery; they
 * record nothing on the phone. Nothing here touches the till, the drawer or day
 * close.
 */
function PurchasesScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const dark = appearance === 'dark';
  const router = useRouter();
  const { status, venueId } = useStaffStatus();

  const role = status.kind === 'staff' ? status.staff.role : null;
  const buyer = role === 'driver';
  const venue = venueId ?? '';

  const addOptions = useHeaderAddOptions(
    buyer && venue !== ''
      ? {
          testID: 'staff-purchase.add',
          label: t('staff.supplies.purchase.form.title'),
          onPress: () => router.push('/staff-purchase-new'),
        }
      : null,
  );

  const purchases = useQuery({
    queryKey: staffKeys.purchases(venue),
    queryFn: () => fetchMyPurchases(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => Promise.all([purchases.refetch()]));
  const delivery = usePurchaseDelivery(venue);
  const [filter, setFilter] = useState<PurchaseFilter>('all');

  if (status.kind !== 'staff') return null;

  // The filter is the scroll content's child after the hints that are showing (nulls do not count).
  const stickyIndex = (venue === '' ? 1 : 0) + (buyer ? 0 : 1);
  const all: PurchaseRow[] = purchases.data?.purchases ?? [];
  const rows = filterPurchases(all, filter);
  const filterLabel = (f: PurchaseFilter) =>
    f === 'all'
      ? t('staff.supplies.purchase.list.filterAll')
      : f === 'to_receive'
        ? t('work.purchase.status.to_receive')
        : t('staff.supplies.purchase.list.deliveredPill');

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.purchase.title'), ...addOptions }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        stickyHeaderIndices={[stickyIndex]}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        bar={null}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {!buyer ? <Hint>{t('staff.supplies.purchase.list.mgmtNote')}</Hint> : null}
        {/* Sticks to the top while the cards scroll under it; opaque so they do not show through. */}
        <View style={{ backgroundColor: colors.bg, paddingTop: space.xs, paddingBottom: space.s }}>
          <SegmentedControl<PurchaseFilter>
            testID="staff-purchase.filter"
            options={PURCHASE_FILTERS.map((f) => ({ value: f, label: filterLabel(f) }))}
            value={filter}
            onChange={setFilter}
          />
        </View>

        {purchases.isPending && venue !== '' ? (
          <SkeletonList rows={2} height={96} />
        ) : purchases.isError ? (
          <ErrorState
            testID="staff-purchase.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(purchases.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void purchases.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            centered
            testID="staff-purchase.empty"
            title={t(all.length === 0 ? 'staff.supplies.purchase.list.empty' : 'staff.supplies.purchase.list.emptyFilter')}
          />
        ) : (
          rows.map((p) => (
            <PurchaseCard key={p.id} testID={`staff-purchase.card.${p.id}`} row={p}>
              <View style={{ padding: 16, gap: 9 }}>
                <Text numberOfLines={2} style={{ fontFamily: fonts.display800, fontSize: 21, color: colors.ink, marginBottom: 6 }}>
                  {p.shop_name ? isolate(p.shop_name) : t('staff.supplies.purchase.list.noShop')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 14, color: colors.mut }}>
                    {formatDateTime(new Date(p.bought_at), locale)}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.gtext }}>
                    {formatIQD(p.total_iqd, locale)}
                  </Text>
                </View>
                {p.delivered_at ? (
                  <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
                    {t('staff.supplies.purchase.list.deliveredAt', {
                      when: formatDateTime(new Date(p.delivered_at), locale),
                    })}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: space.s, marginTop: 6 }}>
                  <Button
                    testID={`staff-purchase.details.${p.id}`}
                    label={t('staff.supplies.purchase.list.details')}
                    variant="secondary"
                    size="compact"
                    onPress={() => router.push({ pathname: '/staff-purchase-detail', params: { id: p.id } })}
                    // In dark mode a gray-white button with blue text, so it stands out from the blue page.
                    style={dark ? { flex: 1, backgroundColor: '#E3E6EB', borderColor: '#E3E6EB' } : { flex: 1 }}
                    labelColor={dark ? brand.blue : undefined}
                    pressedBg={dark ? '#CDD2DA' : undefined}
                  />
                  {p.delivered_at ? null : (
                    <Button
                      testID={`staff-purchase.delivered.${p.id}`}
                      label={t('staff.supplies.purchase.list.markDelivered')}
                      variant="primary"
                      size="compact"
                      busy={delivery.busyId === p.id}
                      onPress={() => delivery.confirm(p.id)}
                      style={{ flex: 1 }}
                    />
                  )}
                </View>
              </View>
            </PurchaseCard>
          ))
        )}
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffPurchaseRoute() {
  return (
    <RequireStaff page="staff-purchase" roles={PURCHASE_ROLES}>
      <PurchasesScreen />
    </RequireStaff>
  );
}
