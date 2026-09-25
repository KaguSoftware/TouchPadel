import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localIsoDate } from '@touch/core';
import { formatNumber, formatTime, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  PRODUCTION_ROLES,
  batchArgs,
  batchIntent,
  sortProduction,
  validateBatch,
  type BatchArgs,
  type BatchDraft,
  type BatchField,
  type BatchIssue,
  type StockUnit,
} from '../src/features/staff/supplies/production';
import {
  fetchProductionLog,
  fetchProductionToday,
  recordBatch,
} from '../src/features/staff/supplies/productionApi';
import { localName } from '../src/features/staff/checklists/logic';
import { Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Production (build-contracts-2026-09-23 §2.16, §6.1; plan #25): the head
 * chef, the chef assistant, the manager and the owner. "What to make today"
 * lists the prepared items with a recipe, below par first, with on hand, par
 * and what was made today; pressing one picks it for the batch. A batch goes
 * through `record_batch`, which takes its components off the stock on the
 * server and returns no cost. "Made today" is the day's batches, with who
 * made each.
 *
 * The batch carries an idempotency key kept per batch (its item, amount and
 * use-by), so a retry after a dropped reply replays the first answer instead
 * of deducting the components twice.
 */

const FRESH: BatchDraft = { ingredientId: null, qty: '', expiry: '' };

function ProductionScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';

  const items = useQuery({
    queryKey: staffKeys.production(venue),
    queryFn: () => fetchProductionToday(venue),
    enabled: venue !== '',
  });
  const log = useQuery({
    queryKey: staffKeys.productionLog(venue),
    queryFn: () => fetchProductionLog(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => Promise.all([items.refetch(), log.refetch()]));

  const [draft, setDraft] = useState<BatchDraft>(FRESH);
  const [issues, setIssues] = useState<BatchIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const example = localIsoDate(new Date());

  const edit = (patch: Partial<BatchDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
    setIssues((all) =>
      all.filter((i) => !(i.field === 'item' ? 'ingredientId' in patch : i.field in patch)),
    );
  };

  const record = useMutation({
    mutationKey: staffKeys.mutation('batch'),
    mutationFn: (args: BatchArgs) => recordBatch(args, staffIntentKey(batchIntent(args), 'batch')),
    onSuccess: (_result, args) => {
      clearStaffIntentKey(batchIntent(args));
      toast(t('staff.checklists.production.recorded'), 'success');
      setDraft(FRESH);
      setIssues([]);
      void queryClient.invalidateQueries({ queryKey: staffKeys.production(venue) });
      void queryClient.invalidateQueries({ queryKey: staffKeys.productionLog(venue) });
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const list = sortProduction(items.data ?? []);
  const picked = list.find((i) => i.ingredient_id === draft.ingredientId) ?? null;

  const qtyText = (qty: number, unit: StockUnit) =>
    t('staff.checklists.qty', { qty: formatNumber(qty, locale), unit: t(`staff.checklists.units.${unit}`) });

  const onRecord = () => {
    setError(null);
    const found = validateBatch(draft, localIsoDate(new Date()));
    setIssues(found);
    if (found.length === 0 && venue !== '') record.mutate(batchArgs(draft, venue));
  };

  const fieldError = (field: BatchField): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    if (field === 'item') return t('staff.checklists.production.errors.item');
    if (field === 'qty') return t('staff.checklists.production.errors.qty');
    return issue.code === 'past'
      ? t('staff.checklists.production.errors.expiryPast')
      : t('staff.checklists.production.errors.expiry', { example: isolate(example) });
  };

  const whatToMake = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (items.isPending) return <SkeletonList rows={3} height={64} />;
    if (items.isError) {
      return (
        <ErrorState
          testID="staff-production.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(items.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void items.refetch()}
        />
      );
    }
    if (list.length === 0) {
      return (
        <EmptyState
          testID="staff-production.empty"
          title={t('staff.checklists.production.emptyTitle')}
          message={t('staff.checklists.production.emptyBody')}
        />
      );
    }
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {list.map((item, i) => {
          const selected = item.ingredient_id === draft.ingredientId;
          return (
            <Pressable
              key={item.ingredient_id}
              testID={`staff-production.item.${item.ingredient_id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => edit({ ingredientId: item.ingredient_id })}
              style={({ pressed }) => ({
                paddingStart: space.m,
                paddingEnd: space.m,
                paddingTop: space.sm,
                paddingBottom: space.sm,
                gap: 4,
                backgroundColor: selected ? colors.tint : pressed ? colors.sub : 'transparent',
                borderBottomWidth: i === list.length - 1 ? 0 : 1,
                borderBottomColor: colors.sub,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
                <Text
                  style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: selected ? colors.blue : colors.ink }}
                >
                  {localName(item, locale)}
                </Text>
                {item.below_par ? <Tag tone="warn" label={t('staff.checklists.production.belowPar')} /> : null}
              </View>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
                {[
                  t('staff.checklists.production.onHand', { qty: qtyText(item.on_hand, item.unit) }),
                  item.par_level !== null
                    ? t('staff.checklists.production.par', { qty: qtyText(item.par_level, item.unit) })
                    : null,
                  t('staff.checklists.production.madeToday', { qty: qtyText(item.made_today, item.unit) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          );
        })}
      </Card>
    );
  };

  const madeToday = () => {
    if (venue === '') return null;
    if (log.isPending) return <SkeletonList rows={2} height={48} />;
    if (log.isError) {
      return (
        <ErrorState
          testID="staff-production.log-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(log.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void log.refetch()}
        />
      );
    }
    const rows = log.data ?? [];
    if (rows.length === 0) return <Hint>{t('staff.checklists.production.logEmpty')}</Hint>;
    return (
      <Card style={{ padding: space.m, gap: space.s }}>
        {rows.map((row) => (
          <View key={String(row.movement_id)} style={{ gap: 2 }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
              {`${qtyText(row.qty, row.unit)} · ${localName(row, locale)}`}
            </Text>
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
              {t('staff.checklists.production.logBy', {
                name: isolate(row.staff_name ?? ''),
                time: formatTime(new Date(row.at), locale),
              })}
            </Text>
          </View>
        ))}
      </Card>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.production.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>
          {t('staff.checklists.production.lead')}
        </Text>

        <MicroLabel style={{ paddingStart: 4, marginTop: space.xs }}>
          {t('staff.checklists.production.todayTitle')}
        </MicroLabel>
        {whatToMake()}

        <Card style={{ padding: space.m, gap: space.s, marginTop: space.xs }}>
          <MicroLabel>{t('staff.checklists.production.recordTitle')}</MicroLabel>
          {picked ? (
            <View
              style={{
                padding: space.sm,
                borderRadius: radius.cell,
                backgroundColor: colors.tint,
                gap: 2,
              }}
            >
              <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                {t('staff.checklists.production.item')}
              </Text>
              <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>
                {localName(picked, locale)}
              </Text>
            </View>
          ) : (
            <Hint style={{ marginTop: 0 }}>{t('staff.checklists.production.pickHint')}</Hint>
          )}
          {fieldError('item') ? <ErrorText>{fieldError('item')}</ErrorText> : null}
          <Field
            testID="staff-production.qty"
            label={
              picked
                ? t('staff.checklists.production.qty', { unit: t(`staff.checklists.units.${picked.unit}`) })
                : t('staff.checklists.production.qtyNoUnit')
            }
            value={draft.qty}
            onChangeText={(qty) => edit({ qty })}
            keyboardType="decimal-pad"
            latin
            error={fieldError('qty')}
          />
          <Field
            testID="staff-production.expiry"
            label={t('staff.checklists.production.expiry')}
            value={draft.expiry}
            onChangeText={(expiry) => edit({ expiry })}
            keyboardType="numbers-and-punctuation"
            latin
            error={fieldError('expiry')}
          />
          <Hint style={{ marginTop: 0 }}>
            {picked?.shelf_life_days
              ? t('staff.checklists.production.expiryShelfLife', { days: picked.shelf_life_days })
              : t('staff.checklists.production.expiryHint', { example: isolate(example) })}
          </Hint>
          <ErrorText>{error}</ErrorText>
          <Button
            testID="staff-production.record"
            label={t('staff.checklists.production.record')}
            variant="primary"
            busy={record.isPending}
            onPress={onRecord}
          />
        </Card>

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {t('staff.checklists.production.logTitle')}
        </MicroLabel>
        {madeToday()}
      </ScrollView>
    </Screen>
  );
}

export default function StaffProductionRoute() {
  return (
    <RequireStaff roles={PRODUCTION_ROLES}>
      <ProductionScreen />
    </RequireStaff>
  );
}
