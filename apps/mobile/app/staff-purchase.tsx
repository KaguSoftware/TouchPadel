import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, formatIQD, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, LinkText, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { StoredPhotos } from '../src/features/staff/supplies/StoredPhotos';
import { GroupLabel, Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import {
  SHOPPING_LIST_STATUSES,
  confirmPurchaseDelivery,
  fetchIngredientOptions,
  fetchMyPurchases,
  fetchShoppingList,
  recordPurchase,
  type IngredientOption,
  type PurchaseRow,
  type ShoppingItem,
} from '../src/features/staff/supplies/api';
import {
  PURCHASE_ROLES,
  boughtUnit,
  emptyFreeLine,
  formatQty,
  intentFor,
  lineName,
  listLineFor,
  missingItemIds,
  parseItemIds,
  purchaseArgs,
  purchaseTotal,
  validatePurchase,
  type PurchaseField,
  type PurchaseIssue,
  type PurchaseLineDraft,
} from '../src/features/staff/supplies/logic';

/**
 * Purchases (build-contracts-2026-09-23 §6.1, §2.24.10; plan #70).
 *
 * The driver records one purchase per shop: the lines ticked on the shopping
 * list (`?itemIds=`, prefilled with what the list asked for, a pack line
 * turned into the base unit stock is counted in), anything bought that was
 * not on the list, what was paid and the receipt photo. Then each purchase
 * gets "Delivered" once the goods are at the venue. The manager receives it
 * into stock in Goods in on the operator (plan #30), which never waits for
 * Delivered.
 *
 * Managers and the owner read the venue's purchases here with their receipts
 * (my_purchases answers them every purchase) and may confirm a delivery; they
 * record nothing on the phone. Nothing here touches the till, the drawer or
 * day close.
 */

type LineErrors = Partial<Record<PurchaseField, string>>;

function PurchaseScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ itemIds?: string }>();

  const role = status.kind === 'staff' ? status.staff.role : null;
  const buyer = role === 'driver';
  const venue = venueId ?? '';
  const itemIds = useMemo(() => parseItemIds(params.itemIds), [params.itemIds]);

  const open = useQuery({
    queryKey: staffKeys.shopping(venue, 'open'),
    queryFn: () => fetchShoppingList(venue, 'open'),
    enabled: venue !== '' && buyer,
  });
  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venue),
    queryFn: () => fetchIngredientOptions(venue),
    enabled: venue !== '' && buyer,
  });
  const purchases = useQuery({
    queryKey: staffKeys.purchases(venue),
    queryFn: () => fetchMyPurchases(venue),
    enabled: venue !== '',
  });

  // A pull reads the purchases (a delivery another phone confirmed, a receipt
  // the manager took in) and, for the driver, the list the form is filled from.
  const pull = usePullRefresh(() =>
    Promise.all([purchases.refetch(), buyer ? open.refetch() : null, buyer ? ingredients.refetch() : null]),
  );

  const ingredientById = useMemo(() => {
    const map = new Map<string, IngredientOption>();
    for (const o of ingredients.data?.ingredients ?? []) map.set(o.id, o);
    return map;
  }, [ingredients.data]);
  const itemById = useMemo(() => {
    const map = new Map<string, ShoppingItem>();
    for (const i of open.data?.items ?? []) map.set(i.id, i);
    return map;
  }, [open.data]);

  // ── The form ───────────────────────────────────────────────────────────────
  // The ticked lines fill the form once the list and the pack sizes are in.
  // Until the driver changes something the form follows the list (a line
  // bought meanwhile drops out and counts as gone); after that it is the
  // driver's own, and a refresh never puts back a line they removed.
  const ready = open.data !== undefined && (ingredients.data !== undefined || ingredients.isError);
  const seeded = itemIds.length === 0 || ready;
  const openItems = useMemo(() => open.data?.items ?? [], [open.data]);
  const initial = useMemo<PurchaseLineDraft[]>(
    () =>
      ready
        ? itemIds
            .map((id) => itemById.get(id))
            .filter((i): i is ShoppingItem => i !== undefined)
            .map((i) => listLineFor(i, i.ingredient_id ? ingredientById.get(i.ingredient_id) : undefined))
        : [],
    [ready, itemIds, itemById, ingredientById],
  );
  const [edited, setEdited] = useState<PurchaseLineDraft[] | null>(null);
  const lines = edited ?? initial;
  const setLines = (next: (all: PurchaseLineDraft[]) => PurchaseLineDraft[]) => setEdited(next(lines));
  const [saved, setSaved] = useState(false);
  const gone = ready && !saved ? missingItemIds(itemIds, openItems).length : 0;

  const [shop, setShop] = useState('');
  const [receipt, setReceipt] = useState<AttachedPhoto[]>([]);
  const [issues, setIssues] = useState<PurchaseIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const editLine = (index: number, patch: Partial<PurchaseLineDraft>) => {
    setLines((all) => all.map((l, i) => (i === index ? ({ ...l, ...patch } as PurchaseLineDraft) : l)));
    setIssues((all) => all.filter((x) => !(x.line === index && x.field in patch)));
  };
  const removeLine = (index: number) => {
    setLines((all) => all.filter((_, i) => i !== index));
    setIssues([]);
  };

  const refresh = () => {
    for (const s of SHOPPING_LIST_STATUSES) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.shopping(venue, s) });
    }
    void queryClient.invalidateQueries({ queryKey: staffKeys.purchases(venue) });
    void queryClient.invalidateQueries({ queryKey: staffKeys.work(venue) });
  };

  const save = useMutation({
    mutationKey: staffKeys.mutation('purchase'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof purchaseArgs>; intent: string }) =>
      recordPurchase(args, staffIntentKey(intent, 'purchase')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.supplies.purchase.form.saved'), 'success');
      setEdited([]);
      setSaved(true);
      setShop('');
      setReceipt([]);
      setIssues([]);
      refresh();
    },
    onError: (err) => {
      setError(t(mapStaffError(err)));
      // A line bought meanwhile (SHOPPING_ITEM_NOT_OPEN) shows as gone on refresh.
      refresh();
    },
  });

  const send = () => {
    const args = purchaseArgs({ lines, shop }, venue, receipt[0]?.path ?? null);
    save.mutate({ args, intent: intentFor('purchase', args) });
  };

  const onSave = () => {
    setError(null);
    const found = validatePurchase({ lines, shop });
    setIssues(found);
    if (found.length > 0 || !venue) return;
    if (receipt.length === 0) {
      Alert.alert(
        t('staff.supplies.purchase.form.noReceiptTitle'),
        t('staff.supplies.purchase.form.noReceiptBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('staff.supplies.purchase.form.saveAnyway'), onPress: send },
        ],
      );
      return;
    }
    send();
  };

  const lineErrors = (index: number): LineErrors => {
    const out: LineErrors = {};
    for (const issue of issues.filter((i) => i.line === index)) {
      if (issue.field === 'label') {
        out.label = t(issue.code === 'tooLong' ? 'staff.supplies.purchase.form.errors.labelTooLong' : 'staff.supplies.purchase.form.errors.label');
      } else if (issue.field === 'qty') {
        out.qty = t('staff.supplies.purchase.form.errors.qty');
      } else if (issue.field === 'price') {
        out.price = t('staff.supplies.purchase.form.errors.price');
      }
    }
    return out;
  };
  const formError = (): string | null => {
    const issue = issues.find((i) => i.line === undefined);
    if (!issue) return null;
    if (issue.field === 'shop') return t('staff.supplies.purchase.form.errors.shopTooLong');
    return t(issue.code === 'tooLong' ? 'staff.supplies.purchase.form.errors.tooMany' : 'staff.supplies.purchase.form.errors.lines');
  };

  // ── Delivered ──────────────────────────────────────────────────────────────
  const deliver = useMutation({
    mutationKey: staffKeys.mutation('purchase.deliver'),
    mutationFn: (id: string) => confirmPurchaseDelivery(id),
    onSuccess: () => {
      toast(t('staff.supplies.purchase.list.deliveredDone'), 'success');
      void queryClient.invalidateQueries({ queryKey: staffKeys.purchases(venue) });
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });

  const confirmDelivered = (id: string) => {
    Alert.alert(
      t('staff.supplies.purchase.list.deliveredConfirmTitle'),
      t('staff.supplies.purchase.list.deliveredConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('staff.supplies.purchase.list.markDelivered'), onPress: () => deliver.mutate(id) },
      ],
    );
  };

  const [shownReceipt, setShownReceipt] = useState<string | null>(null);

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  const rows: PurchaseRow[] = purchases.data?.purchases ?? [];

  const lineCard = (line: PurchaseLineDraft, index: number) => {
    const errors = lineErrors(index);
    const remove = (
      <LinkText
        testID={`staff-purchase.line.${index}.remove`}
        label={t('staff.supplies.purchase.form.remove')}
        color={colors.redtext}
        onPress={() => removeLine(index)}
      />
    );
    if (line.kind === 'free') {
      return (
        <View key={`free-${index}`} testID={`staff-purchase.line.${index}`} style={{ gap: space.s }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>
              {t('staff.supplies.purchase.form.extra')}
            </Text>
            {remove}
          </View>
          <Field
            testID={`staff-purchase.line.${index}.label`}
            label={t('staff.supplies.purchase.form.label')}
            value={line.label}
            onChangeText={(label) => editLine(index, { label })}
            error={errors.label}
          />
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Field
                testID={`staff-purchase.line.${index}.qty`}
                label={t('staff.supplies.purchase.form.boughtNoUnit')}
                value={line.qty}
                onChangeText={(qty) => editLine(index, { qty })}
                keyboardType="decimal-pad"
                latin
                error={errors.qty}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                testID={`staff-purchase.line.${index}.price`}
                label={t('staff.supplies.purchase.form.paid')}
                value={line.price}
                onChangeText={(price) => editLine(index, { price })}
                keyboardType="number-pad"
                latin
                error={errors.price}
              />
            </View>
          </View>
        </View>
      );
    }
    const item = itemById.get(line.itemId);
    const ingredient = item?.ingredient_id ? ingredientById.get(item.ingredient_id) : undefined;
    const bought = item ? boughtUnit(item, ingredient) : { unit: null, qty: null };
    const unitWord = bought.unit ? t(`staff.supplies.units.many.${bought.unit}`) : null;
    return (
      <View key={line.itemId} testID={`staff-purchase.line.${index}`} style={{ gap: space.s }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s }}>
          <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
            {item ? lineName(item, locale) : ''}
          </Text>
          {remove}
        </View>
        {item ? (
          <Text style={body}>
            {t('staff.supplies.purchase.form.listAsked', { qty: formatQty(t, locale, item.qty, item.unit) })}
          </Text>
        ) : null}
        {item?.unit === 'pack' && item.ingredient_id && unitWord ? (
          <Hint style={{ marginTop: 0 }}>{t('staff.supplies.purchase.form.packHint', { unit: unitWord })}</Hint>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <View style={{ flex: 1 }}>
            <Field
              testID={`staff-purchase.line.${index}.qty`}
              label={
                unitWord
                  ? t('staff.supplies.purchase.form.bought', { unit: unitWord })
                  : t('staff.supplies.purchase.form.boughtNoUnit')
              }
              value={line.qty}
              onChangeText={(qty) => editLine(index, { qty })}
              keyboardType="decimal-pad"
              latin
              error={errors.qty}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              testID={`staff-purchase.line.${index}.price`}
              label={t('staff.supplies.purchase.form.paid')}
              value={line.price}
              onChangeText={(price) => editLine(index, { price })}
              keyboardType="number-pad"
              latin
              error={errors.price}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.purchase.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}

        {buyer ? (
          <Card style={{ padding: space.m, gap: space.sm }}>
            <MicroLabel>{t('staff.supplies.purchase.form.title')}</MicroLabel>
            <Text style={body}>{t('staff.supplies.purchase.form.lead')}</Text>
            {gone > 0 ? (
              <Text style={{ ...body, color: colors.ambtext }}>
                {t('staff.supplies.purchase.form.gone', { count: gone })}
              </Text>
            ) : null}
            {itemIds.length > 0 && !seeded ? <SkeletonList rows={2} height={96} /> : null}
            {seeded && lines.length === 0 ? <Hint style={{ marginTop: 0 }}>{t('staff.supplies.purchase.form.noLines')}</Hint> : null}
            {lines.map((line, i) => (
              <View
                key={line.kind === 'list' ? line.itemId : `free-${i}`}
                style={{ paddingTop: i === 0 ? 0 : space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.sub }}
              >
                {lineCard(line, i)}
              </View>
            ))}
            <LinkText
              testID="staff-purchase.line.add"
              label={t('staff.supplies.purchase.form.addLine')}
              onPress={() => setLines((all) => [...all, emptyFreeLine()])}
            />
            <Field
              testID="staff-purchase.shop"
              label={t('staff.supplies.purchase.form.shop')}
              value={shop}
              onChangeText={(value) => {
                setShop(value);
                setIssues((all) => all.filter((x) => x.field !== 'shop'));
              }}
            />
            <View style={{ gap: space.xs }}>
              <GroupLabel>{t('staff.supplies.purchase.form.receipt')}</GroupLabel>
              <PhotoButton
                testID="staff-purchase.receipt"
                venueId={venue}
                folder="receipts"
                photos={receipt}
                onChange={setReceipt}
                max={1}
                disabled={save.isPending}
              />
              <Hint style={{ marginTop: 0 }}>{t('staff.supplies.purchase.form.receiptHint')}</Hint>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
                {t('staff.supplies.purchase.form.total')}
              </Text>
              <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>
                {formatIQD(purchaseTotal(lines), locale)}
              </Text>
            </View>
            <ErrorText>{formError() ?? error}</ErrorText>
            <Button
              testID="staff-purchase.save"
              label={t('staff.supplies.purchase.form.save')}
              variant="primary"
              busy={save.isPending}
              onPress={onSave}
            />
          </Card>
        ) : (
          <Hint>{t('staff.supplies.purchase.list.mgmtNote')}</Hint>
        )}

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {t(buyer ? 'staff.supplies.purchase.list.mine' : 'staff.supplies.purchase.list.all')}
        </MicroLabel>
        {purchases.isPending && venue !== '' ? (
          <SkeletonList rows={2} height={96} />
        ) : purchases.isError ? (
          <ErrorState
            testID="staff-purchase.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(purchases.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void purchases.refetch()}
          />
        ) : rows.length === 0 ? (
          <Hint>{t('staff.supplies.purchase.list.empty')}</Hint>
        ) : (
          rows.map((p) => (
            <Card key={p.id} style={{ padding: space.m, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
                    {p.shop_name ? isolate(p.shop_name) : t('staff.supplies.purchase.list.noShop')}
                  </Text>
                  <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                    {formatDateTime(new Date(p.bought_at), locale)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
                    {formatIQD(p.total_iqd, locale)}
                  </Text>
                  <Tag tone={p.status === 'done' ? 'good' : 'warn'} label={t(`work.purchase.status.${p.status}`)} />
                </View>
              </View>
              {p.lines.map((l, i) => (
                <View key={`${p.id}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                  <Text style={{ ...body, flexShrink: 1 }}>
                    {`${lineName(l, locale)} · ${formatQty(t, locale, l.qty, l.unit)}`}
                  </Text>
                  <Text style={body}>{formatIQD(l.price_iqd, locale)}</Text>
                </View>
              ))}
              {p.receipt_path ? (
                <>
                  <LinkText
                    testID={`staff-purchase.receipt.${p.id}`}
                    label={t(
                      shownReceipt === p.id
                        ? 'staff.supplies.purchase.list.hideReceipt'
                        : 'staff.supplies.purchase.list.showReceipt',
                    )}
                    onPress={() => setShownReceipt((id) => (id === p.id ? null : p.id))}
                  />
                  {shownReceipt === p.id ? <StoredPhotos paths={[p.receipt_path]} size={220} /> : null}
                </>
              ) : (
                <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                  {t('staff.supplies.purchase.list.noReceipt')}
                </Text>
              )}
              {p.delivered_at ? (
                <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
                  {t('staff.supplies.purchase.list.deliveredAt', {
                    when: formatDateTime(new Date(p.delivered_at), locale),
                  })}
                </Text>
              ) : (
                <Button
                  testID={`staff-purchase.delivered.${p.id}`}
                  label={t('staff.supplies.purchase.list.markDelivered')}
                  variant="secondary"
                  size="compact"
                  busy={deliver.isPending && deliver.variables === p.id}
                  onPress={() => confirmDelivered(p.id)}
                  style={{ marginTop: 4 }}
                />
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

export default function StaffPurchaseRoute() {
  return (
    <RequireStaff roles={PURCHASE_ROLES}>
      <PurchaseScreen />
    </RequireStaff>
  );
}
