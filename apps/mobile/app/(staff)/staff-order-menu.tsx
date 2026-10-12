import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Card, Field, Hint, MicroLabel, Screen } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { PlusIcon, SearchIcon } from '../../src/components/icons';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { ListCard } from '../../src/features/staff/protocols/parts';
import { Tag } from '../../src/features/staff/checklists/parts';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
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
} from '../../src/features/staff/floor/logic';
import { newLineKey } from '../../src/features/staff/floor/drafts';
import { tick, useFloorMenu } from '../../src/features/staff/floor/parts';
import { TabPicker } from '../../src/features/staff/floor/TabPicker';
import { useTableOrder } from '../../src/features/staff/floor/useTableOrder';
import { searchField } from '../../src/components/fieldKeyboard';

/**
 * Place an order, step 2 (0251): one table. At the top, the tab the order
 * goes on (the table's only tab is already chosen; with several the waiter
 * picks; "New tab" takes an optional guest name). Below, the café menu: a
 * search, the categories as chips, and a row per item. An item with one size
 * and no options goes in with one tap and shows its count on the row; anything
 * else opens its sheet (app/(staff)/staff-order-item.tsx). The bar at the bottom
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
  const count = draftCount(draft);
  const categories = useMemo(() => menu.data ?? [], [menu.data]);
  const found = useMemo(() => searchMenu(categories, query), [categories, query]);
  const searching = query.trim() !== '';

  // The search and the chips stick under the bar once the menu reaches it, and
  // the lit chip is the category under them: scrolling moves the chip, a chip
  // tap scrolls to its category. Every position is the layout's, in the scroll
  // content's coordinates (the list's y plus a section's y inside it).
  const [category, setCategory] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const chipsRef = useRef<ScrollView>(null);
  const headerH = useRef(0);
  const listY = useRef(0);
  const sectionY = useRef<Record<string, number>>({});
  const chipX = useRef<Record<string, { x: number; width: number }>>({});
  const chipsW = useRef(0);
  // A chip tap scrolls past the categories in between; they must not light up
  // until the scroll reaches the tapped one (or the waiter takes over).
  const jumpingTo = useRef<string | null>(null);
  const active = category ?? categories[0]?.id ?? null;

  useEffect(() => {
    const at = active ? chipX.current[active] : undefined;
    if (!at) return;
    chipsRef.current?.scrollTo({
      x: Math.max(0, at.x - (chipsW.current - at.width) / 2),
      animated: true,
    });
  }, [active]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (searching) return;
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 4;
    const line = contentOffset.y + headerH.current + space.m;
    let next = categories[0]?.id ?? null;
    for (const c of categories) {
      const y = sectionY.current[c.id];
      if (y !== undefined && listY.current + y <= line) next = c.id;
    }
    // The last category may be too short ever to reach the line.
    if (atBottom && categories.length > 0) next = categories[categories.length - 1]!.id;
    if (jumpingTo.current !== null) {
      if (next !== jumpingTo.current) return;
      jumpingTo.current = null;
    }
    if (next !== active) setCategory(next);
  };

  const jumpTo = (id: string) => {
    const y = sectionY.current[id];
    setCategory(id);
    if (y === undefined) return;
    jumpingTo.current = id;
    scrollRef.current?.scrollTo({
      y: Math.max(0, listY.current + y - headerH.current - space.s),
      animated: true,
    });
  };

  const add = (item: MenuItem) => {
    if (needsChoices(item)) {
      router.push({ pathname: '/staff-order-item', params: { table: tableId, item: item.id } });
      return;
    }
    tick();
    update((d) =>
      addLine(
        d,
        { itemId: item.id, variantId: defaultVariant(item).id, qty: 1, modifierIds: [], note: '' },
        newLineKey(),
      ),
    );
  };

  const itemRow = (item: MenuItem, last: boolean) => {
    const name = localName(item, locale);
    const inOrder = itemCount(draft, item.id);
    const { price, from } = rowPrice(item);
    const priceText = from
      ? t('staff.floor.menu.from', { price: formatIQD(price, locale) })
      : formatIQD(price, locale);
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
          <Text
            style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 20, color: colors.ink }}
          >
            {name}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 12.5,
              color: colors.mut,
              fontVariant: ['tabular-nums'],
            }}
          >
            {priceText}
          </Text>
        </View>
        {!item.orderable ? (
          // Tag pins itself to the top (alignSelf: flex-start); wrapped, the
          // row's alignItems centres it on the name and price.
          <View>
            <Tag tone="warn" label={t('staff.floor.menu.soldOut')} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            {inOrder > 0 ? (
              <View
                accessibilityLabel={t('staff.floor.menu.inOrder', {
                  count: formatNumber(inOrder, locale),
                })}
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
                <Text
                  style={{
                    fontFamily: fonts.body700,
                    fontSize: 13,
                    color: colors.card,
                    fontVariant: ['tabular-nums'],
                  }}
                >
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
    const on = active === id;
    return (
      <Pressable
        key={id}
        testID={`staff-order-menu.category.${id}`}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onLayout={(e) => {
          chipX.current[id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
        }}
        onPress={() => jumpTo(id)}
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
        <Text
          style={{ fontFamily: fonts.body700, fontSize: 13, color: on ? colors.card : colors.ink }}
        >
          {label}
        </Text>
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
      if (found.length === 0)
        return <Hint>{t('staff.floor.menu.noResults', { query: isolate(query.trim()) })}</Hint>;
      return <ListCard>{found.map((i, n) => itemRow(i, n === found.length - 1))}</ListCard>;
    }
    return (
      <View style={{ gap: space.m }}>
        {categories.map((c) => (
          <View
            key={c.id}
            style={{ gap: space.xs }}
            onLayout={(e) => {
              sectionY.current[c.id] = e.nativeEvent.layout.y;
            }}
          >
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
        ref={scrollRef}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          jumpingTo.current = null;
        }}
        scrollEventThrottle={32}
        // Child 1 is the search + chips header (child 0 is the tab block).
        stickyHeaderIndices={[1]}
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: FOOTER + space.l,
          gap: space.sm,
        }}
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
              <Card
                style={{
                  padding: space.m,
                  backgroundColor: colors.amb,
                  borderColor: colors.ambline,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.body600,
                    fontSize: 13,
                    lineHeight: 19,
                    color: colors.ambtext,
                  }}
                >
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

        <View
          // The spacing is the page's from before the header stuck: 8 + the
          // field's own 12 above the search, 12 to the chips, 12 to the list
          // (the bottom 12 is the header's, so items scroll under it).
          style={{ paddingBottom: space.sm, backgroundColor: colors.bg }}
          onLayout={(e) => {
            headerH.current = e.nativeEvent.layout.height;
          }}
        >
          <View style={{ marginTop: space.s }}>
            <Field
              {...searchField}
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
              ref={chipsRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: space.sm }}
              contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}
              keyboardShouldPersistTaps="handled"
              onLayout={(e) => {
                chipsW.current = e.nativeEvent.layout.width;
              }}
            >
              {categories.map((c) => chip(c.id, localName(c, locale)))}
            </ScrollView>
          ) : null}
        </View>
        <View
          testID="staff-order-menu.list"
          // The scroll's gap would double the header's own bottom 12.
          style={{ marginTop: -space.sm }}
          onLayout={(e) => {
            listY.current = e.nativeEvent.layout.y;
          }}
        >
          {menuBody()}
        </View>
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
          onPress={() =>
            router.push({ pathname: '/staff-order-review', params: { table: tableId } })
          }
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
