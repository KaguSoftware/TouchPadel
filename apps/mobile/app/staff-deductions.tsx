import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseTypedAmount, parseTypedDate, type StaffRole } from '@touch/core';
import { formatDate, formatIQD, formatMonthYear, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Hint,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { BackChevronIcon, ChevronIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import {
  GroupLabel,
  Lead,
  MULTILINE_BOX,
  MULTILINE_TEXT,
  Tag,
} from '../src/features/staff/checklists/parts';
import { ListCard } from '../src/features/staff/protocols/parts';
import { PickList, type PickOption } from '../src/features/staff/marketing/PickList';
import { namedFirst } from '../src/features/staff/marketing/logic';
import { intentFor } from '../src/features/staff/supplies/logic';
import {
  fetchDeductionTargets,
  fetchDeductionsWaiting,
  fetchMyDeductionProposals,
  fetchMyDeductions,
  proposeDeduction,
  withdrawDeduction,
} from '../src/features/staff/deductions/api';
import {
  DEDUCTION_CAPS,
  DEDUCTION_TONE,
  canWithdraw,
  deductionArgs,
  decidedByManagerOnly,
  deductionsAccess,
  emptyDeductionDraft,
  initialView,
  monthOf,
  shiftMonth,
  stepMonth,
  validateDeduction,
  venueBusinessToday,
  type DeductionDraft,
  type DeductionField,
  type DeductionIssue,
  type DeductionsView,
} from '../src/features/staff/deductions/logic';

/**
 * Pay deductions (wave5-addendum-2026-09-25 §2.5, §5.3; migration 0197).
 *
 *   head_barista, head_chef   propose one for a member of their own team,
 *                             follow their proposals, withdraw a waiting one
 *   manager, owner            the same for anyone at the venue but themselves
 *                             and the owners, and a line with how many wait:
 *                             deciding is on the operator only (§8 Q8)
 *   everyone                  "Your deductions": their own approved and cancelled
 *                             deductions by the month they count in, with no
 *                             proposer, note or cancel reason (§2.5.2)
 *
 * `?view=mine` (the requests page's "My deductions" row) opens on their own;
 * `?id=` is a deduction a link named, listed first and marked. Amounts never
 * leave this page: no push carries one (§2.3).
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

/** A month's first day, `YYYY-MM-01`, as "September 2026" in the reader's language. */
function monthLabel(month: string, locale: 'en' | 'ar'): string {
  return formatMonthYear(new Date(`${month}T12:00:00Z`), locale);
}

function DeductionsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ view?: string; id?: string }>();

  const role: StaffRole = status.kind === 'staff' ? status.staff.role : 'cashier';
  const access = deductionsAccess(role);
  const venue = venueId ?? '';
  // The venue's business day, which propose_deduction checks the date against.
  const today = venueBusinessToday();
  // An owner's proposal goes to a manager: nobody decides their own (0197).
  const managerDecides = decidedByManagerOnly(role);

  const [view, setView] = useState<DeductionsView>(() => initialView(role, params.view));
  const [formOpen, setFormOpen] = useState(false);

  // ── Reads ──────────────────────────────────────────────────────────────────
  const proposals = useQuery({
    queryKey: staffKeys.myDeductionProposals(venue),
    queryFn: () => fetchMyDeductionProposals(venue),
    enabled: venue !== '' && access.proposes && view === 'propose',
  });
  const targets = useQuery({
    queryKey: staffKeys.deductionTargets(venue),
    queryFn: () => fetchDeductionTargets(venue),
    enabled: venue !== '' && access.proposes && formOpen,
  });
  const waiting = useQuery({
    queryKey: staffKeys.deductionsWaiting(venue),
    queryFn: () => fetchDeductionsWaiting(venue),
    enabled: venue !== '' && access.mgmt,
  });

  // `month` null is the venue's current month, the RPC's own default. That
  // read stays on while an earlier month shows: the month it answers with is
  // where Next stops (the phone's calendar only stands in until it answers).
  const [month, setMonth] = useState<string | null>(null);
  const current = useQuery({
    queryKey: staffKeys.myDeductions(venue, 'current'),
    queryFn: () => fetchMyDeductions(venue, null),
    enabled: venue !== '' && view === 'mine',
  });
  const earlier = useQuery({
    queryKey: staffKeys.myDeductions(venue, month ?? 'current'),
    queryFn: () => fetchMyDeductions(venue, month),
    enabled: venue !== '' && view === 'mine' && month !== null,
  });
  const mine = month === null ? current : earlier;
  const currentMonth = current.data?.month ?? monthOf(today);
  const shownMonth = mine.data?.month ?? month ?? currentMonth;

  const pull = usePullRefresh(() =>
    Promise.all([
      access.mgmt ? waiting.refetch() : null,
      view === 'propose' ? proposals.refetch() : mine.refetch(),
    ]),
  );

  const targetOptions: PickOption[] = useMemo(
    () =>
      (targets.data?.staff ?? []).map((s) => ({
        id: s.id,
        label: s.display_name,
        detail: t(`op.roles.${s.role as StaffRole}`),
      })),
    [targets.data, t],
  );

  // ── Propose ────────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<DeductionDraft>(() => emptyDeductionDraft(today));
  const [issues, setIssues] = useState<DeductionIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<DeductionDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const closeForm = () => {
    setFormOpen(false);
    setDraft(emptyDeductionDraft(today));
    setIssues([]);
    setError(null);
  };

  const propose = useMutation({
    mutationKey: staffKeys.mutation('deduction'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof deductionArgs>; intent: string }) =>
      proposeDeduction(args, staffIntentKey(intent, 'deduction')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(
        t(managerDecides ? 'staff.deductions.propose.sentOwner' : 'staff.deductions.propose.sent'),
        'success',
      );
      closeForm();
      void queryClient.invalidateQueries({ queryKey: staffKeys.myDeductionProposals(venue) });
      void queryClient.invalidateQueries({ queryKey: staffKeys.deductionsWaiting(venue) });
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onPropose = () => {
    setError(null);
    const found = validateDeduction(draft, today);
    setIssues(found);
    if (found.length > 0 || !venue) return;
    const args = deductionArgs(draft, venue);
    propose.mutate({ args, intent: intentFor('deduction.propose', args) });
  };

  const fieldError = (field: DeductionField): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    const keys: Record<DeductionField, MessageKey> = {
      staffId: 'staff.deductions.propose.errors.who',
      amount:
        issue.code === 'tooMuch'
          ? 'staff.deductions.propose.errors.amountTooMuch'
          : 'staff.deductions.propose.errors.amount',
      date:
        issue.code === 'future'
          ? 'staff.deductions.propose.errors.future'
          : issue.code === 'tooOld'
            ? 'staff.deductions.propose.errors.tooOld'
            : 'staff.deductions.propose.errors.date',
      reason:
        issue.code === 'tooLong'
          ? 'staff.deductions.propose.errors.reasonTooLong'
          : 'staff.deductions.propose.errors.reason',
    };
    return t(keys[field], { example: isolate(today) });
  };

  // ── Withdraw ───────────────────────────────────────────────────────────────
  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('deduction.withdraw'),
    mutationFn: (id: string) => withdrawDeduction(id),
    onSuccess: () => {
      toast(t('staff.deductions.proposals.withdrawn'), 'info');
      void queryClient.invalidateQueries({ queryKey: staffKeys.myDeductionProposals(venue) });
      void queryClient.invalidateQueries({ queryKey: staffKeys.deductionsWaiting(venue) });
    },
    onError: (err) => {
      toast(t(mapStaffError(err)), 'error');
      void queryClient.invalidateQueries({ queryKey: staffKeys.myDeductionProposals(venue) });
    },
  });

  const confirmWithdraw = (id: string) =>
    Alert.alert(
      t('staff.deductions.proposals.withdrawTitle'),
      t('staff.deductions.proposals.withdrawBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('staff.deductions.proposals.withdraw'),
          style: 'destructive',
          onPress: () => withdraw.mutate(id),
        },
      ],
    );

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const small = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut };
  const strong = { fontFamily: fonts.body700, fontSize: 14, color: colors.ink };

  const loadError = (testID: string, query: { error: unknown; refetch: () => unknown }) => (
    <ErrorState
      testID={testID}
      title={t('errors.loadFailedTitle')}
      message={t(mapStaffError(query.error))}
      retryLabel={t('common.retry')}
      onRetry={() => void query.refetch()}
    />
  );

  const rowStyle = (id: string, last: boolean) => ({
    padding: space.m,
    gap: 4,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: colors.sub,
    // The deduction a link named is listed first and marked.
    backgroundColor: id === params.id ? colors.tint : 'transparent',
  });

  const chosen = targetOptions.find((o) => o.id === draft.staffId);
  const amountPreview = parseTypedAmount(draft.amount);
  const datePreview = parseTypedDate(draft.date);
  const waitingCount = waiting.data?.waiting_count ?? 0;

  // ── For your team ──────────────────────────────────────────────────────────
  const proposeView = (
    <>
      <Lead>
        {t(
          managerDecides
            ? 'staff.deductions.propose.leadOwner'
            : access.mgmt
              ? 'staff.deductions.propose.leadMgmt'
              : 'staff.deductions.propose.lead',
        )}
      </Lead>
      {formOpen ? (
        <Card style={{ padding: space.m, gap: space.s }}>
          <Text
            accessibilityRole="header"
            style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: colors.ink }}
          >
            {t('staff.deductions.propose.title')}
          </Text>
          <GroupLabel>{t('staff.deductions.propose.who')}</GroupLabel>
          {targets.isError ? (
            loadError('staff-deductions.targets-error', targets)
          ) : !targets.isPending && targetOptions.length === 0 ? (
            <Hint style={{ marginTop: 0 }}>{t('staff.deductions.propose.noTargets')}</Hint>
          ) : (
            <PickList
              testID="staff-deductions.target"
              options={targetOptions}
              loading={targets.isPending}
              value={draft.staffId}
              onChange={(staffId) => edit({ staffId })}
              error={fieldError('staffId')}
            />
          )}
          <Field
            testID="staff-deductions.amount"
            label={t('staff.deductions.propose.amount')}
            value={draft.amount}
            onChangeText={(amount) => edit({ amount })}
            keyboardType="number-pad"
            latin
            error={fieldError('amount')}
          />
          {amountPreview !== null && amountPreview <= DEDUCTION_CAPS.amountMax ? (
            <Hint style={{ marginTop: 0 }}>{formatIQD(amountPreview, locale)}</Hint>
          ) : null}
          <Field
            testID="staff-deductions.date"
            label={t('staff.deductions.propose.date')}
            value={draft.date}
            onChangeText={(date) => edit({ date })}
            keyboardType="numbers-and-punctuation"
            latin
            error={fieldError('date')}
          />
          <Hint style={{ marginTop: 0 }}>
            {datePreview
              ? dayLabel(datePreview, locale)
              : t('staff.deductions.propose.dateHint', { example: isolate(today) })}
          </Hint>
          <Field
            testID="staff-deductions.reason"
            label={t('staff.deductions.propose.reason')}
            value={draft.reason}
            onChangeText={(reason) => edit({ reason })}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            maxLength={DEDUCTION_CAPS.reason}
            error={fieldError('reason')}
          />
          {/* What happens next, said before the send: who decides, and that
              the person never learns who proposed it (§2.5.2). */}
          <Text style={{ ...body, marginTop: space.xs }}>
            {chosen
              ? t(
                  managerDecides
                    ? 'staff.deductions.propose.consequenceOwner'
                    : 'staff.deductions.propose.consequence',
                  { name: isolate(chosen.label) },
                )
              : t(
                  managerDecides
                    ? 'staff.deductions.propose.consequenceAnyoneOwner'
                    : 'staff.deductions.propose.consequenceAnyone',
                )}
          </Text>
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              testID="staff-deductions.submit"
              label={t('staff.deductions.propose.submit')}
              variant="primary"
              size="compact"
              busy={propose.isPending}
              onPress={onPropose}
              style={{ flex: 1 }}
            />
            <Button
              testID="staff-deductions.cancel"
              label={t('staff.deductions.propose.cancel')}
              variant="secondary"
              size="compact"
              disabled={propose.isPending}
              onPress={closeForm}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : (
        <Button
          testID="staff-deductions.propose"
          label={t('staff.deductions.propose.open')}
          variant="primary"
          disabled={venue === ''}
          onPress={() => {
            setDraft(emptyDeductionDraft(today));
            setFormOpen(true);
          }}
        />
      )}

      <MicroLabel style={{ paddingStart: 4, marginTop: space.m }}>
        {t('staff.deductions.proposals.title')}
      </MicroLabel>
      {proposals.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={88} />
      ) : proposals.isError ? (
        loadError('staff-deductions.proposals-error', proposals)
      ) : (proposals.data?.proposals ?? []).length === 0 ? (
        <Hint>{t('staff.deductions.proposals.empty')}</Hint>
      ) : (
        <ListCard>
          {namedFirst(proposals.data?.proposals ?? [], params.id).map((p, i, all) => (
            <View
              key={p.id}
              testID={`staff-deductions.item.${p.id}`}
              style={rowStyle(p.id, i === all.length - 1)}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: space.s,
                }}
              >
                <Text style={{ ...strong, flexShrink: 1 }}>
                  {t('staff.deductions.proposals.person', {
                    name: isolate(p.staff_name),
                    role: t(`op.roles.${p.staff_role as StaffRole}`),
                  })}
                </Text>
                <Tag
                  tone={DEDUCTION_TONE[p.status]}
                  label={t(`work.deduction.status.${p.status}`)}
                />
              </View>
              <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.ink }}>
                {formatIQD(p.amount_iqd, locale)}
              </Text>
              <Text style={small}>
                {t('staff.deductions.proposals.happened', {
                  day: dayLabel(p.deduction_date, locale),
                })}
              </Text>
              <Text style={body}>{p.reason}</Text>
              {p.decision_note ? (
                <Text style={{ ...body, color: colors.ink }}>
                  {t('staff.deductions.proposals.note', { note: isolate(p.decision_note) })}
                </Text>
              ) : null}
              {canWithdraw(p) ? (
                <Button
                  testID={`staff-deductions.withdraw.${p.id}`}
                  label={t('staff.deductions.proposals.withdraw')}
                  variant="ghost"
                  busy={withdraw.isPending && withdraw.variables === p.id}
                  onPress={() => confirmWithdraw(p.id)}
                  style={{ alignSelf: 'flex-start', marginTop: 2 }}
                />
              ) : null}
            </View>
          ))}
        </ListCard>
      )}
    </>
  );

  // ── Yours ──────────────────────────────────────────────────────────────────
  const atCurrent = month === null || shownMonth >= currentMonth;
  const stepper = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.s,
      }}
    >
      <Pressable
        testID="staff-deductions.month.prev"
        accessibilityRole="button"
        accessibilityLabel={t('staff.deductions.mine.prev')}
        onPress={() => setMonth(shiftMonth(shownMonth, -1))}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: radius.cell,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: pressed ? colors.sub : colors.card,
        })}
      >
        <BackChevronIcon size={18} color={colors.ink} />
      </Pressable>
      <Text
        accessibilityRole="header"
        style={{ fontFamily: fonts.body700, fontSize: 16, color: colors.ink }}
      >
        {monthLabel(shownMonth, locale)}
      </Text>
      <Pressable
        testID="staff-deductions.month.next"
        accessibilityRole="button"
        accessibilityLabel={t('staff.deductions.mine.next')}
        accessibilityState={{ disabled: atCurrent }}
        disabled={atCurrent}
        onPress={() => setMonth(stepMonth(shownMonth, currentMonth, 1))}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: radius.cell,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: pressed ? colors.sub : colors.card,
          opacity: atCurrent ? 0.4 : 1,
        })}
      >
        <ChevronIcon size={18} color={colors.ink} />
      </Pressable>
    </View>
  );

  const mineRows = namedFirst(mine.data?.deductions ?? [], params.id);
  const mineView = (
    <>
      <Lead>{t('staff.deductions.mine.lead')}</Lead>
      {stepper}
      {mine.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={72} />
      ) : mine.isError ? (
        loadError('staff-deductions.mine-error', mine)
      ) : mineRows.length === 0 ? (
        <Hint>{t('staff.deductions.mine.empty', { month: monthLabel(shownMonth, locale) })}</Hint>
      ) : (
        <>
          {/* The month's one figure: what was approved to come off pay. */}
          <View style={{ gap: 2, paddingStart: 4, marginTop: space.xs }}>
            <MicroLabel>
              {t('staff.deductions.mine.total', { month: monthLabel(shownMonth, locale) })}
            </MicroLabel>
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: 24,
                lineHeight: 30,
                color: colors.ink,
              }}
            >
              {formatIQD(mine.data?.total_iqd ?? 0, locale)}
            </Text>
          </View>
          <ListCard>
            {mineRows.map((d, i) => (
              <View
                key={d.id}
                testID={`staff-deductions.item.${d.id}`}
                style={rowStyle(d.id, i === mineRows.length - 1)}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: space.s,
                  }}
                >
                  <Text
                    style={{
                      ...strong,
                      fontSize: 15,
                      color: d.status === 'cancelled' ? colors.mut : colors.ink,
                      textDecorationLine: d.status === 'cancelled' ? 'line-through' : 'none',
                    }}
                  >
                    {formatIQD(d.amount_iqd, locale)}
                  </Text>
                  <Tag
                    tone={DEDUCTION_TONE[d.status]}
                    label={t(`work.deduction.status.${d.status}`)}
                  />
                </View>
                <Text style={small}>
                  {d.dated_earlier
                    ? t('staff.deductions.mine.datedEarlier', {
                        happened: monthLabel(monthOf(d.deduction_date), locale),
                        counted: monthLabel(shownMonth, locale),
                      })
                    : t('staff.deductions.mine.happened', {
                        day: dayLabel(d.deduction_date, locale),
                      })}
                </Text>
                <Text style={body}>{d.reason}</Text>
                {d.status === 'cancelled' ? (
                  <Text style={small}>{t('staff.deductions.mine.cancelled')}</Text>
                ) : null}
              </View>
            ))}
          </ListCard>
        </>
      )}
    </>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: t(access.proposes ? 'staff.deductions.title' : 'staff.deductions.mineTitle'),
        }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {access.mgmt && waitingCount > 0 ? (
          <View
            style={{
              padding: space.sm,
              borderRadius: radius.cell,
              backgroundColor: colors.tint,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text
              style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ink }}
            >
              {t('staff.deductions.waiting', { count: waitingCount })}
            </Text>
          </View>
        ) : null}
        {access.proposes && access.hasOwn ? (
          <SegmentedControl<DeductionsView>
            testID="staff-deductions.view"
            options={[
              { value: 'propose', label: t('staff.deductions.views.propose') },
              { value: 'mine', label: t('staff.deductions.views.mine') },
            ]}
            value={view}
            onChange={setView}
          />
        ) : null}
        {view === 'propose' ? proposeView : mineView}
      </ScrollView>
    </Screen>
  );
}

export default function StaffDeductionsRoute() {
  return (
    <RequireStaff>
      <DeductionsScreen />
    </RequireStaff>
  );
}
