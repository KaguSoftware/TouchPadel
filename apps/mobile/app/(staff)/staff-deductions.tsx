import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StaffRole } from '@touch/core';
import { formatDate, formatIQD, formatMonthYear, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Hint, MicroLabel, Screen, SegmentedControl } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { BackChevronIcon, ChevronIcon } from '../../src/components/icons';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { useHeaderAddOptions } from '../../src/navigation/headerAdd';
import { Lead, Tag } from '../../src/features/staff/checklists/parts';
import { ListCard } from '../../src/features/staff/protocols/parts';
import { namedFirst } from '../../src/features/staff/marketing/logic';
import {
  fetchDeductionsWaiting,
  fetchMyDeductionProposals,
  fetchMyDeductions,
  withdrawDeduction,
  type MyDeductionProposals,
} from '../../src/features/staff/deductions/api';
import { cacheEdit, useUndoable } from '../../src/features/staff/undo';
import {
  DEDUCTION_TONE,
  canWithdraw,
  deductionsAccess,
  initialView,
  monthOf,
  shiftMonth,
  stepMonth,
  venueBusinessToday,
  type DeductionsView,
} from '../../src/features/staff/deductions/logic';

/**
 * Pay deductions (wave5-addendum-2026-09-25 §2.5, §5.3; migrations 0197, 0272).
 *
 *   head_barista, head_chef   follow their proposals, withdraw a waiting one;
 *                             the + in the top bar opens the propose page
 *                             (staff-deduction-propose.tsx); the owner decides it
 *   manager                   the same for anyone at the venue but themselves
 *                             and the owners
 *   owner                     the same, but the owner's entry is recorded
 *                             approved at once and comes off the person's next
 *                             unpaid wage; and a line with how many wait for
 *                             the owner: deciding is on the operator only (§8 Q8)
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ view?: string; id?: string }>();

  const role: StaffRole = status.kind === 'staff' ? status.staff.role : 'cashier';
  const access = deductionsAccess(role);
  const venue = venueId ?? '';
  // The venue's business day: where the month stepper stands until the read answers.
  const today = venueBusinessToday();

  const [view, setView] = useState<DeductionsView>(() => initialView(role, params.view));
  // Proposing happens on its own page, opened from the + in the bar, and
  // only from the proposals view (the person's own month proposes nothing).
  const addOptions = useHeaderAddOptions(
    access.proposes && view === 'propose' && venue !== ''
      ? {
          testID: 'staff-deductions.add',
          label: t('staff.deductions.propose.open'),
          onPress: () => router.push('/staff-deduction-propose'),
        }
      : null,
  );

  // ── Reads ──────────────────────────────────────────────────────────────────
  const proposals = useQuery({
    queryKey: staffKeys.myDeductionProposals(venue),
    queryFn: () => fetchMyDeductionProposals(venue),
    enabled: venue !== '' && access.proposes && view === 'propose',
  });
  const waiting = useQuery({
    queryKey: staffKeys.deductionsWaiting(venue),
    queryFn: () => fetchDeductionsWaiting(venue),
    enabled: venue !== '' && access.decides,
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
      access.decides ? waiting.refetch() : null,
      view === 'propose' ? proposals.refetch() : mine.refetch(),
    ]),
  );

  // ── Withdraw ───────────────────────────────────────────────────────────────
  // Withdraw at once, with Undo on the toast instead of "Are you sure?"
  // (Sait, 2026-10-17); the call goes when the toast's time is up.
  const undoable = useUndoable();
  const withdraw = (id: string) =>
    undoable({
      message: t('staff.deductions.proposals.withdrawn'),
      ...cacheEdit<MyDeductionProposals>(queryClient, staffKeys.myDeductionProposals(venue), (mine) => ({
        ...mine,
        proposals: mine.proposals.map((p) => (p.id === id ? { ...p, status: 'withdrawn' } : p)),
      })),
      send: () => withdrawDeduction(id),
      onSent: () => {
        void queryClient.invalidateQueries({ queryKey: staffKeys.myDeductionProposals(venue) });
        void queryClient.invalidateQueries({ queryKey: staffKeys.deductionsWaiting(venue) });
      },
      onError: (err) => {
        toast(t(mapStaffError(err)), 'error');
        void queryClient.invalidateQueries({ queryKey: staffKeys.myDeductionProposals(venue) });
      },
    });

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

  const waitingCount = waiting.data?.waiting_count ?? 0;

  // ── For your team ──────────────────────────────────────────────────────────
  const proposeView = (
    <>
      <MicroLabel style={{ paddingStart: 4 }}>{t('staff.deductions.proposals.title')}</MicroLabel>
      {proposals.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={88} />
      ) : proposals.isError ? (
        loadError('staff-deductions.proposals-error', proposals)
      ) : (proposals.data?.proposals ?? []).length === 0 ? (
        <EmptyState centered testID="staff-deductions.proposals-empty" title={t('staff.deductions.proposals.empty')} />
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
                  onPress={() => withdraw(p.id)}
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
        <EmptyState centered testID="staff-deductions.mine-empty" title={t('staff.deductions.mine.empty', { month: monthLabel(shownMonth, locale) })} />
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
          ...addOptions,
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
        {access.decides && waitingCount > 0 ? (
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
        <View testID="staff-deductions.list" style={{ gap: space.sm }}>
          {view === 'propose' ? proposeView : mineView}
        </View>
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
