import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StaffRole } from '@touch/core';
import { formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, LinkText, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { MenuRow } from '../src/components/booking';
import { CardIcon, CheckIcon, ChevronIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  SHOPPING_LIST_STATUSES,
  addShoppingItem,
  cancelShoppingItem,
  decideShoppingItem,
  fetchIngredientOptions,
  fetchShoppingList,
  type IngredientOption,
  type ShoppingItem,
} from '../src/features/staff/supplies/api';
import {
  CAPS,
  DECLINED_SHOWN,
  SHOPPING_ROLES,
  canCancel,
  emptyShoppingDraft,
  formatQty,
  intentFor,
  lineName,
  matchIngredients,
  pickIngredient,
  pruneTicks,
  shoppingArgs,
  shoppingStatusesFor,
  shoppingView,
  tickedInOrder,
  toggleTick,
  unitsFor,
  validateShoppingDraft,
  type ShoppingDraft,
  type ShoppingField,
  type ShoppingIssue,
  type ShoppingUnit,
  type ShoppingView,
} from '../src/features/staff/supplies/logic';

/**
 * The shopping list (build-contracts-2026-09-23 §6.1; plan #26, #66, #70).
 *
 * One page, shaped by role:
 *   head barista, head chef, MGMT  add lines, which go straight to the driver
 *   chef (chef assistant)          adds lines that wait for the head chef's
 *                                  OK, and follows them (waiting, declined)
 *   head chef, MGMT                "Waiting for your OK": approve or decline
 *                                  the chef assistant's lines, with a reason
 *   barista                        reads the list
 *   driver                         the run: the open list as a checklist, whose
 *                                  ticks stay on this phone until "Record
 *                                  purchase" opens staff-purchase with them
 *
 * A driver never asks for a waiting or declined line (the server refuses
 * one), so it never sees a line before its OK. No price is shown or asked for
 * here: the list carries none, and the purchase is the driver's own page.
 */

function leadKey(role: StaffRole): MessageKey {
  if (role === 'driver') return 'staff.supplies.shopping.lead.driver';
  if (role === 'chef') return 'staff.supplies.shopping.lead.chef';
  if (role === 'manager' || role === 'owner') return 'staff.supplies.shopping.lead.mgmt';
  if (role === 'head_barista' || role === 'head_chef') return 'staff.supplies.shopping.lead.head';
  return 'staff.supplies.shopping.lead.reader';
}

function ShoppingScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();

  const role = status.kind === 'staff' ? status.staff.role : null;
  const view: ShoppingView = role ? shoppingView(role) : shoppingView('cashier');
  const venue = venueId ?? '';
  const statuses = shoppingStatusesFor(view);

  const open = useQuery({
    queryKey: staffKeys.shopping(venue, 'open'),
    queryFn: () => fetchShoppingList(venue, 'open'),
    enabled: venue !== '',
  });
  const pending = useQuery({
    queryKey: staffKeys.shopping(venue, 'pending'),
    queryFn: () => fetchShoppingList(venue, 'pending'),
    enabled: venue !== '' && statuses.includes('pending'),
  });
  const declined = useQuery({
    queryKey: staffKeys.shopping(venue, 'declined'),
    queryFn: () => fetchShoppingList(venue, 'declined'),
    enabled: venue !== '' && statuses.includes('declined'),
  });
  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venue),
    queryFn: () => fetchIngredientOptions(venue),
    enabled: venue !== '' && view.canAdd,
  });

  const refreshLists = () => {
    for (const s of SHOPPING_LIST_STATUSES) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.shopping(venue, s) });
    }
    void queryClient.invalidateQueries({ queryKey: staffKeys.work(venue) });
  };

  // ── Add ────────────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<ShoppingDraft>(emptyShoppingDraft);
  const [issues, setIssues] = useState<ShoppingIssue[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const options = ingredients.data?.ingredients ?? [];
  const picked: IngredientOption | null = options.find((o) => o.id === draft.ingredientId) ?? null;
  const matches = picked ? [] : matchIngredients(options, draft.label);

  const edit = (patch: Partial<ShoppingDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // A field the person is fixing stops showing its error.
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const add = useMutation({
    mutationKey: staffKeys.mutation('shopping.add'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof shoppingArgs>; intent: string }) =>
      addShoppingItem(args, staffIntentKey(intent, 'shopping.add')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t(view.addWaitsForOk ? 'staff.supplies.shopping.add.sentForOk' : 'staff.supplies.shopping.add.added'), 'success');
      setDraft(emptyShoppingDraft());
      setIssues([]);
      refreshLists();
    },
    onError: (err) => setAddError(t(mapStaffError(err))),
  });

  const onAdd = () => {
    setAddError(null);
    // The unit control shows the first unit until one is chosen; that is the
    // one sent.
    const current = { ...draft, unit: draft.unit ?? unitsFor(picked)[0] ?? null };
    const found = validateShoppingDraft(current, picked);
    setIssues(found);
    if (found.length > 0 || !venue) return;
    const args = shoppingArgs(current, picked, venue);
    add.mutate({ args, intent: intentFor('shopping.add', args) });
  };

  const addFieldError = (field: ShoppingField): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    switch (field) {
      case 'label':
        return t(issue.code === 'tooLong' ? 'staff.supplies.shopping.add.errors.whatTooLong' : 'staff.supplies.shopping.add.errors.what');
      case 'qty':
        return t('staff.supplies.shopping.add.errors.qty');
      case 'unit':
        return t('staff.supplies.shopping.add.errors.unit');
      case 'note':
        return t('staff.supplies.shopping.add.errors.noteTooLong');
      default:
        return null;
    }
  };

  // ── Cancel, decide ─────────────────────────────────────────────────────────
  const cancel = useMutation({
    mutationKey: staffKeys.mutation('shopping.cancel'),
    mutationFn: (id: string) => cancelShoppingItem(id),
    onSuccess: () => {
      toast(t('staff.supplies.shopping.list.cancelled'), 'info');
      refreshLists();
    },
    onError: (err) => {
      toast(t(mapStaffError(err)), 'error');
      refreshLists();
    },
  });

  const confirmCancel = (id: string) => {
    Alert.alert(t('staff.supplies.shopping.list.cancel'), t('staff.supplies.shopping.list.cancelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staff.supplies.shopping.list.cancel'), style: 'destructive', onPress: () => cancel.mutate(id) },
    ]);
  };

  const [declining, setDeclining] = useState<{ id: string; reason: string; error: string | null } | null>(null);
  const decide = useMutation({
    mutationKey: staffKeys.mutation('shopping.decide'),
    mutationFn: (v: { id: string; approve: boolean; reason: string | null }) =>
      decideShoppingItem(v.id, v.approve, v.reason),
    onSuccess: (_data, v) => {
      toast(t(v.approve ? 'staff.supplies.shopping.approve.approved' : 'staff.supplies.shopping.approve.declined'), 'success');
      setDeclining(null);
      refreshLists();
    },
    onError: (err) => {
      toast(t(mapStaffError(err)), 'error');
      refreshLists();
    },
  });

  const onConfirmDecline = () => {
    if (!declining) return;
    const reason = declining.reason.trim();
    if (!reason) {
      setDeclining({ ...declining, error: t('staff.supplies.shopping.approve.errors.reason') });
      return;
    }
    if (reason.length > CAPS.declineReason) {
      setDeclining({ ...declining, error: t('staff.supplies.shopping.approve.errors.reasonTooLong') });
      return;
    }
    decide.mutate({ id: declining.id, approve: false, reason });
  };

  // ── The driver's run ───────────────────────────────────────────────────────
  const [ticks, setTicks] = useState<Set<string>>(() => new Set());
  const openItems = useMemo(() => open.data?.items ?? [], [open.data]);
  const liveTicks = useMemo(() => pruneTicks(ticks, openItems.map((i) => i.id)), [ticks, openItems]);

  const onRecord = () => {
    router.push({
      pathname: '/staff-purchase',
      params: { itemIds: tickedInOrder(openItems, liveTicks).join(',') },
    });
  };

  if (status.kind !== 'staff') return null;

  const mine = (list: readonly ShoppingItem[]) => list.filter((i) => i.mine);
  const pendingItems = pending.data?.items ?? [];
  const myPending = mine(pendingItems);
  const myDeclined = mine(declined.data?.items ?? []).slice(0, DECLINED_SHOWN);
  const units = unitsFor(picked);

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };

  /** One line of a list: name and amount, its note as typed, who added it and when. */
  const lineText = (item: ShoppingItem) => (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
        <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
          {lineName(item, locale)}
        </Text>
        <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
          {formatQty(t, locale, item.qty, item.unit)}
        </Text>
      </View>
      {item.note ? <Text style={body}>{item.note}</Text> : null}
      <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
        {t('staff.supplies.shopping.list.by', {
          name: isolate(item.requested_by_name ?? ''),
          when: formatDateTime(new Date(item.requested_at), locale),
        })}
      </Text>
    </>
  );

  const cancelLink = (item: ShoppingItem) =>
    canCancel(view, item) ? (
      <LinkText
        testID={`staff-shopping.cancel.${item.id}`}
        label={t('staff.supplies.shopping.list.cancel')}
        color={colors.redtext}
        onPress={() => confirmCancel(item.id)}
        style={{ marginTop: 4 }}
      />
    ) : null;

  const loadError = (testID: string, query: { error: unknown; refetch: () => unknown }) => (
    <ErrorState
      testID={testID}
      title={t('errors.loadFailedTitle')}
      message={t(mapStaffError(query.error))}
      retryLabel={t('common.retry')}
      onRetry={() => void query.refetch()}
    />
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.shopping.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>
          {t(leadKey(status.staff.role))}
        </Text>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}

        {view.canDecide && pending.isError ? loadError('staff-shopping.pending-error', pending) : null}
        {view.canDecide && pendingItems.length > 0 ? (
          <View style={{ gap: space.s }}>
            <MicroLabel style={{ paddingStart: 4 }}>
              {t('staff.supplies.shopping.approve.title', { count: pendingItems.length })}
            </MicroLabel>
            <Hint style={{ marginTop: 0, paddingStart: 4 }}>{t('staff.supplies.shopping.approve.lead')}</Hint>
            {pendingItems.map((item) => {
              const busy = decide.isPending && decide.variables?.id === item.id;
              return (
                <Card key={item.id} style={{ padding: space.m, gap: 4 }}>
                  {lineText(item)}
                  {declining && declining.id === item.id ? (
                    <View style={{ gap: space.s, marginTop: space.s }}>
                      <Field
                        testID={`staff-shopping.decline.${item.id}.reason`}
                        label={t('staff.supplies.shopping.approve.reason')}
                        value={declining.reason}
                        onChangeText={(reason) => setDeclining({ id: item.id, reason, error: null })}
                        multiline
                        error={declining.error}
                      />
                      <View style={{ flexDirection: 'row', gap: space.s }}>
                        <Button
                          testID={`staff-shopping.decline.${item.id}.confirm`}
                          label={t('staff.supplies.shopping.approve.confirmDecline')}
                          variant="dangerOutline"
                          size="compact"
                          busy={busy}
                          onPress={onConfirmDecline}
                          style={{ flex: 1 }}
                        />
                        <Button
                          testID={`staff-shopping.decline.${item.id}.keep`}
                          label={t('staff.supplies.shopping.approve.keep')}
                          variant="secondary"
                          size="compact"
                          onPress={() => setDeclining(null)}
                          style={{ flex: 1 }}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.s }}>
                      <Button
                        testID={`staff-shopping.approve.${item.id}`}
                        label={t('staff.supplies.shopping.approve.approve')}
                        variant="primary"
                        size="compact"
                        busy={busy}
                        onPress={() => decide.mutate({ id: item.id, approve: true, reason: null })}
                        style={{ flex: 1 }}
                      />
                      <Button
                        testID={`staff-shopping.decline.${item.id}`}
                        label={t('staff.supplies.shopping.approve.decline')}
                        variant="secondary"
                        size="compact"
                        disabled={busy}
                        onPress={() => setDeclining({ id: item.id, reason: '', error: null })}
                        style={{ flex: 1 }}
                      />
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        ) : null}

        {view.canAdd ? (
          <Card style={{ padding: space.m, gap: space.s }}>
            <MicroLabel>{t('staff.supplies.shopping.add.title')}</MicroLabel>
            {picked ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
                  {t('staff.supplies.shopping.add.stockItem')}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                    padding: space.sm,
                    borderRadius: radius.cell,
                    borderWidth: 1,
                    borderColor: colors.gline,
                    backgroundColor: colors.gtint,
                  }}
                >
                  <CheckIcon size={14} color={colors.gstrong} />
                  <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
                    {locale === 'ar' ? picked.name_ar : picked.name_en}
                  </Text>
                  <LinkText
                    testID="staff-shopping.item-change"
                    label={t('staff.supplies.shopping.add.change')}
                    onPress={() => setDraft((d) => pickIngredient({ ...d, label: '' }, null))}
                  />
                </View>
              </View>
            ) : (
              <>
                <Field
                  testID="staff-shopping.what"
                  label={t('staff.supplies.shopping.add.what')}
                  value={draft.label}
                  onChangeText={(label) => edit({ label })}
                  error={addFieldError('label')}
                />
                {matches.length > 0 ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radius.cell,
                      overflow: 'hidden',
                    }}
                  >
                    {matches.map((option, i) => (
                      <Pressable
                        key={option.id}
                        testID={`staff-shopping.ingredient.${option.id}`}
                        accessibilityRole="button"
                        onPress={() => {
                          setDraft((d) => pickIngredient(d, option));
                          setIssues((all) => all.filter((x) => x.field !== 'label' && x.field !== 'unit'));
                        }}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingStart: space.m,
                          paddingEnd: space.m,
                          paddingTop: 11,
                          paddingBottom: 11,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: colors.sub,
                          backgroundColor: pressed ? colors.sub : colors.card,
                        })}
                      >
                        <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}>
                          {locale === 'ar' ? option.name_ar : option.name_en}
                        </Text>
                        <ChevronIcon size={14} color={colors.fnt} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Hint style={{ marginTop: 0 }}>{t('staff.supplies.shopping.add.whatHint')}</Hint>
              </>
            )}
            <Field
              testID="staff-shopping.qty"
              label={t('staff.supplies.shopping.add.qty')}
              value={draft.qty}
              onChangeText={(qty) => edit({ qty })}
              keyboardType="decimal-pad"
              latin
              error={addFieldError('qty')}
            />
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
              {t('staff.supplies.shopping.add.unit')}
            </Text>
            <SegmentedControl<ShoppingUnit>
              testID="staff-shopping.unit"
              options={units.map((u) => ({ value: u, label: t(`staff.supplies.units.many.${u}`) }))}
              value={draft.unit ?? units[0]!}
              onChange={(unit) => edit({ unit })}
            />
            <ErrorText>{addFieldError('unit')}</ErrorText>
            <Field
              testID="staff-shopping.note"
              label={t('staff.supplies.shopping.add.note')}
              value={draft.note}
              onChangeText={(note) => edit({ note })}
              multiline
              error={addFieldError('note')}
            />
            {view.addWaitsForOk ? <Hint style={{ marginTop: 0 }}>{t('staff.supplies.shopping.add.waitsForOk')}</Hint> : null}
            <ErrorText>{addError}</ErrorText>
            <Button
              testID="staff-shopping.add"
              label={t('staff.supplies.shopping.add.submit')}
              variant="primary"
              busy={add.isPending}
              onPress={onAdd}
            />
          </Card>
        ) : null}

        {view.addWaitsForOk && myPending.length > 0 ? (
          <View style={{ gap: space.s }}>
            <MicroLabel style={{ paddingStart: 4 }}>
              {t('staff.supplies.shopping.waiting.title', { count: myPending.length })}
            </MicroLabel>
            {myPending.map((item) => (
              <Card key={item.id} style={{ padding: space.m, gap: 4 }}>
                {lineText(item)}
                <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ambstrong }}>
                  {t('work.shopping.status.pending')}
                </Text>
                {cancelLink(item)}
              </Card>
            ))}
          </View>
        ) : null}

        {view.addWaitsForOk && myDeclined.length > 0 ? (
          <View style={{ gap: space.s }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.supplies.shopping.declined.title')}</MicroLabel>
            {myDeclined.map((item) => (
              <Card key={item.id} style={{ padding: space.m, gap: 4 }}>
                {lineText(item)}
                {item.decline_reason ? (
                  <Text style={{ ...body, color: colors.redtext }}>
                    {t('staff.supplies.shopping.declined.reason', { reason: isolate(item.decline_reason) })}
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {view.runChecklist
            ? t('staff.supplies.shopping.run.title', { count: openItems.length })
            : t('staff.supplies.shopping.list.title', { count: openItems.length })}
        </MicroLabel>
        {open.isPending && venue !== '' ? (
          <SkeletonList rows={3} height={64} />
        ) : open.isError ? (
          loadError('staff-shopping.error', open)
        ) : openItems.length === 0 ? (
          <Hint>{t('staff.supplies.shopping.list.empty')}</Hint>
        ) : view.runChecklist ? (
          <View style={{ gap: space.s }}>
            <Hint style={{ marginTop: 0, paddingStart: 4 }}>{t('staff.supplies.shopping.run.lead')}</Hint>
            {openItems.map((item) => {
              const ticked = liveTicks.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  testID={`staff-shopping.run.${item.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked }}
                  accessibilityHint={t(ticked ? 'staff.supplies.shopping.run.ticked' : 'staff.supplies.shopping.run.unticked')}
                  onPress={() => setTicks((all) => toggleTick(pruneTicks(all, openItems.map((i) => i.id)), item.id))}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: space.sm,
                    padding: space.m,
                    borderRadius: radius.card,
                    borderWidth: 1,
                    borderColor: ticked ? colors.gline : colors.line,
                    backgroundColor: ticked ? colors.gtint : colors.card,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      borderWidth: 1.5,
                      borderColor: ticked ? colors.gstrong : colors.line2,
                      backgroundColor: ticked ? colors.gstrong : colors.card,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {ticked ? <CheckIcon size={14} color={colors.card} strokeWidth={2.6} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>{lineText(item)}</View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          openItems.map((item) => (
            <Card key={item.id} style={{ padding: space.m, gap: 4 }}>
              <View testID={`staff-shopping.item.${item.id}`} style={{ gap: 4 }}>
                {lineText(item)}
              </View>
              {cancelLink(item)}
            </Card>
          ))
        )}

        {view.runChecklist ? (
          <>
            <Button
              testID="staff-shopping.buy"
              label={
                liveTicks.size > 0
                  ? t('staff.supplies.shopping.run.record', { count: liveTicks.size })
                  : t('staff.supplies.shopping.run.recordNone')
              }
              variant="cta"
              onPress={onRecord}
              style={{ marginTop: space.s }}
            />
            <View
              style={{
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.card,
                overflow: 'hidden',
                marginTop: space.s,
              }}
            >
              <MenuRow
                testID="staff-shopping.purchases"
                icon={<CardIcon size={15} color={colors.gstrong} />}
                label={t('staff.supplies.shopping.run.purchases')}
                onPress={() => router.push('/staff-purchase')}
                last
              />
            </View>
          </>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

export default function StaffShoppingRoute() {
  return (
    <RequireStaff roles={SHOPPING_ROLES}>
      <ShoppingScreen />
    </RequireStaff>
  );
}
