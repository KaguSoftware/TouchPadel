import { RefreshControl, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatIQD, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space, useTheme } from '../../src/theme';
import { Button, Hint, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { SkeletonList } from '../../src/components/states';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../../src/features/staff/keys';
import { StoredPhotos } from '../../src/features/staff/supplies/StoredPhotos';
import {
  PurchaseCard,
  PurchaseGroup,
  PurchaseSection,
  usePurchaseDelivery,
} from '../../src/features/staff/supplies/PurchaseParts';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { fetchMyPurchases } from '../../src/features/staff/supplies/api';
import { PURCHASE_ROLES, formatQty, lineName } from '../../src/features/staff/supplies/logic';

/**
 * One purchase, on its own page, opened from "Details" on the purchases list
 * (`?id=`): the status band and total on top, then Items, Info and the
 * receipt, each under a header band of its own (Touch Blue in light, the
 * page's blue in dark). "Delivered" sits in the bottom bar until the goods are
 * at the venue. The purchase is read from the list's own query
 * (`my_purchases`), so there is nothing more to fetch.
 */
function PurchaseDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string }>();
  const { status, venueId } = useStaffStatus();
  const venue = venueId ?? '';

  const purchases = useQuery({
    queryKey: staffKeys.purchases(venue),
    queryFn: () => fetchMyPurchases(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => Promise.all([purchases.refetch()]));
  const delivery = usePurchaseDelivery(venue);

  if (status.kind !== 'staff') return null;

  const row = purchases.data?.purchases.find((p) => p.id === params.id);
  const body = { fontFamily: fonts.body400, fontSize: 14, color: colors.mut };
  const strong = { fontFamily: fonts.body700, fontSize: 14, color: colors.ink };
  const info = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
      <Text style={body}>{label}</Text>
      <Text style={{ ...strong, flexShrink: 1 }}>{value}</Text>
    </View>
  );

  return (
    <Screen pattern="blur" clearBar edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.purchase.list.detailTitle') }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        bar={
          row && !row.delivered_at ? (
            <Button
              testID="staff-purchase-detail.delivered"
              label={t('staff.supplies.purchase.list.markDelivered')}
              variant="primary"
              busy={delivery.busyId === row.id}
              onPress={() => delivery.confirm(row.id)}
            />
          ) : null
        }
      >
        {purchases.isPending && venue !== '' ? (
          <SkeletonList rows={3} height={96} />
        ) : !row ? (
          <Hint>{t('staff.supplies.purchase.list.notFound')}</Hint>
        ) : (
          <>
            <PurchaseCard testID="staff-purchase-detail.summary" row={row}>
              <View style={{ padding: 16, gap: 6 }}>
                <Text style={{ fontFamily: fonts.display800, fontSize: 21, color: colors.ink }}>
                  {row.shop_name
                    ? isolate(row.shop_name)
                    : t('staff.supplies.purchase.list.noShop')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text
                    style={{
                      flexShrink: 1,
                      fontFamily: fonts.body600,
                      fontSize: 14,
                      color: colors.mut,
                    }}
                  >
                    {formatDateTime(new Date(row.bought_at), locale)}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontFamily: fonts.body800, fontSize: 22, color: colors.gtext }}>
                    {formatIQD(row.total_iqd, locale)}
                  </Text>
                </View>
              </View>
            </PurchaseCard>

            <PurchaseGroup>
              <PurchaseSection grouped title={t('staff.supplies.purchase.list.detailTitle')} />
              <PurchaseSection grouped plain title={t('staff.supplies.purchase.list.secItems')}>
                {row.lines.map((l, i) => (
                  <View
                    key={`${row.id}-${i}`}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: space.s,
                    }}
                  >
                    <Text style={{ ...strong, flexShrink: 1 }}>
                      {lineName(l, locale)}
                      <Text style={body}>{` · ${formatQty(t, locale, l.qty, l.unit)}`}</Text>
                    </Text>
                    <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.gtext }}>
                      {formatIQD(l.price_iqd, locale)}
                    </Text>
                  </View>
                ))}
                <View style={{ height: 1, backgroundColor: colors.line }} />
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.ink }}>
                    {t('staff.supplies.purchase.form.total')}
                  </Text>
                  <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.gtext }}>
                    {formatIQD(row.total_iqd, locale)}
                  </Text>
                </View>
              </PurchaseSection>
              <PurchaseSection grouped plain title={t('staff.supplies.purchase.list.secInfo')}>
                {info(
                  t('staff.supplies.purchase.list.shop'),
                  row.shop_name ? isolate(row.shop_name) : t('staff.supplies.purchase.list.noShop'),
                )}
                {info(
                  t('staff.supplies.purchase.list.bought'),
                  formatDateTime(new Date(row.bought_at), locale),
                )}
                {info(
                  t('staff.supplies.purchase.list.delivery'),
                  row.delivered_at
                    ? formatDateTime(new Date(row.delivered_at), locale)
                    : t('staff.supplies.purchase.list.notDelivered'),
                )}
              </PurchaseSection>
              <PurchaseSection grouped plain title={t('staff.supplies.purchase.list.secReceipt')}>
                {row.receipt_path ? (
                  <StoredPhotos
                    paths={[row.receipt_path]}
                    size={Math.min(width - 2 * space.m - 34, 420)}
                  />
                ) : (
                  <Text style={body}>{t('staff.supplies.purchase.list.noReceipt')}</Text>
                )}
              </PurchaseSection>
            </PurchaseGroup>
          </>
        )}
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffPurchaseDetailRoute() {
  return (
    <RequireStaff page="staff-purchase-detail" roles={PURCHASE_ROLES}>
      <PurchaseDetailScreen />
    </RequireStaff>
  );
}
