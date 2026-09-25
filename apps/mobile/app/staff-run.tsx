import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, formatIQD, formatNumber, formatPercent } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Hint, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { ChevronIcon } from '../src/components/icons';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import {
  cancelSchedule,
  fetchMarketingNotesForRun,
  fetchReleaseReview,
  fetchRunDetail,
  stopProtocol,
  withdrawProtocol,
} from '../src/features/staff/protocols/api';
import { bilingual, isMgmt, runTitle } from '../src/features/staff/protocols/logic';
import {
  Muted,
  ReasonForm,
  Section,
  StatusPill,
  Strong,
  runStatusTone,
  stepStatusTone,
  useRefreshProtocols,
} from '../src/features/staff/protocols/parts';
import type { ReleaseReview, RunDetail } from '../src/features/staff/protocols/types';

/**
 * One protocol run (build-contracts-2026-09-23 §6.1 `staff-run.tsx?id=`): its
 * title, where it stands, every step in order, and what the run as a whole
 * allows (`Can`): stop it with a reason (management), withdraw it before any
 * decision (its starter), cancel a scheduled date (whoever acts on the last
 * step). Per-run changes to steps and checklists stay on the operator (Q11).
 *
 * The day-30 review of a new item is management's only (#54): for anyone
 * else the read is never made and no block renders, so the starter sees the
 * run reach Finished with no figures.
 */

/**
 * One figure of the review: its name at the start, the server's number at the
 * end in ink, so the column of numbers reads down the card rather than being
 * picked out of sentences.
 */
function Figure({ label, value }: { label: string; value: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: space.s,
        paddingTop: space.s,
        paddingBottom: space.s,
        borderTopWidth: 1,
        borderTopColor: colors.sub,
      }}
    >
      <Text style={{ flexShrink: 1, fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}>
        {label}
      </Text>
      <Text style={{ fontFamily: fonts.body700, fontSize: 14, lineHeight: 19, color: colors.ink, fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

function ReviewBlock({ review }: { review: ReleaseReview | null | undefined }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  if (!review) return <Muted>{t('staff.protocols.run.review.notYet')}</Muted>;
  const n = review.numbers ?? {};
  const money = (v: number | null | undefined) => (typeof v === 'number' ? formatIQD(v, locale) : t('staff.protocols.common.none'));
  const num = (v: number | null | undefined) => (typeof v === 'number' ? formatNumber(v, locale) : t('staff.protocols.common.none'));
  // The review's shares are percentages already (0173 `release_review_input`).
  const pct = (v: number) => t('staff.protocols.run.review.percent', { pct: formatPercent(v, locale) });
  const text = locale === 'ar' ? (review.write_up?.ar ?? review.write_up?.en) : (review.write_up?.en ?? review.write_up?.ar);
  const boughtWith = (n.bought_with ?? [])
    .map((b) => bilingual(locale, b.name_en, b.name_ar))
    .filter(Boolean)
    .join(locale === 'ar' ? '، ' : ', ');
  return (
    <View style={{ gap: space.s }}>
      {review.status === 'thin' ? <Hint>{t('staff.protocols.run.review.thin')}</Hint> : null}
      {review.status === 'failed' ? <Hint>{t('staff.protocols.run.review.failed')}</Hint> : null}
      {text ? <Muted style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}>{text}</Muted> : null}
      <View>
        <Figure label={t('staff.protocols.run.review.units')} value={num(n.units)} />
        <Figure label={t('staff.protocols.run.review.revenue')} value={money(n.revenue_iqd)} />
        <Figure
          label={t('staff.protocols.run.review.margin')}
          value={`${money(n.margin_iqd)}${typeof n.margin_pct === 'number' ? ` (${pct(n.margin_pct)})` : ''}`}
        />
        <Figure label={t('staff.protocols.run.review.daysSold')} value={num(n.days_sold)} />
        {typeof n.category_share_pct === 'number' ? (
          <Figure label={t('staff.protocols.run.review.categoryShare')} value={pct(n.category_share_pct)} />
        ) : null}
      </View>
      {boughtWith ? <Muted>{`${t('staff.protocols.run.review.boughtWith')}: ${boughtWith}`}</Muted> : null}
    </View>
  );
}

function RunBody({ detail, mgmt, isOwner }: { detail: RunDetail; mgmt: boolean; isOwner: boolean }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const [stopping, setStopping] = useState(false);
  const { run, steps, can } = detail;
  const title = runTitle(run, locale) ?? t(`work.protocol.kind.${run.kind}`);
  const current = run.current_steps[0] ?? null;
  const isRelease = run.kind === 'product_release';

  const review = useQuery({
    queryKey: staffKeys.review(run.id),
    queryFn: () => fetchReleaseReview(run.id),
    // Management only (#54): nobody else's phone ever asks.
    enabled: mgmt && isRelease && (run.status === 'live' || run.status === 'done'),
  });
  const marketingNotes = useQuery({
    queryKey: staffKeys.context('marketing_notes', run.id),
    queryFn: () => fetchMarketingNotesForRun(run.id),
    enabled: mgmt,
  });

  const stop = useMutation({
    mutationKey: staffKeys.mutation('run.stop'),
    mutationFn: (note: string) => stopProtocol(run.id, note),
    onSuccess: () => {
      setStopping(false);
      toast(t('staff.protocols.run.stopped'), 'info');
      void refresh();
    },
  });
  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('run.withdraw'),
    mutationFn: () => withdrawProtocol(run.id),
    onSuccess: () => {
      toast(t('staff.protocols.run.withdrawn'), 'info');
      void refresh();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });
  const unschedule = useMutation({
    mutationKey: staffKeys.mutation('run.cancel_schedule'),
    mutationFn: () => cancelSchedule(run.id),
    onSuccess: () => {
      toast(t('staff.protocols.run.scheduleCancelled'), 'info');
      void refresh();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });

  const openStep = (id: string) => router.push({ pathname: '/staff-step', params: { id } });

  return (
    <>
      <Section>
        <Strong style={{ fontSize: 18, lineHeight: 24 }}>{title}</Strong>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, alignItems: 'center' }}>
          <StatusPill label={t(`work.protocol.runStatus.${run.status}`)} tone={runStatusTone(run.status)} />
          <Muted>
            {run.variant
              ? `${t(`work.protocol.kind.${run.kind}`)} · ${t(`work.protocol.variant.${run.variant}`)}`
              : t(`work.protocol.kind.${run.kind}`)}
          </Muted>
        </View>
        <Muted>
          {t('staff.protocols.run.startedBy', {
            name: run.started_by_name ?? '',
            when: formatDateTime(new Date(run.started_at), locale),
          })}
        </Muted>
        {run.scheduled_for && run.status === 'scheduled' ? (
          <Muted>{t('staff.protocols.run.scheduledFor', { when: formatDateTime(new Date(run.scheduled_for), locale) })}</Muted>
        ) : null}
        {run.live_at ? <Muted>{t('staff.protocols.run.liveSince', { when: formatDateTime(new Date(run.live_at), locale) })}</Muted> : null}
        {run.finished_at ? (
          <Muted>{t('staff.protocols.run.finishedAt', { when: formatDateTime(new Date(run.finished_at), locale) })}</Muted>
        ) : null}
        {current ? (
          <Button
            testID="staff-run.current-step"
            label={t('staff.protocols.run.openStep', { name: bilingual(locale, current.name_en, current.name_ar) ?? '' })}
            variant={run.waiting_on_me ? 'cta' : 'primary'}
            onPress={() => openStep(current.id)}
            style={{ marginTop: space.xs }}
          />
        ) : null}
      </Section>

      <Section title={t('staff.protocols.run.steps')}>
        {steps.map((s, i) => (
          <Pressable
            key={s.id}
            testID={`staff-run.step.${s.id}`}
            accessibilityRole="button"
            onPress={() => openStep(s.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              paddingTop: 10,
              paddingBottom: 10,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.sub,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ width: 22, fontFamily: fonts.display800, fontSize: 12, color: colors.fnt }}>{s.position}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
                {bilingual(locale, s.name_en, s.name_ar) ?? ''}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <StatusPill label={t(`work.protocol.stepStatus.${s.status}`)} tone={stepStatusTone(s.status)} />
                {s.round > 1 ? <Muted>{t('work.protocol.round', { round: s.round })}</Muted> : null}
                {s.optional ? <Muted>{t('work.protocol.optional')}</Muted> : null}
              </View>
            </View>
            <ChevronIcon size={16} color={colors.fnt2} />
          </Pressable>
        ))}
      </Section>

      {isRelease && run.menu_item_id && (run.status === 'live' || run.status === 'done') ? (
        <Button
          testID="staff-run.notes"
          label={t('staff.protocols.run.notes')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/staff-notes', params: { itemId: run.menu_item_id as string } })}
        />
      ) : null}

      {mgmt && isRelease && (run.status === 'live' || run.status === 'done') ? (
        <Section title={t('staff.protocols.run.review.title')}>
          {review.isPending ? (
            <SkeletonList rows={1} height={48} />
          ) : review.isError ? (
            <Hint>{t(mapStaffError(review.error))}</Hint>
          ) : (
            <ReviewBlock review={review.data} />
          )}
        </Section>
      ) : null}

      {mgmt && marketingNotes.data && marketingNotes.data.length > 0 ? (
        <Section title={t('staff.protocols.run.marketingTake')}>
          {marketingNotes.data.map((n) => (
            <View key={n.id} style={{ gap: 2 }}>
              <Muted style={{ color: colors.ink }}>{n.body}</Muted>
              <Muted>{`${n.author_name ?? ''} · ${formatDateTime(new Date(n.created_at), locale)}`}</Muted>
            </View>
          ))}
        </Section>
      ) : null}

      {isOwner && run.status === 'active' ? <Hint>{t('staff.protocols.run.ownerEdits')}</Hint> : null}

      {can.cancel_schedule ? (
        <Button
          testID="staff-run.cancel-schedule"
          label={t('work.protocol.action.cancelSchedule')}
          variant="secondary"
          busy={unschedule.isPending}
          onPress={() =>
            Alert.alert(t('work.protocol.action.cancelSchedule'), t('staff.protocols.run.cancelScheduleConfirm'), [
              { text: t('staff.protocols.step.decide.cancel'), style: 'cancel' },
              { text: t('work.protocol.action.cancelSchedule'), onPress: () => unschedule.mutate() },
            ])
          }
        />
      ) : null}
      {can.withdraw_run ? (
        <Button
          testID="staff-run.withdraw"
          label={t('staff.protocols.run.withdraw')}
          variant="dangerOutline"
          busy={withdraw.isPending}
          onPress={() =>
            Alert.alert(t('staff.protocols.run.withdraw'), t('staff.protocols.run.withdrawConfirm'), [
              { text: t('staff.protocols.step.decide.cancel'), style: 'cancel' },
              { text: t('staff.protocols.run.withdraw'), style: 'destructive', onPress: () => withdraw.mutate() },
            ])
          }
        />
      ) : null}
      {can.stop ? (
        stopping ? (
          <Section>
            <ReasonForm
              testID="staff-run.stop"
              label={t('staff.protocols.run.stopReason')}
              confirmLabel={t('staff.protocols.run.stopConfirm')}
              danger
              busy={stop.isPending}
              error={stop.error ? t(mapStaffError(stop.error)) : null}
              onCancel={() => setStopping(false)}
              onConfirm={(note) => stop.mutate(note)}
            />
          </Section>
        ) : (
          <Button
            testID="staff-run.stop"
            label={t('staff.protocols.run.stop')}
            variant="dangerOutline"
            onPress={() => setStopping(true)}
          />
        )
      ) : null}
    </>
  );
}

function RunScreen() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const refresh = useRefreshProtocols();
  const pull = usePullRefresh(refresh);
  const { status } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const role = status.kind === 'staff' ? status.staff.role : null;
  const run = useQuery({ queryKey: staffKeys.run(id), queryFn: () => fetchRunDetail(id), enabled: id !== '' });

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.protocols.run.title') }} />
      {run.isPending ? (
        <View style={{ paddingTop: space.m }}>
          <SkeletonList rows={3} height={96} />
        </View>
      ) : run.isError ? (
        <ErrorState
          testID="staff-run.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(run.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void run.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        >
          <RunBody detail={run.data} mgmt={isMgmt(role)} isOwner={role === 'owner'} />
        </ScrollView>
      )}
    </Screen>
  );
}

export default function StaffRunRoute() {
  return (
    <RequireStaff>
      <RunScreen />
    </RequireStaff>
  );
}
