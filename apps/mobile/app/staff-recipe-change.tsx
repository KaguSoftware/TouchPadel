import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatNumber, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
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
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  decideRecipeChange,
  fetchIngredientOptions,
  fetchMyRecipeChanges,
  fetchRecipeChanges,
  fetchRecipeView,
  requestRecipeChange,
  withdrawRecipeChange,
} from '../src/features/staff/recipes/api';
import {
  NOTE_MAX,
  RECIPE_CHANGE_FILTERS,
  RECIPE_CHANGE_ROLES,
  REASON_MAX,
  addableIngredients,
  asksRecipeChanges,
  canApprove,
  changeLines,
  declineIssue,
  decidesRecipeChanges,
  emptyRecipeDraft,
  findTarget,
  lineOp,
  recipeChangeArgs,
  recipeChangeIntent,
  recipeTargets,
  validateRecipeChange,
  withAdded,
  withLineOp,
  withoutOp,
  withQty,
  type MyRecipeChange,
  type RecipeChangeArgs,
  type RecipeChangeDraft,
  type RecipeChangeFilter,
  type RecipeChangeRow,
  type RecipeChangeStatus,
  type RecipeIssue,
  type RecipeTarget,
  type RecipeTargetKind,
} from '../src/features/staff/recipes/logic';
import type { StockUnit } from '../src/features/staff/supplies/production';
import { localName } from '../src/features/staff/checklists/logic';
import { Tag, type TagTone } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Recipe changes (build-contracts-2026-09-23 §2.24.7, §6.1; plan #71, #72).
 *
 * The head barista and the head chef ask: pick a size of a cafe item or an
 * item made in the kitchen, then set an ingredient to a new amount, take one
 * out, or add one, without ever seeing the current amounts (#72). Each amount
 * is in the ingredient's base unit. The request goes to the owner, and the
 * head follows it here and may withdraw it while it waits.
 *
 * The owner decides: Approve writes the recipe on the server, Decline needs a
 * reason. A request whose recipe changed after it was sent cannot be approved
 * (RECIPE_CHANGED); it says so. The manager reads every request, with the
 * amounts before and after, and decides none.
 *
 * `?target=&targetId=` starts a head's request on that recipe; `?id=` opens a
 * request a push named.
 */

const STATUS_TONE: Record<RecipeChangeStatus, TagTone> = {
  waiting: 'warn',
  approved: 'good',
  declined: 'bad',
  withdrawn: 'plain',
};

type Locale = 'en' | 'ar';

/** "Latte · Large", "Latte", or the prepared item's name. */
function targetLabel(
  row: { name_en: string | null; name_ar: string | null; size_en: string | null; size_ar: string | null },
  locale: Locale,
): string {
  const name = localName({ name_en: row.name_en ?? '', name_ar: row.name_ar ?? '' }, locale);
  const size = locale === 'ar' ? (row.size_ar ?? row.size_en) : (row.size_en ?? row.size_ar);
  return size ? `${name} · ${size}` : name;
}

function RecipeChangeScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ target?: string; targetId?: string; id?: string }>();
  const role = status.kind === 'staff' ? status.staff.role : 'head_chef';
  const head = asksRecipeChanges(role);
  const owner = decidesRecipeChanges(role);
  const venue = venueId ?? '';

  const [selectedId, setSelectedId] = useState<string | null>(params.id ?? null);
  const [filter, setFilter] = useState<RecipeChangeFilter>(params.id ? 'all' : 'waiting');

  // ── Reads ──────────────────────────────────────────────────────────────
  const view = useQuery({
    queryKey: staffKeys.recipes(venue, 'all'),
    queryFn: () => fetchRecipeView(venue),
    enabled: venue !== '' && head,
  });
  const options = useQuery({
    queryKey: staffKeys.ingredients(venue),
    queryFn: () => fetchIngredientOptions(venue),
    enabled: venue !== '' && head,
  });
  const mine = useQuery({
    queryKey: staffKeys.myRecipeChanges(venue),
    queryFn: () => fetchMyRecipeChanges(venue),
    enabled: venue !== '' && head,
  });
  const page = useQuery({
    queryKey: staffKeys.recipeChanges(venue, filter),
    queryFn: () => fetchRecipeChanges(venue, filter),
    enabled: venue !== '' && !head,
  });
  const pull = usePullRefresh(() =>
    head ? Promise.all([view.refetch(), options.refetch(), mine.refetch()]) : page.refetch(),
  );

  const targets = useMemo(() => recipeTargets(view.data), [view.data]);
  const ingredientList = options.data?.ingredients ?? [];
  const unitOf = (ingredientId: string): StockUnit | null =>
    ingredientList.find((o) => o.id === ingredientId)?.unit ?? null;
  const ingredientName = (ingredientId: string): string => {
    const o = ingredientList.find((x) => x.id === ingredientId);
    return o ? localName(o, locale) : '';
  };

  // ── The head's draft ───────────────────────────────────────────────────
  // A recipe named by the link starts the draft; it resolves once the recipes are in.
  const [draft, setDraft] = useState<RecipeChangeDraft>(() =>
    (params.target === 'variant' || params.target === 'output') && params.targetId
      ? emptyRecipeDraft({ kind: params.target, id: params.targetId })
      : emptyRecipeDraft(),
  );
  const [issues, setIssues] = useState<RecipeIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [ingredientQuery, setIngredientQuery] = useState('');

  const target: RecipeTarget | null = draft.target ? findTarget(targets, draft.target.kind, draft.target.id) : null;

  const change = (next: RecipeChangeDraft) => {
    setDraft(next);
    setIssues([]);
    setError(null);
  };

  const pickTarget = (kind: RecipeTargetKind, id: string) => {
    change(emptyRecipeDraft({ kind, id }));
    setTargetQuery('');
    setAdding(false);
  };

  const send = useMutation({
    mutationKey: staffKeys.mutation('recipe_change'),
    mutationFn: (args: RecipeChangeArgs) =>
      requestRecipeChange(args, staffIntentKey(recipeChangeIntent(args), 'recipe_change')),
    onSuccess: (_result, args) => {
      clearStaffIntentKey(recipeChangeIntent(args));
      toast(t('staff.checklists.recipeChange.sent'), 'success');
      change(emptyRecipeDraft());
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: staffKeys.myRecipeChanges(venue) });
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSend = () => {
    setError(null);
    const found = validateRecipeChange(draft, target);
    setIssues(found);
    if (found.length === 0 && venue !== '') send.mutate(recipeChangeArgs(draft, venue));
  };

  // ── Decisions and withdrawals ─────────────────────────────────────────
  const [reason, setReason] = useState('');
  const [reasonIssue, setReasonIssue] = useState<'required' | 'tooLong' | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const refreshPages = () => {
    for (const f of RECIPE_CHANGE_FILTERS) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.recipeChanges(venue, f) });
    }
  };

  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('recipe_change.withdraw'),
    mutationFn: (id: string) => withdrawRecipeChange(id),
    onSuccess: () => {
      toast(t('staff.checklists.recipeChange.withdrawn'), 'info');
      void queryClient.invalidateQueries({ queryKey: staffKeys.myRecipeChanges(venue) });
    },
    onError: (err) => setDecideError(t(mapStaffError(err))),
  });

  const decide = useMutation({
    mutationKey: staffKeys.mutation('recipe_change.decide'),
    mutationFn: (v: { id: string; approve: boolean; reason: string | null }) =>
      decideRecipeChange(v.id, v.approve, v.reason),
    onSuccess: (_result, v) => {
      toast(t(v.approve ? 'staff.checklists.recipeChange.approved' : 'staff.checklists.recipeChange.declined'), 'success');
      setReason('');
      setReasonIssue(null);
      refreshPages();
      // An approved change rewrites the recipe the names page lists.
      if (v.approve) void queryClient.invalidateQueries({ queryKey: staffKeys.recipes(venue, 'all') });
    },
    onError: (err) => {
      setDecideError(t(mapStaffError(err)));
      refreshPages();
    },
  });

  const open = (id: string | null) => {
    setSelectedId(id);
    setDecideError(null);
    setReason('');
    setReasonIssue(null);
  };

  const confirmWithdraw = (id: string) =>
    Alert.alert(t('staff.checklists.recipeChange.withdrawTitle'), t('staff.checklists.recipeChange.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.checklists.recipeChange.withdraw'),
        style: 'destructive',
        onPress: () => withdraw.mutate(id),
      },
    ]);

  const confirmApprove = (id: string) =>
    Alert.alert(t('staff.checklists.recipeChange.approveTitle'), t('staff.checklists.recipeChange.approveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.checklists.recipeChange.approve'),
        onPress: () => decide.mutate({ id, approve: true, reason: null }),
      },
    ]);

  const onDecline = (id: string) => {
    setDecideError(null);
    const found = declineIssue(reason);
    setReasonIssue(found);
    if (!found) decide.mutate({ id, approve: false, reason: reason.trim() });
  };

  // ── Pieces ─────────────────────────────────────────────────────────────
  const qtyText = (qty: number | null, unit: StockUnit | null) =>
    qty === null
      ? t('staff.checklists.recipeChange.none')
      : unit
        ? t('staff.checklists.qty', { qty: formatNumber(qty, locale), unit: t(`staff.checklists.units.${unit}`) })
        : formatNumber(qty, locale);
  const dateOf = (iso: string) => formatDate(new Date(iso), locale);
  const small = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut };
  const strong = { fontFamily: fonts.body700, fontSize: 14, lineHeight: 20, color: colors.ink };

  const amountLabel = (ingredientId: string) => {
    const unit = unitOf(ingredientId);
    return unit
      ? t('staff.checklists.recipeChange.amount', { unit: t(`staff.checklists.units.${unit}`) })
      : t('staff.checklists.recipeChange.amountNoUnit');
  };
  const qtyError = (index: number): string | null =>
    issues.some((i) => i.field === 'qty' && i.index === index) ? t('staff.checklists.recipeChange.errors.qty') : null;
  const ingredientError = (index: number): string | null => {
    const issue = issues.find((i) => i.field === 'ingredient' && i.index === index);
    return issue && issue.field === 'ingredient' ? t(`staff.checklists.recipeChange.errors.${issue.code}`) : null;
  };
  const draftError = (): string | null => {
    const ops = issues.find((i) => i.field === 'ops');
    if (ops && ops.field === 'ops') {
      return t(
        ops.code === 'required'
          ? 'staff.checklists.recipeChange.errors.ops'
          : ops.code === 'tooMany'
            ? 'staff.checklists.recipeChange.errors.tooMany'
            : 'staff.checklists.recipeChange.errors.emptyResult',
      );
    }
    return error;
  };

  const pickList = () => {
    if (venue === '') return null;
    if (view.isPending) return <SkeletonList rows={3} height={44} />;
    if (view.isError) {
      return (
        <ErrorState
          testID="staff-recipe-change.recipes-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(view.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void view.refetch()}
        />
      );
    }
    const q = targetQuery.trim().toLocaleLowerCase();
    const shown = targets
      .filter(
        (x) =>
          !q ||
          [x.name_en, x.name_ar, x.size_en, x.size_ar].some(
            (s) => typeof s === 'string' && s.toLocaleLowerCase().includes(q),
          ),
      )
      .slice(0, 40);
    return (
      <>
        <Field
          testID="staff-recipe-change.target-search"
          label={t('staff.checklists.recipeChange.searchRecipe')}
          value={targetQuery}
          onChangeText={setTargetQuery}
          autoCorrect={false}
          dense
        />
        {shown.length === 0 ? <Hint>{t('staff.checklists.recipes.noMatch')}</Hint> : null}
        {shown.map((x) => (
          <Pressable
            key={`${x.kind}.${x.id}`}
            testID={`staff-recipe-change.target.${x.id}`}
            accessibilityRole="button"
            onPress={() => pickTarget(x.kind, x.id)}
            style={({ pressed }) => ({
              paddingTop: space.s,
              paddingBottom: space.s,
              borderBottomWidth: 1,
              borderBottomColor: colors.sub,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={strong}>{targetLabel(x, locale)}</Text>
            {x.kind === 'output' ? <Text style={small}>{t('staff.checklists.recipeChange.prepared')}</Text> : null}
          </Pressable>
        ))}
      </>
    );
  };

  const draftCard = () => (
    <Card style={{ padding: space.m, gap: space.s }}>
      <MicroLabel>{t('staff.checklists.recipeChange.newTitle')}</MicroLabel>
      {target ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
          <View style={{ flex: 1 }}>
            <Text style={small}>{t('staff.checklists.recipeChange.recipe')}</Text>
            <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>
              {targetLabel(target, locale)}
            </Text>
          </View>
          <LinkText
            testID="staff-recipe-change.target.change"
            label={t('staff.checklists.recipeChange.changeTarget')}
            onPress={() => change(emptyRecipeDraft())}
          />
        </View>
      ) : (
        <>
          <Text style={strong}>{t('staff.checklists.recipeChange.pickRecipe')}</Text>
          {issues.some((i) => i.field === 'target') ? (
            <ErrorText>{t('staff.checklists.recipeChange.errors.target')}</ErrorText>
          ) : null}
          {pickList()}
        </>
      )}

      {target ? (
        <>
          <Text style={[strong, { marginTop: space.xs }]}>{t('staff.checklists.recipeChange.current')}</Text>
          {target.lines.length === 0 ? <Hint style={{ marginTop: 0 }}>{t('staff.checklists.recipes.noLines')}</Hint> : null}
          {target.lines.map((line) => {
            const op = lineOp(draft, line.recipe_line_id);
            const index = op ? draft.ops.indexOf(op) : -1;
            return (
              <View
                key={line.recipe_line_id}
                style={{ paddingTop: space.s, paddingBottom: space.s, borderTopWidth: 1, borderTopColor: colors.sub, gap: 6 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
                  <Text style={[strong, { flexShrink: 1 }]}>{localName(line, locale)}</Text>
                  {op?.op === 'remove' ? <Tag tone="bad" label={t('staff.checklists.recipeChange.removing')} /> : null}
                </View>
                {op ? (
                  <View testID={`staff-recipe-change.op.${index}`} style={{ gap: 6 }}>
                    {op.op === 'set' ? (
                      <Field
                        testID={`staff-recipe-change.op.${index}.qty`}
                        label={amountLabel(line.ingredient_id)}
                        value={op.qty}
                        onChangeText={(qty) => change(withQty(draft, index, qty))}
                        keyboardType="decimal-pad"
                        latin
                        dense
                        error={qtyError(index)}
                      />
                    ) : null}
                    <Button
                      testID={`staff-recipe-change.op.${index}.remove`}
                      label={t('staff.checklists.recipeChange.keep')}
                      variant="ghost"
                      onPress={() => change(withLineOp(draft, line, null))}
                      style={{ alignSelf: 'flex-start' }}
                    />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: space.s }}>
                    <Button
                      testID={`staff-recipe-change.line.${line.recipe_line_id}.set`}
                      label={t('staff.checklists.recipeChange.set')}
                      variant="secondary"
                      size="compact"
                      onPress={() => change(withLineOp(draft, line, 'set'))}
                    />
                    <Button
                      testID={`staff-recipe-change.line.${line.recipe_line_id}.remove`}
                      label={t('staff.checklists.recipeChange.remove')}
                      variant="dangerOutline"
                      size="compact"
                      onPress={() => change(withLineOp(draft, line, 'remove'))}
                    />
                  </View>
                )}
              </View>
            );
          })}

          {draft.ops.map((op, index) =>
            op.op === 'add' ? (
              <View
                key={`add.${op.ingredientId}`}
                testID={`staff-recipe-change.op.${index}`}
                style={{ paddingTop: space.s, borderTopWidth: 1, borderTopColor: colors.sub, gap: 6 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
                  <Text style={[strong, { flexShrink: 1 }]}>{ingredientName(op.ingredientId)}</Text>
                  <Tag tone="good" label={t('staff.checklists.recipeChange.adding')} />
                </View>
                <Field
                  testID={`staff-recipe-change.op.${index}.qty`}
                  label={amountLabel(op.ingredientId)}
                  value={op.qty}
                  onChangeText={(qty) => change(withQty(draft, index, qty))}
                  keyboardType="decimal-pad"
                  latin
                  dense
                  error={qtyError(index)}
                />
                {ingredientError(index) ? <ErrorText>{ingredientError(index)}</ErrorText> : null}
                <Button
                  testID={`staff-recipe-change.op.${index}.remove`}
                  label={t('staff.checklists.recipeChange.dontAdd')}
                  variant="ghost"
                  onPress={() => change(withoutOp(draft, index))}
                  style={{ alignSelf: 'flex-start' }}
                />
              </View>
            ) : null,
          )}

          {adding ? (
            <View style={{ gap: space.s, padding: space.sm, borderRadius: radius.cell, backgroundColor: colors.sub }}>
              <Field
                testID="staff-recipe-change.ingredient-search"
                label={t('staff.checklists.recipeChange.searchIngredient')}
                value={ingredientQuery}
                onChangeText={setIngredientQuery}
                autoCorrect={false}
                dense
              />
              {options.isError ? <ErrorText>{t(mapStaffError(options.error))}</ErrorText> : null}
              {(() => {
                const addable = addableIngredients(ingredientList, target, draft, ingredientQuery).slice(0, 30);
                if (options.isPending) return <SkeletonList rows={2} height={36} />;
                if (addable.length === 0) return <Hint style={{ marginTop: 0 }}>{t('staff.checklists.recipeChange.noIngredients')}</Hint>;
                return addable.map((o) => (
                  <Pressable
                    key={o.id}
                    testID={`staff-recipe-change.ingredient.${o.id}`}
                    accessibilityRole="button"
                    onPress={() => {
                      change(withAdded(draft, o.id));
                      setAdding(false);
                      setIngredientQuery('');
                    }}
                    style={({ pressed }) => ({ paddingTop: 6, paddingBottom: 6, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={strong}>{localName(o, locale)}</Text>
                  </Pressable>
                ));
              })()}
              <Button
                testID="staff-recipe-change.ingredient-cancel"
                label={t('common.cancel')}
                variant="ghost"
                onPress={() => setAdding(false)}
                style={{ alignSelf: 'flex-start' }}
              />
            </View>
          ) : (
            <Button
              testID="staff-recipe-change.op.add"
              label={t('staff.checklists.recipeChange.addLine')}
              variant="secondary"
              size="compact"
              onPress={() => setAdding(true)}
              style={{ alignSelf: 'flex-start' }}
            />
          )}

          <Field
            testID="staff-recipe-change.note"
            label={t('staff.checklists.recipeChange.note')}
            value={draft.note}
            onChangeText={(note) => change({ ...draft, note })}
            multiline
            maxLength={NOTE_MAX}
            error={issues.some((i) => i.field === 'note') ? t('staff.checklists.recipeChange.errors.note') : null}
          />
        </>
      ) : null}
      <ErrorText>{draftError()}</ErrorText>
      <Button
        testID="staff-recipe-change.submit"
        label={t('staff.checklists.recipeChange.submit')}
        variant="primary"
        busy={send.isPending}
        disabled={venue === ''}
        onPress={onSend}
      />
      <Hint style={{ marginTop: 0 }}>{t('staff.checklists.recipes.askChangeHint')}</Hint>
    </Card>
  );

  const requestRow = (
    id: string,
    label: string,
    by: string,
    rowStatus: RecipeChangeStatus,
    last: boolean,
  ) => (
    <Pressable
      key={id}
      testID={`staff-recipe-change.request.${id}`}
      accessibilityRole="button"
      onPress={() => open(id)}
      style={({ pressed }) => ({
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        gap: 4,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
        backgroundColor: pressed ? colors.sub : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
        <Text style={[strong, { flexShrink: 1 }]}>{label}</Text>
        <Tag tone={STATUS_TONE[rowStatus]} label={t(`work.recipeChange.status.${rowStatus}`)} />
      </View>
      <Text style={small}>{by}</Text>
    </Pressable>
  );

  const myLabel = (r: MyRecipeChange) =>
    targetLabel({ name_en: r.item_name_en, name_ar: r.item_name_ar, size_en: r.size_name_en, size_ar: r.size_name_ar }, locale);
  const rowLabel = (r: RecipeChangeRow) =>
    targetLabel({ name_en: r.item_name_en, name_ar: r.item_name_ar, size_en: r.size_name_en, size_ar: r.size_name_ar }, locale);

  const myList = () => {
    if (venue === '') return null;
    if (mine.isPending) return <SkeletonList rows={2} height={60} />;
    if (mine.isError) {
      return (
        <ErrorState
          testID="staff-recipe-change.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(mine.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void mine.refetch()}
        />
      );
    }
    const rows = mine.data ?? [];
    if (rows.length === 0) return <Hint>{t('staff.checklists.recipeChange.emptyMine')}</Hint>;
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((r, i) =>
          requestRow(r.id, myLabel(r), t('staff.checklists.recipeChange.sentOn', { date: dateOf(r.requested_at) }), r.status, i === rows.length - 1),
        )}
      </Card>
    );
  };

  const pageList = () => {
    if (venue === '') return null;
    if (page.isPending) return <SkeletonList rows={3} height={60} />;
    if (page.isError) {
      return (
        <ErrorState
          testID="staff-recipe-change.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(page.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void page.refetch()}
        />
      );
    }
    const rows = page.data?.requests ?? [];
    if (rows.length === 0) return <Hint>{t('staff.checklists.recipeChange.emptyList')}</Hint>;
    return (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((r, i) =>
          requestRow(
            r.id,
            rowLabel(r),
            t('staff.checklists.recipeChange.requestedBy', {
              name: isolate(r.requested_by_name ?? ''),
              date: dateOf(r.requested_at),
            }),
            r.status,
            i === rows.length - 1,
          ),
        )}
      </Card>
    );
  };

  // ── One request ───────────────────────────────────────────────────────
  const decidedLine = (r: { status: RecipeChangeStatus; decided_by_name: string | null; decided_at: string | null; decline_reason: string | null }) => (
    <>
      {r.decided_at ? (
        <Text style={small}>
          {t('staff.checklists.recipeChange.decidedBy', {
            status: t(`work.recipeChange.status.${r.status}`),
            name: isolate(r.decided_by_name ?? ''),
            date: dateOf(r.decided_at),
          })}
        </Text>
      ) : null}
      {r.decline_reason ? (
        <Text style={[small, { color: colors.mut2 }]}>
          {t('staff.checklists.recipeChange.reasonLine', { reason: isolate(r.decline_reason) })}
        </Text>
      ) : null}
    </>
  );

  const myDetail = (r: MyRecipeChange) => (
    <Card style={{ padding: space.m, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
        <Text style={{ flexShrink: 1, fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>{myLabel(r)}</Text>
        <Tag tone={STATUS_TONE[r.status]} label={t(`work.recipeChange.status.${r.status}`)} />
      </View>
      <Text style={small}>{t('staff.checklists.recipeChange.sentOn', { date: dateOf(r.requested_at) })}</Text>
      {r.ops.map((op, i) => {
        const name = localName({ name_en: op.name_en ?? '', name_ar: op.name_ar ?? '' }, locale);
        return (
          <Text key={i} style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 20, color: colors.ink }}>
            {op.op === 'remove'
              ? t('staff.checklists.recipeChange.op.remove', { name })
              : t(`staff.checklists.recipeChange.op.${op.op}`, { name, qty: qtyText(op.qty, op.unit) })}
          </Text>
        );
      })}
      {r.note ? (
        <Text style={[small, { color: colors.mut2 }]}>
          {t('staff.checklists.recipeChange.noteLine', { note: isolate(r.note) })}
        </Text>
      ) : null}
      {decidedLine(r)}
      <ErrorText>{decideError}</ErrorText>
      {r.status === 'waiting' ? (
        <Button
          testID="staff-recipe-change.withdraw"
          label={t('staff.checklists.recipeChange.withdraw')}
          variant="dangerOutline"
          size="compact"
          busy={withdraw.isPending}
          onPress={() => confirmWithdraw(r.id)}
        />
      ) : null}
    </Card>
  );

  const mgmtDetail = (r: RecipeChangeRow) => {
    const lines = changeLines(r);
    return (
      <Card style={{ padding: space.m, gap: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
          <Text style={{ flexShrink: 1, fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>{rowLabel(r)}</Text>
          <Tag tone={STATUS_TONE[r.status]} label={t(`work.recipeChange.status.${r.status}`)} />
        </View>
        <Text style={small}>
          {t('staff.checklists.recipeChange.requestedBy', {
            name: isolate(r.requested_by_name ?? ''),
            date: dateOf(r.requested_at),
          })}
        </Text>
        {r.note ? (
          <Text style={[small, { color: colors.mut2 }]}>
            {t('staff.checklists.recipeChange.noteLine', { note: isolate(r.note) })}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
          <Text style={[small, { flex: 2 }]} />
          <Text style={[small, { flex: 1, fontFamily: fonts.body700 }]}>{t('staff.checklists.recipeChange.before')}</Text>
          <Text style={[small, { flex: 1, fontFamily: fonts.body700 }]}>{t('staff.checklists.recipeChange.after')}</Text>
        </View>
        {lines.map((l) => {
          const changed = l.before !== l.after;
          return (
            <View key={l.ingredient_id} style={{ flexDirection: 'row', gap: space.s }}>
              <Text style={{ flex: 2, fontFamily: changed ? fonts.body700 : fonts.body400, fontSize: 13, color: colors.ink }}>
                {localName({ name_en: l.name_en ?? '', name_ar: l.name_ar ?? '' }, locale)}
              </Text>
              <Text style={{ flex: 1, fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
                {qtyText(l.before, l.unit)}
              </Text>
              <Text style={{ flex: 1, fontFamily: changed ? fonts.body700 : fonts.body400, fontSize: 13, color: changed ? colors.ink : colors.mut }}>
                {qtyText(l.after, l.unit)}
              </Text>
            </View>
          );
        })}
        {r.stale ? (
          <View style={{ padding: space.sm, borderRadius: radius.cell, backgroundColor: colors.amb, borderWidth: 1, borderColor: colors.ambline }}>
            <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 18, color: colors.ambtext }}>
              {t('staff.checklists.recipeChange.stale')}
            </Text>
          </View>
        ) : null}
        {decidedLine(r)}
        <ErrorText>{decideError}</ErrorText>
        {r.status === 'waiting' && owner ? (
          <>
            <Button
              testID="staff-recipe-change.approve"
              label={t('staff.checklists.recipeChange.approve')}
              variant="primary"
              disabled={!canApprove(r) || decide.isPending}
              busy={decide.isPending && decide.variables?.approve === true}
              onPress={() => confirmApprove(r.id)}
            />
            <Field
              testID="staff-recipe-change.reason"
              label={t('staff.checklists.recipeChange.reason')}
              value={reason}
              onChangeText={(text) => {
                setReason(text);
                setReasonIssue(null);
              }}
              multiline
              maxLength={REASON_MAX}
              error={reasonIssue ? t('staff.checklists.recipeChange.errors.reason') : null}
            />
            <Button
              testID="staff-recipe-change.decline"
              label={t('staff.checklists.recipeChange.decline')}
              variant="dangerOutline"
              size="compact"
              disabled={decide.isPending}
              busy={decide.isPending && decide.variables?.approve === false}
              onPress={() => onDecline(r.id)}
            />
          </>
        ) : null}
        {r.status === 'waiting' && !owner ? <Hint style={{ marginTop: 0 }}>{t('staff.checklists.recipeChange.ownerDecides')}</Hint> : null}
      </Card>
    );
  };

  const detail = () => {
    if (!selectedId) return null;
    const query = head ? mine : page;
    const r = head
      ? (mine.data ?? []).find((x) => x.id === selectedId)
      : (page.data?.requests ?? []).find((x) => x.id === selectedId);
    return (
      <>
        <LinkText
          testID="staff-recipe-change.back"
          label={t('staff.checklists.recipeChange.backToList')}
          onPress={() => open(null)}
        />
        {query.isPending ? (
          <SkeletonList rows={1} height={160} />
        ) : !r ? (
          <Hint>{t('staff.checklists.recipeChange.gone')}</Hint>
        ) : head ? (
          myDetail(r as MyRecipeChange)
        ) : (
          mgmtDetail(r as RecipeChangeRow)
        )}
      </>
    );
  };

  const lead = head
    ? 'staff.checklists.recipeChange.lead'
    : owner
      ? 'staff.checklists.recipeChange.leadOwner'
      : 'staff.checklists.recipeChange.leadManager';

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.recipeChange.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>{t(lead)}</Text>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {selectedId ? (
          detail()
        ) : head ? (
          <>
            {draftCard()}
            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.checklists.recipeChange.mine')}</MicroLabel>
            {myList()}
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingStart: 4, paddingEnd: 4 }}>
              <MicroLabel>{t('staff.checklists.recipeChange.listTitle')}</MicroLabel>
              {page.data && page.data.waiting_count > 0 ? (
                <Tag tone="warn" label={t('staff.checklists.recipeChange.waitingCount', { count: page.data.waiting_count })} />
              ) : null}
            </View>
            <SegmentedControl<RecipeChangeFilter>
              testID="staff-recipe-change.filter"
              options={RECIPE_CHANGE_FILTERS.map((f) => ({ value: f, label: t(`staff.checklists.recipeChange.filter.${f}`) }))}
              value={filter}
              onChange={setFilter}
            />
            {pageList()}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

export default function StaffRecipeChangeRoute() {
  return (
    <RequireStaff roles={RECIPE_CHANGE_ROLES}>
      <RecipeChangeScreen />
    </RequireStaff>
  );
}
