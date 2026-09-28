import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Field, Hint, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { PlusIcon, SearchIcon } from '../src/components/icons';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { ListCard } from '../src/features/staff/protocols/parts';
import { Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import {
  FLOOR_ROLES,
  addLine,
  defaultVariant,
  draftCount,
  itemCount,
  localName,
  needsChoices,
  rowPrice,
  searchMenu,
  type MenuItem,
} from '../src/features/staff/floor/logic';
import { newLineKey } from '../src/features/staff/floor/drafts';
import { tick, useFloorMenu } from '../src/features/staff/floor/parts';
import { TabPicker } from '../src/features/staff/floor/TabPicker';
import { useTableOrder } from '../src/features/staff/floor/useTableOrder';

/**
 * Place an order, step 2 (0251): one table. At the top, the tab the order
 * goes on (the table's only tab is already chosen; with several the waiter
 * picks; "New tab" takes an optional guest name). Below, the café menu: a
 * search, the categories as chips, and a row per item. An item with one size
 * and no options goes in with one tap and shows its count on the row; anything
 * else opens its sheet (app/staff-order-item.tsx). The bar at the bottom
 * always shows how much is in the order and leads to the review.
 */
function MenuScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const params = useLocalSearchParams<{ table?: string }>();
  const tableId = params.table ?? '';
  const { floor, table, draft, target, tabGone, update } = useTableOrder(venue, tableId);
  const menu = useFloorMenu(venue);
  const pull = usePullRefresh(() => Promise.all([floor.refetch(), menu.refetch()]));

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const count = draftCount(draft);
  const categories = useMemo(() => menu.data ?? [], [menu.data]);
  const found = useMemo(() => searchMenu(categories, query), [categories, query]);
  const searching = query.trim() !== '';

  const add = (item: MenuItem) => {
    if (needsChoices(item)) {
      router.push({ pathname: '/staff-order-item', params: { table: tableId, item: item.id } });
      return;
    }
    tick();
    update((d) =>
      addLine(d, { itemId: item.id, variantId: defaultVariant(item).id, qty: 1, modifierIds: [], note: '' }, newLineKey()),
    );
  };

  const itemRow = (item: MenuItem, last: boolean) => {
    const name = localName(item, locale);
    const inOrder = itemCount(draft, item.id);
    const { price, from } = rowPrice(item);
    const priceText = from ? t('staff.floor.menu.from', { price: formatIQD(price, locale) }) : formatIQD(price, locale);
    return (
      <Pressable
        key={item.id}
        testID={`staff-order-menu.item.${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('staff.floor.menu.add', { name })}
        accessibilityState={{ disabled: !item.orderable }}
        disabled={!item.orderable}
        onPress={() => add(item)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 60,
          paddingStart: space.l,
          paddingEnd: space.sm,
          paddingTop: 10,
          paddingBottom: 10,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.sub,
          backgroundColor: pressed ? colors.sub : 'transparent',
        })}
      >
        <View style={{ flex: 1, gap: 2, opacity: item.orderable ? 1 : 0.5 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 20, color: colors.ink }}>{name}</Text>
          <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut, fontVariant: ['tabular-nums'] }}>
            {priceText}
          </Text>
        </View>
        {!item.orderable ? (
          <Tag tone="warn" label={t('staff.floor.menu.soldOut')} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            {inOrder > 0 ? (
              <View
                accessibilityLabel={t('staff.floor.menu.inOrder', { count: formatNumber(inOrder, locale) })}
                style={{
                  minWidth: 28,
                  height: 28,
                  paddingStart: 8,
                  paddingEnd: 8,
                  borderRadius: radius.pill,
                  backgroundColor: colors.blue,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.card, fontVariant: ['tabular-nums'] }}>
                  {formatNumber(inOrder, locale)}
                </Text>
              </View>
            ) : null}
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.button,
                backgroundColor: colors.tint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PlusIcon size={20} color={colors.blue} strokeWidth={2.4} />
            </View>
          </View>
        )}
      </Pressable>
    );
  };

  const chip = (id: string, label: string) => {
    const on = category === id;
    return (
      <Pressable
        key={id}
        testID={`staff-order-menu.category.${id}`}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => setCategory(id)}
        style={({ pressed }) => ({
          height: 36,
          paddingStart: space.m,
          paddingEnd: space.m,
          borderRadius: radius.pill,
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: on ? colors.blue : colors.line,
          backgroundColor: on ? colors.blue : pressed ? colors.sub : colors.card,
        })}
      >
        <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: on ? colors.card : colors.ink }}>{label}</Text>
      </Pressable>
    );
  };

  const menuBody = () => {
    if (menu.isPending) return <SkeletonList rows={4} height={60} />;
    if (menu.isError) {
      return (
        <ErrorState
          testID="staff-order-menu.menu-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(menu.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void menu.refetch()}
        />
      );
    }
    if (categories.length === 0) return <Hint>{t('staff.floor.menu.menuEmpty')}</Hint>;
    if (searching) {
      if (found.length === 0) return <Hint>{t('staff.floor.menu.noResults', { query: isolate(query.trim()) })}</Hint>;
      return <ListCard>{found.map((i, n) => itemRow(i, n === found.length - 1))}</ListCard>;
    }
    const shown = category === 'all' ? categories : categories.filter((c) => c.id === category);
    return (
      <View style={{ gap: space.m }}>
        {shown.map((c) => (
          <View key={c.id} style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{localName(c, locale)}</MicroLabel>
            <ListCard>{c.items.map((i, n) => itemRow(i, n === c.items.length - 1))}</ListCard>
          </View>
        ))}
      </View>
    );
  };

  const title = table ? t('staff.floor.menu.title', { number: isolate(table.table_number) }) : '';
  const canReview = count > 0 || target?.kind === 'new';
  const footerLabel =
    count > 0
      ? t('staff.floor.menu.reviewCount', { count: formatNumber(count, locale) })
      : target?.kind === 'new'
        ? t('staff.floor.menu.openTab')
        : t('staff.floor.menu.review');
  const FOOTER = 76 + insets.bottom;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: FOOTER + space.l, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {floor.isPending ? (
          <SkeletonList rows={1} height={60} />
        ) : floor.isError ? (
          <ErrorState
            testID="staff-order-menu.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(floor.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void floor.refetch()}
          />
        ) : table ? (
          <View style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.floor.menu.goesOn')}</MicroLabel>
            {tabGone ? (
              <Card style={{ padding: space.m, backgroundColor: colors.amb, borderColor: colors.ambline }}>
                <Text style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ambtext }}>
                  {t('staff.floor.menu.tabGone')}
                </Text>
              </Card>
            ) : null}
            <TabPicker
              testID="staff-order-menu.target"
              tabs={table.tabs}
              target={target}
              label={draft?.label ?? ''}
              onTarget={(next) => update((d) => ({ ...d, target: next }))}
              onLabel={(label) => update((d) => ({ ...d, label }))}
            />
            {target === null && !tabGone ? <Hint>{t('staff.floor.menu.pickTab')}</Hint> : null}
          </View>
        ) : (
          <Hint>{t('errors.notFound')}</Hint>
        )}

        <View style={{ marginTop: space.s }}>
          <Field
            testID="staff-order-menu.search"
            placeholder={t('staff.floor.menu.search')}
            accessibilityLabel={t('staff.floor.menu.search')}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            lead={
              <View style={{ paddingStart: space.m }}>
                <SearchIcon size={16} color={colors.mut} />
              </View>
            }
            dense
          />
        </View>
        {!searching && categories.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}
            keyboardShouldPersistTaps="handled"
          >
            {chip('all', t('staff.floor.menu.all'))}
            {categories.map((c) => chip(c.id, localName(c, locale)))}
          </ScrollView>
        ) : null}
        <View testID="staff-order-menu.list">{menuBody()}</View>
      </ScrollView>

      {/* Always there, so the waiter knows what is in the order from anywhere on the menu. */}
      <View
        style={{
          position: 'absolute',
          start: 0,
          end: 0,
          bottom: 0,
          paddingTop: space.sm,
          paddingBottom: space.sm + insets.bottom,
          paddingStart: space.l,
          paddingEnd: space.l,
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        }}
      >
        <Button
          testID="staff-order-menu.review"
          label={footerLabel}
          variant="cta"
          disabled={!canReview || !table}
          onPress={() => router.push({ pathname: '/staff-order-review', params: { table: tableId } })}
        />
      </View>
    </Screen>
  );
}

export default function StaffOrderMenuRoute() {
  return (
    <RequireStaff roles={FLOOR_ROLES}>
      <MenuScreen />
    </RequireStaff>
  );
}
