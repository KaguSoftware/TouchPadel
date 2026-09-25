import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, Field, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ChevronIcon } from '../src/components/icons';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { fetchRecipeView } from '../src/features/staff/recipes/api';
import {
  RECIPE_ROLES,
  asksRecipeChanges,
  filterPrepared,
  filterRecipeItems,
  readsRecipeChanges,
  type RecipeLine,
} from '../src/features/staff/recipes/logic';
import { localName } from '../src/features/staff/checklists/logic';
import { Lead } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';

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

function RecipesScreen() {
  const { t, locale, dir } = useLocale();
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

  const toggle = (row: NonNullable<OpenRow>) =>
    setOpen((o) => (o && o.kind === row.kind && o.id === row.id ? null : row));
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

  const names = (lines: RecipeLine[]) =>
    lines.length === 0 ? t('staff.checklists.recipes.noLines') : lines.map((l) => localName(l, locale)).join(locale === 'ar' ? '، ' : ', ');

  const header = (label: string, sub: string | null, openNow: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{sub}</Text> : null}
      </View>
      {/* The chevron points along the reading direction, and down when open. */}
      <View style={{ transform: [{ rotate: openNow ? (dir === 'rtl' ? '-90deg' : '90deg') : '0deg' }] }}>
        <ChevronIcon size={14} color={colors.fnt} />
      </View>
    </View>
  );

  const rowStyle = (last: boolean) => ({
    paddingStart: space.m,
    paddingEnd: space.m,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: colors.sub,
  });

  const lineText = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 };

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
            {items.map((item, i) => {
              const openNow = isOpen('item', item.menu_item_id);
              return (
                <View key={item.menu_item_id} style={rowStyle(i === items.length - 1)}>
                  <Pressable
                    testID={`staff-recipes.item.${item.menu_item_id}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: openNow }}
                    onPress={() => toggle({ kind: 'item', id: item.menu_item_id })}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    {header(
                      localName(item, locale),
                      localName({ name_en: item.category_name_en, name_ar: item.category_name_ar }, locale),
                      openNow,
                    )}
                  </Pressable>
                  {openNow ? (
                    <View style={{ marginTop: space.s, gap: space.s }}>
                      {item.sizes.map((size) => (
                        <View key={size.variant_id} style={{ gap: 2 }}>
                          {item.sizes.length > 1 ? (
                            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
                              {localName(size, locale)}
                            </Text>
                          ) : null}
                          <Text style={lineText}>{names(size.lines)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Card>
        ) : null}
        {prepared.length > 0 ? (
          <>
            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
              {t('staff.checklists.recipes.preparedTitle')}
            </MicroLabel>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {prepared.map((p, i) => {
                const openNow = isOpen('prepared', p.ingredient_id);
                return (
                  <View key={p.ingredient_id} style={rowStyle(i === prepared.length - 1)}>
                    <Pressable
                      testID={`staff-recipes.prepared.${p.ingredient_id}`}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: openNow }}
                      onPress={() => toggle({ kind: 'prepared', id: p.ingredient_id })}
                      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                    >
                      {header(localName(p, locale), null, openNow)}
                    </Pressable>
                    {openNow ? <Text style={[lineText, { marginTop: space.s }]}>{names(p.lines)}</Text> : null}
                  </View>
                );
              })}
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
