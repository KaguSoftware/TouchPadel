import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Hint, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { localName } from '../src/features/staff/checklists/logic';
import { Lead } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  fetchStockPick,
  fetchStockToday,
  moveStock,
  refreshStoreReads,
} from '../src/features/staff/stores/api';
import {
  MOVE_ROLES,
  firstOf,
  fixes,
  moveArgs,
  newLine,
  onHandMap,
  otherStore,
  storeIntent,
  storeRefusal,
  validateMove,
  type LineDraft,
  type LineIssue,
  type MoveArgs,
  type PickItem,
  type StockLocation,
} from '../src/features/staff/stores/logic';
import {
  ItemFinder,
  LineEditor,
  useQtyText,
  type LineErrors,
} from '../src/features/staff/stores/parts';

/**
 * Move stock (wave5-addendum-2026-09-25 §2.8.2 D6, §2.8.5, §5.3; Majed's
 * answer #8: "he is the one that moves stuff from the storage units"). The
 * waiter, the manager and the owner move bought-in and made-here stock between
 * the cafe store and the bakery store; `transfer_stock` splits the source's
 * batches into the destination, so the venue's stock and its value never
 * change. Shop stock stays in the cafe and is never offered.
 *
 * From the cafe by default (deliveries arrive there first), Swap for the way
 * back. Each item shows what the source store holds, and a line larger than
 * that is refused here, before the round trip, with the figure; the server
 * refuses the same (TRANSFER_SHORT, with what it shows), and the refusal lands
 * on the line. The key is `move:<from>`.
 */

function MoveScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const qtyText = useQtyText();

  const [from, setFrom] = useState<StockLocation>('cafe');
  const to = otherStore(from);

  const pick = useQuery({
    queryKey: staffKeys.stockPick(venue, 'move', from),
    queryFn: () => fetchStockPick(venue, 'move', from),
    enabled: venue !== '',
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
  const onHand = useMemo(() => onHandMap(pick.data), [pick.data]);

  const addLine = (item: PickItem) => {
    setLines((all) => [...all, newLine(item)]);
    setSearch('');
    setFormError(null);
    setIssues((all) => all.filter((i) => i.field !== 'lines'));
  };
  const editLine = (id: string, patch: Partial<LineDraft>) => {
    setLines((all) => all.map((l) => (l.item.ingredient_id === id ? { ...l, ...patch } : l)));
    setFormError(null);
    setIssues((all) => all.filter((i) => !fixes(i, id, patch)));
  };
  const removeLine = (id: string) => {
    setLines((all) => all.filter((l) => l.item.ingredient_id !== id));
    setIssues((all) => all.filter((i) => i.line !== id));
    setFormError(null);
  };
  const swap = () => {
    // The lines stay: the same flour goes back the other way. What the new
    // source holds is checked again on Move.
    setFrom(to);
    setIssues([]);
    setFormError(null);
  };

  const move = useMutation({
    mutationKey: staffKeys.mutation('stock_move'),
    mutationFn: ({ args, intent }: { args: MoveArgs; intent: string }) =>
      moveStock(args, staffIntentKey(intent, 'stock_move')),
    onSuccess: (_data, { args, intent }) => {
      clearStaffIntentKey(intent);
      toast(t(`staff.stores.move.done.${args.p_to}`), 'success');
      setLines([]);
      setIssues([]);
      setFormError(null);
      refreshStoreReads(queryClient, venue);
    },
    onError: (err) => {
      const refusal = storeRefusal(err);
      setFormError(t(refusal.key));
      if (refusal.issue) setIssues((all) => [...all, refusal.issue!]);
      // What the source holds has changed under the form: read it again.
      if (refusal.issue) void pick.refetch();
    },
  });

  const onMove = () => {
    setFormError(null);
    const found = validateMove(lines, onHand);
    setIssues(found);
    if (found.length > 0 || venue === '') return;
    const args = moveArgs(lines, from, venue);
    move.mutate({ args, intent: storeIntent('move', from, args) });
  };

  /** What the source holds of an item; an item it no longer lists holds none. Null while it loads. */
  const holds = (item: PickItem): string | null => {
    if (!onHand) return null;
    const qty = onHand.get(item.ingredient_id) ?? 0;
    return t(`staff.stores.holds.${from}`, { qty: qtyText(qty, item.unit) });
  };

  const lineErrors = (line: LineDraft): LineErrors => {
    const out: LineErrors = {};
    for (const issue of issues.filter((i) => i.line === line.item.ingredient_id)) {
      if (issue.code === 'short') {
        out.qty = t(`staff.stores.errors.short.${from}`, {
          qty: qtyText(issue.shows ?? 0, line.item.unit),
        });
      } else if (issue.code === 'gone') out.qty = t('staff.stores.errors.gone');
      else if (issue.field === 'kind') out.kind = t('staff.stores.errors.cafeOnly');
      else out.qty = t('staff.stores.errors.qty');
    }
    return out;
  };
  const listIssue = issues.find((i) => i.line === undefined);
  const listError = listIssue
    ? t(listIssue.code === 'tooMany' ? 'staff.stores.errors.tooMany' : 'staff.stores.errors.lines')
    : null;

  const moved = firstOf(today.data?.transfers);

  const movedToday = () => {
    if (venue === '') return null;
    if (today.isPending) return <SkeletonList rows={2} height={56} />;
    if (today.isError) {
      return (
        <ErrorState
          testID="staff-stock-move.today-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(today.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void today.refetch()}
        />
      );
    }
    if (moved.shown.length === 0)
      return <Hint style={{ paddingStart: 4 }}>{t('staff.stores.move.todayEmpty')}</Hint>;
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {moved.shown.map((m, i) => (
          <View
            key={m.transfer_id}
            testID={`staff-stock-move.today.${m.transfer_id}`}
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
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
              {t(`staff.stores.move.route.${m.from}`)}
            </Text>
            {m.lines.map((l) => (
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
                name: isolate(m.moved_by_name ?? ''),
                time: formatTime(new Date(m.moved_at), locale),
              })}
            </Text>
          </View>
        ))}
        {moved.more > 0 ? (
          <Hint style={{ paddingStart: space.m, paddingBottom: space.sm }}>
            {t('staff.stores.more', { count: moved.more })}
          </Hint>
        ) : null}
      </Card>
    );
  };

  const storeCell = (label: string, store: StockLocation) => (
    <View style={{ flex: 1, gap: 2 }}>
      <MicroLabel>{label}</MicroLabel>
      <Text style={{ fontFamily: fonts.body800, fontSize: 16, color: colors.ink }}>
        {t(`work.store.${store}`)}
      </Text>
    </View>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.stores.move.title') }} />
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
        <Lead>{t('staff.stores.move.lead')}</Lead>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}

        <Card style={{ padding: space.m, gap: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            {storeCell(t('staff.stores.move.from'), from)}
            {storeCell(t('staff.stores.move.to'), to)}
            <Button
              testID="staff-stock-move.swap"
              label={t('staff.stores.move.swap')}
              variant="secondary"
              size="compact"
              onPress={swap}
              disabled={move.isPending}
            />
          </View>

          <View style={{ marginTop: space.xs }}>
            <ItemFinder
              testID="staff-stock-move"
              list={pick.data}
              loading={venue !== '' && pick.isPending}
              error={pick.isError ? pick.error : null}
              onRetry={() => void pick.refetch()}
              query={search}
              onQuery={setSearch}
              taken={taken}
              onPick={addLine}
              aside={holds}
              emptyTitle={t(`staff.stores.move.emptyTitle.${from}`)}
              emptyBody={t('staff.stores.move.emptyBody')}
            />
          </View>

          {lines.length > 0 ? (
            <View style={{ gap: space.sm, marginTop: space.s }}>
              <MicroLabel>{t('staff.stores.move.linesTitle', { count: lines.length })}</MicroLabel>
              {lines.map((line, i) => (
                <View
                  key={line.item.ingredient_id}
                  testID={`staff-stock-move.line.${line.item.ingredient_id}`}
                  style={{
                    paddingTop: i === 0 ? 0 : space.sm,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.sub,
                  }}
                >
                  <LineEditor
                    testID="staff-stock-move"
                    line={line}
                    onChange={(patch) => editLine(line.item.ingredient_id, patch)}
                    onRemove={() => removeLine(line.item.ingredient_id)}
                    errors={lineErrors(line)}
                    note={holds(line.item)}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Hint style={{ marginTop: space.xs }}>{t('staff.stores.move.noLines')}</Hint>
          )}

          <ErrorText>{listError ?? formError}</ErrorText>
          <Button
            testID="staff-stock-move.move"
            label={t(`staff.stores.move.save.${to}`)}
            variant="primary"
            busy={move.isPending}
            onPress={onMove}
            style={{ marginTop: space.xs }}
          />
        </Card>

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {t('staff.stores.move.todayTitle')}
        </MicroLabel>
        {movedToday()}
      </ScrollView>
    </Screen>
  );
}

export default function StaffStockMoveRoute() {
  return (
    <RequireStaff roles={MOVE_ROLES}>
      <MoveScreen />
    </RequireStaff>
  );
}
