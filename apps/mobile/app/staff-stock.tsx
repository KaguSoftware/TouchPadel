import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatNumber, formatTime } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Card, Field, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { fetchStock } from '../src/features/staff/stock/api';
import {
  STOCK_ROLES,
  filterStock,
  stockFilters,
  stockState,
  type StockFilter,
  type StockItem,
} from '../src/features/staff/stock/logic';
import type { StockUnit } from '../src/features/staff/supplies/production';
import { localName } from '../src/features/staff/checklists/logic';
import { Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Stock by quantity (build-contracts-2026-09-23 §2.24.5, §6.1; plan #68): the
 * head barista and the head chef see the cafe's stock, the court desk the Touch
 * Shop's (each row with the product it backs), the manager and the owner all
 * of it. On hand, par, running low and the next use-by; never a cost, a price
 * or a supplier. Read-only: counting and corrections stay with management on
 * the operator (logging stock is parked, §0 P5).
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function StockScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, venueId } = useStaffStatus();
  const role = status.kind === 'staff' ? status.staff.role : null;
  const venue = venueId ?? '';
  const filters = role ? stockFilters(role) : [];
  const [filter, setFilter] = useState<StockFilter>('all');
  const [query, setQuery] = useState('');

  const stock = useQuery({
    queryKey: staffKeys.stock(venue, filter),
    queryFn: () => fetchStock(venue, filter),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => stock.refetch());

  const qtyText = (qty: number, unit: StockUnit) =>
    t('staff.checklists.qty', { qty: formatNumber(qty, locale), unit: t(`staff.checklists.units.${unit}`) });

  const productLine = (item: StockItem): string | null => {
    if (!item.product) return null;
    const name = localName(item.product, locale);
    const size = locale === 'ar' ? item.product.size_name_ar : item.product.size_name_en;
    return size
      ? t('staff.checklists.stock.productSize', { name, size })
      : t('staff.checklists.stock.product', { name });
  };

  const rows = filterStock(stock.data?.items ?? [], query);

  const list = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (stock.isPending) return <SkeletonList rows={4} height={64} />;
    if (stock.isError) {
      return (
        <ErrorState
          testID="staff-stock.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(stock.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void stock.refetch()}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          testID="staff-stock.empty"
          title={t('staff.checklists.stock.emptyTitle')}
          message={t('staff.checklists.stock.emptyBody')}
        />
      );
    }
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((item, i) => {
          const state = stockState(item);
          const product = productLine(item);
          const figures = [
            t('staff.checklists.stock.onHand', { qty: qtyText(item.on_hand, item.unit) }),
            item.par_level !== null
              ? t('staff.checklists.stock.par', { qty: qtyText(item.par_level, item.unit) })
              : null,
            item.next_expiry ? t('staff.checklists.stock.nextExpiry', { date: dayLabel(item.next_expiry, locale) }) : null,
          ].filter(Boolean);
          return (
            <View
              key={item.ingredient_id}
              testID={`staff-stock.item.${item.ingredient_id}`}
              style={{
                paddingStart: space.m,
                paddingEnd: space.m,
                paddingTop: space.sm,
                paddingBottom: space.sm,
                gap: 4,
                borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                borderBottomColor: colors.sub,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
                <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                  {localName(item, locale)}
                </Text>
                {state !== 'ok' ? (
                  <Tag
                    tone={state === 'belowPar' ? 'warn' : 'bad'}
                    label={t(`staff.checklists.stock.state.${state}`)}
                  />
                ) : null}
              </View>
              {product ? (
                <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut2 }}>{product}</Text>
              ) : null}
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
                {figures.join(' · ')}
              </Text>
            </View>
          );
        })}
      </Card>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.stock.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>
          {t(role === 'court_desk' ? 'staff.checklists.stock.leadShop' : 'staff.checklists.stock.lead')}
        </Text>
        {filters.length > 0 ? (
          <SegmentedControl<StockFilter>
            testID="staff-stock.filter"
            options={filters.map((f) => ({ value: f, label: t(`staff.checklists.stock.filter.${f}`) }))}
            value={filter}
            onChange={setFilter}
          />
        ) : null}
        <Field
          testID="staff-stock.search"
          label={t('staff.checklists.stock.search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          dense
        />
        <View testID="staff-stock.list" style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingStart: 4, paddingEnd: 4 }}>
            <MicroLabel>{t('staff.checklists.stock.listTitle')}</MicroLabel>
            {stock.data ? (
              <Text style={{ fontFamily: fonts.body400, fontSize: 11.5, color: colors.mut }}>
                {t('staff.checklists.stock.asOf', { time: formatTime(new Date(stock.data.as_of), locale) })}
              </Text>
            ) : null}
          </View>
          {list()}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function StaffStockRoute() {
  return (
    <RequireStaff roles={STOCK_ROLES}>
      <StockScreen />
    </RequireStaff>
  );
}
