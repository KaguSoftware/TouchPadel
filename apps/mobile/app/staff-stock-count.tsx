import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatDateTime, formatTime, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Hint,
  LinkText,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { localName } from '../src/features/staff/checklists/logic';
import { GroupLabel, Lead, Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  fetchStockPick,
  fetchStockToday,
  refreshStoreReads,
  submitCount,
} from '../src/features/staff/stores/api';
import {
  COUNT_ROLES,
  countArgs,
  countStoresFor,
  defaultCountStore,
  filterPick,
  firstOf,
  isCapped,
  storeIntent,
  storeRefusal,
  typedEntries,
  unitChoices,
  validateCount,
  waitingCount,
  type CountArgs,
  type CountEntry,
  type LineIssue,
  type StockLocation,
} from '../src/features/staff/stores/logic';
import { Notice, UnitToggle, useQtyText } from '../src/features/staff/stores/parts';

/**
 * Count the bakery (wave5-addendum-2026-09-25 §2.8.2 D7, §2.8.5, §5.3; Majed's
 * answer #5, "stock control: count whats there atm"). The head chef and the
 * chef count the bakery store; management may count either. The count is
 * BLIND: the sheet lists names and units only (stock_pick_list 'count'),
 * never what the system expects, so nobody types the number they were shown.
 *
 * Type what is on the shelf; an item left empty was not counted and is not
 * sent (0 is a count: an empty shelf). `submit_stock_count` saves it waiting
 * for a manager, who applies or discards it on the operator (§8 Q19); a count
 * of this store already waiting blocks the next, which the page says before
 * anyone types. Typed amounts are kept per store, so a manager switching
 * stores never carries the cafe's numbers into the bakery. The key is
 * `count:<store>`.
 */

const EMPTY_ENTRY: CountEntry = { qty: '', unit: 'base' };

/** Whether a moment falls on today's calendar day at the venue. */
function sameDay(iso: string): boolean {
  return formatDate(new Date(iso), 'en') === formatDate(new Date(), 'en');
}

function CountScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const role = status.kind === 'staff' ? status.staff.role : null;
  const venue = venueId ?? '';
  const qtyText = useQtyText();

  const stores = role ? countStoresFor(role) : [];
  const [chosen, setChosen] = useState<StockLocation | null>(null);
  const store: StockLocation | null =
    chosen && stores.includes(chosen) ? chosen : role ? defaultCountStore(role) : null;

  const pick = useQuery({
    queryKey: staffKeys.stockPick(venue, 'count', store ?? 'bakery'),
    queryFn: () => fetchStockPick(venue, 'count', store ?? 'bakery'),
    enabled: venue !== '' && store !== null,
  });
  const today = useQuery({
    queryKey: staffKeys.stockToday(venue),
    queryFn: () => fetchStockToday(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => Promise.all([pick.refetch(), today.refetch()]));

  const [entries, setEntries] = useState<Record<StockLocation, Record<string, CountEntry>>>({
    cafe: {},
    bakery: {},
  });
  const [search, setSearch] = useState('');
  const [issues, setIssues] = useState<LineIssue[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const send = useMutation({
    mutationKey: staffKeys.mutation('stock_count'),
    mutationFn: ({ args, intent }: { args: CountArgs; intent: string }) =>
      submitCount(args, staffIntentKey(intent, 'stock_count')),
    onSuccess: (_data, { args, intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.stores.count.done'), 'success');
      setEntries((all) => ({ ...all, [args.p_location]: {} }));
      setIssues([]);
      setFormError(null);
      refreshStoreReads(queryClient, venue);
    },
    onError: (err) => {
      const refusal = storeRefusal(err);
      setFormError(t(refusal.key));
      if (refusal.issue) setIssues((all) => [...all, refusal.issue!]);
      // A count sent meanwhile, or an item gone: read both again.
      void today.refetch();
      if (refusal.issue) void pick.refetch();
    },
  });

  if (!role || !store) return null;

  const items = pick.data?.items ?? [];
  const sheet = entries[store];
  const shown = filterPick(items, search);
  const typed = typedEntries(items, sheet).length;
  const waiting = waitingCount(today.data, store);

  const setEntry = (id: string, patch: Partial<CountEntry>) => {
    setEntries((all) => ({
      ...all,
      [store]: { ...all[store], [id]: { ...(all[store][id] ?? EMPTY_ENTRY), ...patch } },
    }));
    setFormError(null);
    setIssues((all) => all.filter((i) => i.line !== id && i.line !== undefined));
  };

  const onSubmit = () => {
    setFormError(null);
    const found = validateCount(items, sheet);
    setIssues(found);
    if (found.length > 0 || venue === '') return;
    const args = countArgs(items, sheet, store, venue);
    send.mutate({ args, intent: storeIntent('count', store, args) });
  };

  const rowError = (id: string): string | null => {
    const issue = issues.find((i) => i.line === id);
    if (!issue) return null;
    return t(issue.code === 'gone' ? 'staff.stores.errors.gone' : 'staff.stores.errors.countQty');
  };
  const listIssue = issues.find((i) => i.line === undefined);
  const listError = listIssue
    ? t(
        listIssue.code === 'tooMany'
          ? 'staff.stores.errors.tooMany'
          : 'staff.stores.errors.countNone',
      )
    : null;

  const theSheet = () => {
    if (venue === '') return null;
    if (pick.isPending) return <SkeletonList rows={4} height={56} />;
    if (pick.isError) {
      return (
        <ErrorState
          testID="staff-stock-count.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(pick.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void pick.refetch()}
        />
      );
    }
    if (items.length === 0) {
      return (
        <EmptyState
          testID="staff-stock-count.empty"
          title={t('staff.stores.count.emptyTitle')}
          message={t('staff.stores.count.emptyBody')}
        />
      );
    }
    return (
      <>
        <Field
          testID="staff-stock-count.find"
          label={t('staff.stores.find')}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          dense
        />
        {isCapped(pick.data) ? <Hint>{t('staff.stores.capped')}</Hint> : null}
        {shown.length === 0 ? (
          <Hint>{t('staff.stores.noMatch')}</Hint>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: space.s }}>
            {shown.map((item, i) => {
              const id = item.ingredient_id;
              const entry = sheet[id] ?? EMPTY_ENTRY;
              const error = rowError(id);
              const name = localName(item, locale);
              return (
                <View
                  key={id}
                  testID={`staff-stock-count.row.${id}`}
                  style={{
                    paddingStart: space.m,
                    paddingEnd: space.m,
                    paddingTop: space.s,
                    paddingBottom: space.sm,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.sub,
                    backgroundColor: entry.qty.trim() !== '' ? colors.tint : colors.card,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                        {name}
                      </Text>
                      {unitChoices(item).length > 1 ? (
                        <View style={{ alignSelf: 'flex-start' }}>
                          <UnitToggle
                            testID={`staff-stock-count.unit.${id}`}
                            item={item}
                            value={entry.unit}
                            onChange={(unit) => setEntry(id, { unit })}
                          />
                        </View>
                      ) : (
                        <Text
                          style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}
                        >
                          {t(`staff.supplies.units.many.${item.unit}`)}
                        </Text>
                      )}
                    </View>
                    {/* Field carries its own top margin for a form; a sheet row centres it instead. */}
                    <View style={{ width: 112, marginTop: -space.sm }}>
                      <Field
                        testID={`staff-stock-count.item.${id}`}
                        value={entry.qty}
                        onChangeText={(qty) => setEntry(id, { qty })}
                        keyboardType="decimal-pad"
                        latin
                        dense
                        accessibilityLabel={name}
                      />
                    </View>
                  </View>
                  <ErrorText>{error}</ErrorText>
                </View>
              );
            })}
          </Card>
        )}
      </>
    );
  };

  const recent = firstOf(today.data?.counts);

  const recentCounts = () => {
    if (venue === '') return null;
    if (today.isPending) return <SkeletonList rows={2} height={56} />;
    if (today.isError) {
      return (
        <ErrorState
          testID="staff-stock-count.recent-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(today.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void today.refetch()}
        />
      );
    }
    if (recent.shown.length === 0)
      return <Hint style={{ paddingStart: 4 }}>{t('staff.stores.count.recentEmpty')}</Hint>;
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {recent.shown.map((c, i) => {
          const open = opened === c.count_id;
          return (
            <View
              key={c.count_id}
              style={{
                paddingStart: space.m,
                paddingEnd: space.m,
                paddingTop: space.sm,
                paddingBottom: space.sm,
                gap: 4,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.sub,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space.s,
                }}
              >
                <Text
                  style={{
                    flexShrink: 1,
                    fontFamily: fonts.body700,
                    fontSize: 13.5,
                    color: colors.ink,
                  }}
                >
                  {t(`work.store.${c.location}`)}
                </Text>
                <Tag
                  tone={c.status === 'waiting' ? 'warn' : 'good'}
                  label={t(`staff.stores.count.status.${c.status}`)}
                />
              </View>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut2 }}>
                {t('staff.stores.count.items', { count: c.lines.length })}
              </Text>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                {t('staff.stores.count.sentBy', {
                  name: isolate(c.counted_by_name ?? ''),
                  when: formatDateTime(new Date(c.submitted_at), locale),
                })}
              </Text>
              <LinkText
                testID={`staff-stock-count.recent.${c.count_id}`}
                label={t(open ? 'staff.stores.count.hide' : 'staff.stores.count.show')}
                onPress={() => setOpened(open ? null : c.count_id)}
              />
              {open
                ? c.lines.map((l) => (
                    <Text
                      key={l.ingredient_id}
                      style={{
                        fontFamily: fonts.body400,
                        fontSize: 13,
                        lineHeight: 19,
                        color: colors.mut2,
                      }}
                    >
                      {`${localName(l, locale)} · ${qtyText(l.counted_qty, l.unit)}`}
                    </Text>
                  ))
                : null}
            </View>
          );
        })}
        {recent.more > 0 ? (
          <Hint style={{ paddingStart: space.m, paddingBottom: space.sm }}>
            {t('staff.stores.more', { count: recent.more })}
          </Hint>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t(`staff.stores.count.title.${store}`) }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.stores.count.lead')}</Lead>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {waiting ? (
          <Notice testID="staff-stock-count.waiting">
            {t('staff.stores.count.waiting', {
              name: isolate(waiting.counted_by_name ?? ''),
              // The time alone for today's count; the day too for an older one.
              time: sameDay(waiting.submitted_at)
                ? formatTime(new Date(waiting.submitted_at), locale)
                : formatDateTime(new Date(waiting.submitted_at), locale),
            })}
          </Notice>
        ) : null}

        {stores.length > 1 ? (
          <View>
            <GroupLabel>{t('staff.stores.count.store')}</GroupLabel>
            <View style={{ marginTop: space.s }}>
              <SegmentedControl<StockLocation>
                testID="staff-stock-count.store"
                options={stores.map((s) => ({ value: s, label: t(`work.store.${s}`) }))}
                value={store}
                onChange={(next) => {
                  setChosen(next);
                  setSearch('');
                  setIssues([]);
                  setFormError(null);
                }}
              />
            </View>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingStart: 4,
            paddingEnd: 4,
            marginTop: space.xs,
          }}
        >
          <MicroLabel>{t('staff.stores.count.sheetTitle')}</MicroLabel>
          {items.length > 0 ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
              {t('staff.stores.count.counted', { count: typed, total: items.length })}
            </Text>
          ) : null}
        </View>
        {theSheet()}

        <ErrorText>{listError ?? formError}</ErrorText>
        <Button
          testID="staff-stock-count.submit"
          label={t('staff.stores.count.submit')}
          variant="primary"
          busy={send.isPending}
          disabled={waiting !== null}
          onPress={onSubmit}
          style={{ marginTop: space.xs }}
        />
        {/* The reason sits by the button it holds, not only at the top of a long sheet. */}
        {waiting ? <Hint>{t('staff.stores.count.held')}</Hint> : null}

        <MicroLabel style={{ paddingStart: 4, marginTop: space.l }}>
          {t('staff.stores.count.recentTitle')}
        </MicroLabel>
        {recentCounts()}
      </ScrollView>
    </Screen>
  );
}

export default function StaffStockCountRoute() {
  return (
    <RequireStaff roles={COUNT_ROLES}>
      <CountScreen />
    </RequireStaff>
  );
}
