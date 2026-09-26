import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localIsoDate } from '@touch/core';
import { formatTime, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Hint,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
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
  logStock,
  refreshStoreReads,
} from '../src/features/staff/stores/api';
import {
  LOG_ROLES,
  defaultLogStore,
  firstOf,
  fixes,
  logArgs,
  logKindsFor,
  logStoresFor,
  newLine,
  storeIntent,
  storeRefusal,
  validateLog,
  type LineDraft,
  type LineIssue,
  type LogArgs,
  type PickItem,
  type StockLocation,
} from '../src/features/staff/stores/logic';
import {
  ItemFinder,
  LineEditor,
  Notice,
  useQtyText,
  type LineErrors,
} from '../src/features/staff/stores/parts';

/**
 * Add to stock (wave5-addendum-2026-09-25 §2.8.5, §5.3; Majed's answer #5,
 * "log stock: add stuff to stock"). The head barista, the head chef, the
 * cashier, the court desk and management say what arrived and which store it
 * went into; `log_stock` books it as one staff delivery. Nobody here sees or
 * types a cost: the server estimates it and a manager corrects it on the
 * operator ("Added by staff").
 *
 * The store: each role's home store first (the bakery for the head chef, the
 * cafe for everyone else), the other one a tap away. Shop stock goes into the
 * cafe only (V14), so the desk, which logs nothing else, gets no picker, and a
 * shop line is refused at the bakery before it is sent. Prepared stock is never
 * offered: it comes from production.
 *
 * Driver purchases the manager has not taken in yet are named at the top, so
 * nobody adds them a second time (§8 Q24). The key is `log:<store>`, kept
 * through retries and cleared once the delivery is booked.
 */

function LogScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const role = status.kind === 'staff' ? status.staff.role : null;
  const venue = venueId ?? '';
  const qtyText = useQtyText();

  const stores = role ? logStoresFor(role) : [];
  const [chosen, setChosen] = useState<StockLocation | null>(null);
  const store: StockLocation | null =
    chosen && stores.includes(chosen) ? chosen : role ? defaultLogStore(role) : null;

  const pick = useQuery({
    queryKey: staffKeys.stockPick(venue, 'log', store ?? 'cafe'),
    queryFn: () => fetchStockPick(venue, 'log', store ?? 'cafe'),
    enabled: venue !== '' && store !== null,
  });
  const today = useQuery({
    queryKey: staffKeys.stockToday(venue),
    queryFn: () => fetchStockToday(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => Promise.all([pick.refetch(), today.refetch()]));

  const [lines, setLines] = useState<LineDraft[]>([]);
  const [search, setSearch] = useState('');
  const [issues, setIssues] = useState<LineIssue[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const taken = useMemo(() => new Set(lines.map((l) => l.item.ingredient_id)), [lines]);
  const example = localIsoDate(new Date());

  const addLine = (item: PickItem) => {
    setLines((all) => [...all, newLine(item)]);
    setSearch('');
    setFormError(null);
    setIssues((all) => all.filter((i) => i.field !== 'lines'));
  };
  const editLine = (id: string, patch: Partial<LineDraft>) => {
    setLines((all) => all.map((l) => (l.item.ingredient_id === id ? { ...l, ...patch } : l)));
    setFormError(null);
    // The field being fixed stops showing its error.
    setIssues((all) => all.filter((i) => !fixes(i, id, patch)));
  };
  const removeLine = (id: string) => {
    setLines((all) => all.filter((l) => l.item.ingredient_id !== id));
    setIssues((all) => all.filter((i) => i.line !== id));
    setFormError(null);
  };

  const save = useMutation({
    mutationKey: staffKeys.mutation('stock_log'),
    mutationFn: ({ args, intent }: { args: LogArgs; intent: string }) =>
      logStock(args, staffIntentKey(intent, 'stock_log')),
    onSuccess: (_data, { args, intent }) => {
      clearStaffIntentKey(intent);
      toast(t(`staff.stores.log.done.${args.p_location}`), 'success');
      setLines([]);
      setIssues([]);
      setFormError(null);
      refreshStoreReads(queryClient, venue);
    },
    onError: (err) => {
      const refusal = storeRefusal(err);
      setFormError(t(refusal.key));
      if (refusal.issue) setIssues((all) => [...all, refusal.issue!]);
      if (refusal.issue?.code === 'gone') void pick.refetch();
    },
  });

  if (!role || !store) return null;

  const onSave = () => {
    setFormError(null);
    const found = validateLog(lines, store, role, localIsoDate(new Date()));
    setIssues(found);
    if (found.length > 0 || venue === '') return;
    const args = logArgs(lines, store, venue);
    save.mutate({ args, intent: storeIntent('log', store, args) });
  };

  const lineErrors = (id: string): LineErrors => {
    const out: LineErrors = {};
    for (const issue of issues.filter((i) => i.line === id)) {
      if (issue.field === 'kind') out.kind = t('staff.stores.errors.cafeOnly');
      else if (issue.field === 'expiry') {
        out.expiry =
          issue.code === 'past'
            ? t('staff.stores.errors.expiryPast')
            : t('staff.stores.errors.expiry', { example: isolate(example) });
      } else if (issue.code === 'gone') out.qty = t('staff.stores.errors.gone');
      else out.qty = t('staff.stores.errors.qty');
    }
    // A shop line while the bakery is picked says so at once, not on Save.
    const line = lines.find((l) => l.item.ingredient_id === id);
    if (line && !logStoresFor(role, line.item.kind).includes(store))
      out.kind = t('staff.stores.errors.cafeOnly');
    return out;
  };
  const listIssue = issues.find((i) => i.line === undefined);
  const listError = listIssue
    ? t(listIssue.code === 'tooMany' ? 'staff.stores.errors.tooMany' : 'staff.stores.errors.lines')
    : null;

  const waiting = today.data?.driver_deliveries_waiting ?? 0;
  const added = firstOf(today.data?.logs);

  const addedToday = () => {
    if (venue === '') return null;
    if (today.isPending) return <SkeletonList rows={2} height={56} />;
    if (today.isError) {
      return (
        <ErrorState
          testID="staff-stock-log.today-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(today.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void today.refetch()}
        />
      );
    }
    if (added.shown.length === 0)
      return <Hint style={{ paddingStart: 4 }}>{t('staff.stores.log.todayEmpty')}</Hint>;
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {added.shown.map((d, i) => (
          <View
            key={d.delivery_id}
            testID={`staff-stock-log.today.${d.delivery_id}`}
            style={{
              paddingStart: space.m,
              paddingEnd: space.m,
              paddingTop: space.sm,
              paddingBottom: space.sm,
              gap: 3,
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
                {t(`work.store.${d.location}`)}
              </Text>
              {d.source === 'goods_in' ? <Tag label={t('staff.stores.log.goodsIn')} /> : null}
            </View>
            {d.lines.map((l) => (
              <Text
                key={l.ingredient_id}
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 13,
                  lineHeight: 19,
                  color: colors.mut2,
                }}
              >
                {`${localName(l, locale)} · ${qtyText(l.qty, l.unit)}`}
              </Text>
            ))}
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
              {t('staff.stores.by', {
                name: isolate(d.received_by_name ?? ''),
                time: formatTime(new Date(d.received_at), locale),
              })}
            </Text>
          </View>
        ))}
        {added.more > 0 ? (
          <Hint style={{ paddingStart: space.m, paddingBottom: space.sm }}>
            {t('staff.stores.more', { count: added.more })}
          </Hint>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.stores.log.title') }} />
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
        <Lead>
          {t(role === 'court_desk' ? 'staff.stores.log.leadShop' : 'staff.stores.log.lead')}
        </Lead>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {waiting > 0 ? (
          <Notice testID="staff-stock-log.driver-waiting">
            {t('staff.stores.log.driverWaiting', { count: waiting })}
          </Notice>
        ) : null}

        <Card style={{ padding: space.m, gap: space.s }}>
          {stores.length > 1 ? (
            <>
              <GroupLabel>{t('staff.stores.log.store')}</GroupLabel>
              <SegmentedControl<StockLocation>
                testID="staff-stock-log.store"
                options={stores.map((s) => ({ value: s, label: t(`work.store.${s}`) }))}
                value={store}
                onChange={(next) => {
                  setChosen(next);
                  setFormError(null);
                  setIssues((all) => all.filter((i) => i.field !== 'kind'));
                }}
              />
            </>
          ) : null}

          <ItemFinder
            testID="staff-stock-log"
            list={pick.data}
            loading={venue !== '' && pick.isPending}
            error={pick.isError ? pick.error : null}
            onRetry={() => void pick.refetch()}
            query={search}
            onQuery={setSearch}
            taken={taken}
            onPick={addLine}
            showKind={logKindsFor(role).length > 1}
            emptyTitle={t('staff.stores.log.emptyTitle')}
            emptyBody={t('staff.stores.log.emptyBody')}
          />

          {lines.length > 0 ? (
            <View style={{ gap: space.sm, marginTop: space.s }}>
              <MicroLabel>{t('staff.stores.log.linesTitle', { count: lines.length })}</MicroLabel>
              {lines.map((line, i) => (
                <View
                  key={line.item.ingredient_id}
                  testID={`staff-stock-log.line.${line.item.ingredient_id}`}
                  style={{
                    paddingTop: i === 0 ? 0 : space.sm,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.sub,
                  }}
                >
                  <LineEditor
                    testID="staff-stock-log"
                    line={line}
                    onChange={(patch) => editLine(line.item.ingredient_id, patch)}
                    onRemove={() => removeLine(line.item.ingredient_id)}
                    errors={lineErrors(line.item.ingredient_id)}
                    expiry={{ example: isolate(example) }}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Hint style={{ marginTop: space.xs }}>{t('staff.stores.log.noLines')}</Hint>
          )}

          <ErrorText>{listError ?? formError}</ErrorText>
          <Button
            testID="staff-stock-log.save"
            label={t(`staff.stores.log.save.${store}`)}
            variant="primary"
            busy={save.isPending}
            onPress={onSave}
            style={{ marginTop: space.xs }}
          />
        </Card>

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {t('staff.stores.log.todayTitle')}
        </MicroLabel>
        {addedToday()}
      </ScrollView>
    </Screen>
  );
}

export default function StaffStockLogRoute() {
  return (
    <RequireStaff roles={LOG_ROLES}>
      <LogScreen />
    </RequireStaff>
  );
}
