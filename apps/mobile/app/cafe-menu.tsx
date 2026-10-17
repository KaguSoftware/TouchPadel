import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIQD } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { CupIcon } from '../src/components/icons';
import { BranchPicker } from '../src/features/availability/BranchPicker';
import { useGuestVenue } from '../src/features/availability/hooks';
import { useCafeMenu } from '../src/features/cafe/hooks';
import { menuPhotoUrl, pickText, type MenuViewItem } from '../src/features/cafe/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';

const THUMB = 56;

/** The item's photo, or a cup on the green tint when it has none or it fails, so rows align. */
function Thumb({ path }: { path: string | null }) {
  const { colors } = useTheme();
  const url = menuPhotoUrl(path);
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={{
        width: THUMB,
        height: THUMB,
        borderRadius: radius.cell,
        overflow: 'hidden',
        backgroundColor: colors.gtint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url && !failed ? (
        <Image
          source={{ uri: url }}
          onError={() => setFailed(true)}
          style={{ width: THUMB, height: THUMB }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <CupIcon size={22} color={colors.gstrong} />
      )}
    </View>
  );
}

/**
 * The café menu, to look at (Majed, 2026-10-17): opened from the account page, it shows what the
 * café serves at the guest's branch, with photos, sizes and prices, and what is sold out today.
 * Nothing is ordered here, and the line at the top says where ordering happens: the QR on the
 * table, or the counter.
 *
 * The categories ride as chips that stick under the bar, as on the staff order menu
 * (`app/(staff)/staff-order-menu.tsx`): scrolling lights the category under them, a chip tap
 * scrolls to it. The menu is public and kept on disk (`features/cafe/keys.ts`), so it opens with
 * no signal; a pull reads it again.
 */
export default function CafeMenuScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const guest = useGuestVenue();
  const menu = useCafeMenu(guest.venueId);
  const pull = usePullRefresh(() => Promise.all([guest.query.refetch(), menu.refetch()]));
  const sections = useMemo(() => menu.data ?? [], [menu.data]);

  const [category, setCategory] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const chipsRef = useRef<ScrollView>(null);
  const headerH = useRef(0);
  const listY = useRef(0);
  const sectionY = useRef<Record<string, number>>({});
  const chipX = useRef<Record<string, { x: number; width: number }>>({});
  const chipsW = useRef(0);
  // A chip tap scrolls past the categories in between; they must not light up
  // until the scroll reaches the tapped one (or the guest takes over).
  const jumpingTo = useRef<string | null>(null);
  const active =
    category && sections.some((s) => s.id === category) ? category : (sections[0]?.id ?? null);

  useEffect(() => {
    const at = active ? chipX.current[active] : undefined;
    if (!at) return;
    chipsRef.current?.scrollTo({
      x: Math.max(0, at.x - (chipsW.current - at.width) / 2),
      animated: true,
    });
  }, [active]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 4;
    const line = contentOffset.y + headerH.current + space.m;
    let next = sections[0]?.id ?? null;
    for (const s of sections) {
      const y = sectionY.current[s.id];
      if (y !== undefined && listY.current + y <= line) next = s.id;
    }
    // The last category may be too short ever to reach the line.
    if (atBottom && sections.length > 0) next = sections[sections.length - 1]!.id;
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

  const price = (iqd: number) => formatIQD(iqd, locale);

  const itemRow = (item: MenuViewItem, last: boolean) => {
    const name = pickText(item.name_en, item.name_ar, locale);
    const hook = pickText(item.hook_en, item.hook_ar, locale);
    const single = item.sizes.length === 1 ? item.sizes[0]! : null;
    return (
      <View
        key={item.id}
        testID={`cafe-menu.item.${item.id}`}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.sm,
          paddingStart: space.sm,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: space.sm,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.sub,
        }}
      >
        <View style={{ opacity: item.available ? 1 : 0.5 }}>
          <Thumb path={item.photo_path} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3, paddingTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
            <Text
              style={{
                flex: 1,
                fontFamily: fonts.display800,
                fontSize: 15,
                lineHeight: 20,
                color: item.available ? colors.ink : colors.mut,
              }}
            >
              {name}
            </Text>
            {single ? (
              <Text
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 14,
                  lineHeight: 20,
                  color: item.available ? colors.ink : colors.mut,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {price(single.price_iqd)}
              </Text>
            ) : null}
          </View>
          {hook ? (
            <Text
              numberOfLines={2}
              style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 17, color: colors.mut }}
            >
              {hook}
            </Text>
          ) : null}
          {/* Several sizes: each with its own price, rather than one "from" figure. */}
          {single ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
              {item.sizes.map((s) => (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    gap: 6,
                    paddingStart: 9,
                    paddingEnd: 9,
                    paddingTop: 4,
                    paddingBottom: 4,
                    borderRadius: radius.pill,
                    backgroundColor: colors.sub,
                  }}
                >
                  <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
                    {pickText(s.name_en, s.name_ar, locale)}
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.body700,
                      fontSize: 12,
                      color: item.available ? colors.ink : colors.mut,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {price(s.price_iqd)}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {item.available ? null : (
            <View
              style={{
                alignSelf: 'flex-start',
                marginTop: 3,
                paddingStart: 8,
                paddingEnd: 8,
                paddingTop: 3,
                paddingBottom: 3,
                borderRadius: radius.pill,
                backgroundColor: colors.amb,
              }}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.ambtext }}>
                {t('cafe.soldOutCta')}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const chip = (id: string, label: string) => {
    const on = active === id;
    return (
      <Pressable
        key={id}
        testID={`cafe-menu.category.${id}`}
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
        <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: on ? colors.card : colors.ink }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const body = () => {
    if (guest.query.isError && !guest.venueId) {
      return (
        <ErrorState
          testID="cafe-menu.error"
          title={t('cafe.menuUnavailable.title')}
          message={t('cafe.menuUnavailable.body')}
          retryLabel={t('common.retry')}
          onRetry={() => void guest.query.refetch()}
          busy={guest.query.isRefetching}
        />
      );
    }
    if (menu.isError && !menu.data) {
      return (
        <ErrorState
          testID="cafe-menu.error"
          title={t('cafe.menuUnavailable.title')}
          message={t('cafe.menuUnavailable.body')}
          retryLabel={t('common.retry')}
          onRetry={() => void menu.refetch()}
          busy={menu.isRefetching}
        />
      );
    }
    if (!menu.data) return <SkeletonList rows={5} height={80} />;
    if (sections.length === 0) {
      return (
        <EmptyState
          testID="cafe-menu.empty"
          title={t('cafe.menuEmpty.title')}
          message={t('cafe.menuEmpty.body')}
        />
      );
    }
    return (
      <View style={{ gap: space.l }}>
        {sections.map((s) => (
          <View
            key={s.id}
            style={{ gap: space.s }}
            onLayout={(e) => {
              sectionY.current[s.id] = e.nativeEvent.layout.y;
            }}
          >
            <MicroLabel style={{ paddingStart: space.xs }}>{pickText(s.name_en, s.name_ar, locale)}</MicroLabel>
            <View
              style={{
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.card,
                overflow: 'hidden',
              }}
            >
              {s.items.map((i, n) => itemRow(i, n === s.items.length - 1))}
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.cafeMenu') }} />
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          jumpingTo.current = null;
        }}
        scrollEventThrottle={32}
        // Child 1 is the chips (child 0 is the note and the branch picker).
        stickyHeaderIndices={sections.length > 1 ? [1] : undefined}
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.blue} />
        }
      >
        <View style={{ gap: space.m, paddingBottom: space.sm }}>
          {/* What this page is not, said once, before anything else. */}
          <Text
            testID="cafe-menu.note"
            style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}
          >
            {t('cafe.viewOnlyNote')}
          </Text>
          {guest.showPicker ? <BranchPicker testID="cafe-menu.branch" /> : null}
        </View>

        {sections.length > 1 ? (
          <View
            style={{ paddingTop: space.xs, paddingBottom: space.sm, backgroundColor: colors.bg }}
            onLayout={(e) => {
              headerH.current = e.nativeEvent.layout.height;
            }}
          >
            <ScrollView
              ref={chipsRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}
              onLayout={(e) => {
                chipsW.current = e.nativeEvent.layout.width;
              }}
            >
              {sections.map((s) => chip(s.id, pickText(s.name_en, s.name_ar, locale)))}
            </ScrollView>
          </View>
        ) : null}

        <View
          testID="cafe-menu.list"
          style={{ marginTop: space.xs }}
          onLayout={(e) => {
            listY.current = e.nativeEvent.layout.y;
          }}
        >
          {body()}
        </View>
      </ScrollView>
    </Screen>
  );
}
