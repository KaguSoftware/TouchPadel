import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Card, Field, Hint, MicroLabel, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { ChevronIcon } from '../../src/components/icons';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../../src/features/staff/keys';
import { mapStaffError } from '../../src/features/staff/edge';
import { fetchRecipeView } from '../../src/features/staff/recipes/api';
import {
  RECIPE_ROLES,
  asksRecipeChanges,
  filterPrepared,
  filterRecipeItems,
  readsRecipeChanges,
  type RecipeLine,
} from '../../src/features/staff/recipes/logic';
import { localName } from '../../src/features/staff/checklists/logic';
import { Lead } from '../../src/features/staff/checklists/parts';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { searchField } from '../../src/components/fieldKeyboard';

/**
 * Recipes by name (build-contracts-2026-09-23 §2.24.6, §6.1; plan #72): what
 * goes into each cafe item, size by size, and into each item made in the
 * kitchen. NAMES ONLY, for every reader: no amount, no unit, no cost (the
 * parked default of §0 P3). The head barista and the head chef get "Ask for a
 * change", which opens a request to the owner (staff-recipe-change); the
 * manager and the owner reach the requests from here too.
 *
 * `?itemId=` opens that item.
 */

type OpenRow = { kind: 'item' | 'prepared'; id: string } | null;

const EASE_MS = 240;

/** The ingredients of one recipe as pills, or the "no lines" note. */
function LinePills({ names, empty }: { names: readonly string[]; empty: string }) {
  const { colors, fonts } = useTheme();
  if (names.length === 0) {
    return <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>{empty}</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {names.map((n, i) => (
        <View
          key={`${i}:${n}`}
          style={{
            paddingStart: 10,
            paddingEnd: 10,
            paddingVertical: 5,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.line2,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.ink }}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One recipe in the list: an initial tile, the name and its category, and a
 * chevron that turns as the ingredients slide open beneath. Under Reduce
 * Motion it opens at once.
 */
function RecipeRow({
  testID,
  name,
  sub,
  open,
  last,
  onToggle,
  children,
}: {
  testID: string;
  name: string;
  sub: string | null;
  open: boolean;
  last: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  const { dir } = useLocale();
  const reduceMotion = useReduceMotion();
  // One value drives the chevron, the body's height and its fade, so a row
  // closing and another opening run as one motion instead of a jump.
  const [progress] = useState(() => new Animated.Value(open ? 1 : 0));
  const [bodyHeight, setBodyHeight] = useState(0);
  // The body stays mounted while it collapses, and leaves once it has.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const to = open ? 1 : 0;
    if (reduceMotion) {
      progress.setValue(to);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: to,
      duration: EASE_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    });
    run.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => run.stop();
  }, [open, reduceMotion, progress]);

  // The chevron points along the reading direction, and down when open.
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', dir === 'rtl' ? '-90deg' : '90deg'] });
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '·';

  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.sub, backgroundColor: colors.card }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingStart: space.m,
          paddingEnd: space.m,
          paddingVertical: space.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.cell,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: open ? colors.blue : colors.tint,
          }}
        >
          <Text style={{ fontFamily: fonts.display700, fontSize: 17, color: open ? colors.card : colors.blue }}>{initial}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.ink }} numberOfLines={2}>
            {name}
          </Text>
          {sub ? (
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.sub,
          }}
        >
          <Animated.View style={{ transform: [{ rotate }] }}>
            <ChevronIcon size={13} color={colors.mut} />
          </Animated.View>
        </View>
      </Pressable>
      {(reduceMotion ? open : mounted) ? (
        <Animated.View
          style={{
            height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, bodyHeight] }),
            opacity: progress,
            overflow: 'hidden',
          }}
        >
          {/* Laid out at its natural height whatever the clip, so it can be measured. */}
          <View
            onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}
            style={{
              position: 'absolute',
              top: 0,
              start: 0,
              end: 0,
              paddingStart: space.m,
              paddingEnd: space.m,
              paddingBottom: space.m,
            }}
          >
            {/* The ingredients sit in a panel of their own, apart from the row. */}
            <View
              style={{
                padding: space.sm,
                gap: space.sm,
                borderRadius: radius.cell,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.bg,
              }}
            >
              {children}
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function RecipesScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ itemId?: string }>();
  const role = status.kind === 'staff' ? status.staff.role : 'barista';
  const venue = venueId ?? '';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<OpenRow>(params.itemId ? { kind: 'item', id: params.itemId } : null);

  const view = useQuery({
    queryKey: staffKeys.recipes(venue, 'all'),
    queryFn: () => fetchRecipeView(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => view.refetch());

  const items = (() => {
    const all = filterRecipeItems(view.data?.items ?? [], query);
    const first = params.itemId ? all.filter((i) => i.menu_item_id === params.itemId) : [];
    return [...first, ...all.filter((i) => i.menu_item_id !== params.itemId)];
  })();
  const prepared = filterPrepared(view.data?.prepared ?? [], query);

  const toggle = (row: NonNullable<OpenRow>) => {
    setOpen((o) => (o && o.kind === row.kind && o.id === row.id ? null : row));
  };
  const isOpen = (kind: 'item' | 'prepared', id: string) => open?.kind === kind && open.id === id;

  // Ask about the open recipe when there is exactly one to ask about.
  const askChange = () => {
    if (open?.kind === 'prepared') {
      router.push({ pathname: '/staff-recipe-change', params: { target: 'output', targetId: open.id } });
      return;
    }
    const item = open ? view.data?.items.find((i) => i.menu_item_id === open.id) : undefined;
    const only = item && item.sizes.length === 1 ? item.sizes[0] : undefined;
    if (only) {
      router.push({ pathname: '/staff-recipe-change', params: { target: 'variant', targetId: only.variant_id } });
      return;
    }
    router.push('/staff-recipe-change');
  };

  const names = (lines: RecipeLine[]) => lines.map((l) => localName(l, locale));
  const noLines = t('staff.checklists.recipes.noLines');

  const lists = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (view.isPending) return <SkeletonList rows={4} height={52} />;
    if (view.isError) {
      return (
        <ErrorState
          testID="staff-recipes.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(view.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void view.refetch()}
        />
      );
    }
    if ((view.data?.items.length ?? 0) + (view.data?.prepared.length ?? 0) === 0) {
      return (
        <EmptyState
          testID="staff-recipes.empty"
          title={t('staff.checklists.recipes.emptyTitle')}
          message={t('staff.checklists.recipes.emptyBody')}
        />
      );
    }
    if (items.length + prepared.length === 0) return <Hint>{t('staff.checklists.recipes.noMatch')}</Hint>;
    return (
      <>
        {items.length > 0 ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {items.map((item, i) => (
              <RecipeRow
                key={item.menu_item_id}
                testID={`staff-recipes.item.${item.menu_item_id}`}
                name={localName(item, locale)}
                sub={localName({ name_en: item.category_name_en, name_ar: item.category_name_ar }, locale)}
                open={isOpen('item', item.menu_item_id)}
                last={i === items.length - 1}
                onToggle={() => toggle({ kind: 'item', id: item.menu_item_id })}
              >
                {item.sizes.map((size) => (
                  <View key={size.variant_id} style={{ gap: 6 }}>
                    {item.sizes.length > 1 ? (
                      <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut2 }}>{localName(size, locale)}</Text>
                    ) : null}
                    <LinePills names={names(size.lines)} empty={noLines} />
                  </View>
                ))}
              </RecipeRow>
            ))}
          </Card>
        ) : null}
        {prepared.length > 0 ? (
          <>
            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
              {t('staff.checklists.recipes.preparedTitle')}
            </MicroLabel>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {prepared.map((p, i) => (
                <RecipeRow
                  key={p.ingredient_id}
                  testID={`staff-recipes.prepared.${p.ingredient_id}`}
                  name={localName(p, locale)}
                  sub={null}
                  open={isOpen('prepared', p.ingredient_id)}
                  last={i === prepared.length - 1}
                  onToggle={() => toggle({ kind: 'prepared', id: p.ingredient_id })}
                >
                  <LinePills names={names(p.lines)} empty={noLines} />
                </RecipeRow>
              ))}
            </Card>
          </>
        ) : null}
      </>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.recipes.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.checklists.recipes.lead')}</Lead>
        {asksRecipeChanges(role) ? (
          <View>
            <Button
              testID="staff-recipes.ask-change"
              label={t('staff.checklists.recipes.askChange')}
              variant="primary"
              onPress={askChange}
              disabled={venue === ''}
            />
            <Hint>{t('staff.checklists.recipes.askChangeHint')}</Hint>
          </View>
        ) : null}
        {readsRecipeChanges(role) ? (
          <Button
            testID="staff-recipes.changes"
            label={t('staff.checklists.recipes.changes')}
            variant="secondary"
            size="medium"
            onPress={() => router.push('/staff-recipe-change')}
          />
        ) : null}
        <Field
          {...searchField}
          testID="staff-recipes.search"
          label={t('staff.checklists.recipes.search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          dense
        />
        <View testID="staff-recipes.list" style={{ gap: space.xs }}>
          <MicroLabel style={{ paddingStart: 4 }}>{t('staff.checklists.recipes.listTitle')}</MicroLabel>
          {lists()}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function StaffRecipesRoute() {
  return (
    <RequireStaff roles={RECIPE_ROLES}>
      <RecipesScreen />
    </RequireStaff>
  );
}
