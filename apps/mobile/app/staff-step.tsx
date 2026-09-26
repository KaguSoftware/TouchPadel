import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GENERIC_STEP_FORM,
  stepForm,
  validateDecision,
  validateSkip,
  type FieldIssue,
  type PriceChangeKind,
  type StepRow,
  type SubmissionRow,
} from '@touch/core';
import { formatDateTime, formatIQD, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Hint, LinkText, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { CheckIcon } from '../src/components/icons';
import { DecisionBar, type DecisionAnswer } from '../src/components/DecisionBar';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import {
  decideStep,
  fetchRunDetail,
  fetchStepDetail,
  skipStep,
  tickRunItem,
  withdrawStep,
} from '../src/features/staff/protocols/api';
import {
  bilingual,
  numbersRenames,
  runTitle,
  sendBackTargets,
  submissionsNewestFirst,
} from '../src/features/staff/protocols/logic';
import { OptionPicker } from '../src/features/staff/protocols/OptionPicker';
import {
  Muted,
  PhotoStrip,
  ReasonForm,
  Section,
  StatusPill,
  Strong,
  stepStatusTone,
  useRefreshProtocols,
  useRolesText,
} from '../src/features/staff/protocols/parts';
import { RecordView } from '../src/features/staff/protocols/RecordView';
import { StepContext } from '../src/features/staff/protocols/StepContext';
import {
  AddStaffForm,
  CandidatesForm,
  CourtsForm,
  GenericStepForm,
  LaunchForm,
} from '../src/features/staff/protocols/StepForms';
import type { RunDetail, StepDetail } from '../src/features/staff/protocols/types';
import { useStepReads, type StepReads } from '../src/features/staff/protocols/useStepReads';

/**
 * One step of a protocol (build-contracts-2026-09-23 §6.1 `staff-step.tsx?id=`):
 * where the actor sends it and the decider decides it, on the phone as on the
 * operator (Q2, Q8: everything works in both apps).
 *
 * Top to bottom: the step and its run; what the step's people need to see
 * (the recipe, the cost, the figures, the tournament); its checklist; the
 * form, for whoever `Can.submit`; what was sent, round by round; withdraw;
 * the decision (approve, send back, stop), for the decider; and skip, for an
 * optional step's decider. Every button follows `Can`, never a role check:
 * the server said what this person may do on this step.
 */

function StepHeader({ detail, role }: { detail: StepDetail; role: string }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const roles = useRolesText();
  const { run, step, can } = detail;
  const title = runTitle(run, locale) ?? t(`work.protocol.kind.${run.kind}`);
  const covering =
    can.submit && !step.assigned_to && !step.actor_roles.includes(role as StepRow['actor_roles'][number]);
  return (
    <Section>
      <LinkText
        testID="staff-step.run"
        label={t('staff.protocols.step.ofRun', { title })}
        onPress={() => router.push({ pathname: '/staff-run', params: { id: run.id } })}
      />
      <Strong style={{ fontSize: 18, lineHeight: 24 }}>{bilingual(locale, step.name_en, step.name_ar) ?? ''}</Strong>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, alignItems: 'center' }}>
        <StatusPill label={t(`work.protocol.stepStatus.${step.status}`)} tone={stepStatusTone(step.status)} />
        {step.round > 1 ? <Muted>{t('work.protocol.round', { round: step.round })}</Muted> : null}
        {step.needs_owner_ok ? <Muted>{t('work.protocol.needsOwnerOk')}</Muted> : null}
        {step.optional ? <Muted>{t('work.protocol.optional')}</Muted> : null}
      </View>
      <Muted>{t('staff.protocols.step.who', { roles: roles(step.actor_roles) })}</Muted>
      {step.assigned_to_name ? <Muted>{t('staff.protocols.step.assigned', { name: step.assigned_to_name })}</Muted> : null}
      {step.status === 'waiting' ? <Hint>{t('staff.protocols.step.notOpen')}</Hint> : null}
      {covering ? <Muted style={{ color: colors.ambtext }}>{t('staff.protocols.step.covering', { roles: roles(step.actor_roles) })}</Muted> : null}
      {step.status === 'open' && !can.submit ? <Muted>{t('staff.protocols.step.waitingOn', { roles: roles(step.actor_roles) })}</Muted> : null}
      {step.skip_note ? (
        <Muted>
          {t('staff.protocols.step.skippedBy', {
            name: step.skipped_by_name ?? '',
            note: isolate(step.skip_note === '[deleted after 90 days]' ? t('work.protocol.noteDeleted') : step.skip_note),
          })}
        </Muted>
      ) : null}
    </Section>
  );
}

/**
 * The names a price or add-on price change renames (wave5-addendum-2026-09-25
 * §2.2, #9), on the numbers and apply steps: "Small (4,000 IQD) → Large", at
 * the price the size or option sells at once applied, then the same rename
 * in the other language, since the owner approves both names.
 */
function Renames({ reads }: { reads: StepReads }) {
  const { t, locale } = useLocale();
  const renames = numbersRenames(reads.numbers.data);
  if (renames.length === 0) return null;
  const other = locale === 'ar' ? 'en' : 'ar';
  return (
    <Section title={t('staff.protocols.context.renamesTitle')}>
      <View testID="staff-step.renames" style={{ gap: space.s }}>
        {renames.map((r) => (
          <View key={`${r.target}:${r.id}`} style={{ gap: 1 }}>
            <Strong style={{ fontSize: 13 }}>
              {t('staff.protocols.context.renameLine', {
                from: isolate(bilingual(locale, r.from_en, r.from_ar) ?? ''),
                price: r.price_iqd === null ? t('staff.protocols.common.none') : formatIQD(r.price_iqd, locale),
                to: isolate(bilingual(locale, r.to_en, r.to_ar) ?? ''),
              })}
            </Strong>
            <Muted>
              {t('staff.protocols.renamedFrom', {
                from: isolate(other === 'ar' ? r.from_ar : r.from_en),
                to: isolate(other === 'ar' ? r.to_ar : r.to_en),
              })}
            </Muted>
          </View>
        ))}
      </View>
    </Section>
  );
}

function Checklist({ step, canTick }: { step: StepRow; canTick: boolean }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const refresh = useRefreshProtocols();
  const toast = useToast();
  const tick = useMutation({
    mutationKey: staffKeys.mutation('tick'),
    mutationFn: (args: { id: string; done: boolean }) => tickRunItem(args.id, args.done),
    onSuccess: (_, args) => {
      toast(t(args.done ? 'staff.protocols.step.ticked' : 'staff.protocols.step.unticked'), 'info');
      void refresh();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });
  if (step.items.length === 0) return null;
  return (
    <Section title={t('staff.protocols.step.checklist')}>
      {step.items.map((item) => {
        const done = item.done_at !== null;
        return (
          <Pressable
            key={item.id}
            testID={`staff-step.item.${item.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done, disabled: !canTick }}
            disabled={!canTick || tick.isPending}
            onPress={() => tick.mutate({ id: item.id, done: !done })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.s,
              paddingTop: 8,
              paddingBottom: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 22,
                height: 22,
                marginTop: 1,
                borderRadius: 6,
                borderWidth: 1.5,
                // An empty box is still a control: fnt clears 3:1 on the card.
                borderColor: done ? colors.gstrong : colors.fnt,
                backgroundColor: done ? colors.gstrong : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {done ? <CheckIcon size={13} color={colors.card} strokeWidth={3} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 20, color: colors.ink }}>
                {bilingual(locale, item.text_en, item.text_ar) ?? ''}
              </Text>
              {done && item.done_by_name ? (
                <Muted>{t('staff.protocols.step.doneBy', { name: item.done_by_name })}</Muted>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </Section>
  );
}

function SubmissionCard({
  sub,
  detail,
  runDetail,
  reads,
}: {
  sub: SubmissionRow;
  detail: StepDetail;
  runDetail: RunDetail | undefined;
  reads: StepReads;
}) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const { run, step } = detail;
  const change = typeof sub.record?.change === 'string' ? (sub.record.change as PriceChangeKind) : reads.change;
  const form = step.step_key === null ? GENERIC_STEP_FORM : stepForm(run.kind, step.step_key, { variant: run.variant, change });
  const target = sub.send_back_to ? runDetail?.steps.find((s) => s.id === sub.send_back_to) : undefined;
  const status = sub.withdrawn_at
    ? t('staff.protocols.step.withdrawnLabel')
    : sub.superseded_at
      ? t('staff.protocols.step.supersededLabel')
      : sub.decision
        ? t('staff.protocols.step.decidedBy', {
            decision: t(`work.protocol.decision.${sub.decision}` as MessageKey),
            name: sub.decided_by_name ?? '',
            when: sub.decided_at ? formatDateTime(new Date(sub.decided_at), locale) : '',
          })
        : t('staff.protocols.step.pending');
  const note = sub.decision_note === '[deleted after 90 days]' ? t('work.protocol.noteDeleted') : sub.decision_note;
  return (
    <View style={{ gap: 6, paddingTop: space.s, borderTopWidth: 1, borderTopColor: colors.sub }}>
      <Muted style={{ color: colors.ink }}>
        {t('staff.protocols.step.submittedBy', {
          name: sub.submitted_by_name ?? '',
          when: formatDateTime(new Date(sub.submitted_at), locale),
        })}
        {sub.round > 1 ? ` · ${t('work.protocol.round', { round: sub.round })}` : ''}
      </Muted>
      <Muted>{status}</Muted>
      {note ? <Muted>{t('staff.protocols.step.decisionNote', { note: isolate(note) })}</Muted> : null}
      {target ? (
        <Muted>{t('staff.protocols.step.sentBackTo', { name: bilingual(locale, target.name_en, target.name_ar) ?? '' })}</Muted>
      ) : null}
      {sub.decision === 'auto' ? <Muted>{t('work.protocol.autoPassed')}</Muted> : null}
      {sub.record && form ? (
        <RecordView
          fields={form.fields}
          record={sub.record}
          names={reads.names}
          skip={new Set(['photo_path', 'menu_photo_path'])}
        />
      ) : (
        <Hint>{t('staff.protocols.step.hiddenRecord')}</Hint>
      )}
      <PhotoStrip paths={sub.photos ?? []} label={(n) => t('staff.media.photo', { n })} />
    </View>
  );
}

function StepScreen() {
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const role = status.kind === 'staff' ? status.staff.role : null;

  const stepQ = useQuery({ queryKey: staffKeys.step(id), queryFn: () => fetchStepDetail(id), enabled: id !== '' });
  const runId = stepQ.data?.run.id ?? '';
  const runQ = useQuery({ queryKey: staffKeys.run(runId), queryFn: () => fetchRunDetail(runId), enabled: runId !== '' });
  const reads = useStepReads(stepQ.data, runQ.data, role, venueId, locale);
  const pull = usePullRefresh(refresh);

  const [decisionIssues, setDecisionIssues] = useState<FieldIssue[]>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  const decide = useMutation({
    mutationKey: staffKeys.mutation('decide'),
    mutationFn: (answer: DecisionAnswer & { submissionId: string; data: Record<string, unknown> }) =>
      decideStep({
        submissionId: answer.submissionId,
        decision: answer.decision,
        note: answer.note || null,
        sendBackTo: answer.sendBackTo,
        data: answer.data,
      }),
    onSuccess: (_, answer) => {
      toast(
        t(
          answer.decision === 'approve'
            ? 'staff.protocols.step.decide.approved'
            : answer.decision === 'send_back'
              ? 'staff.protocols.step.decide.sentBack'
              : 'staff.protocols.step.decide.stopped',
        ),
        'success',
      );
      void refresh();
    },
    onError: (err) => setDecisionError(t(mapStaffError(err))),
  });

  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('withdraw'),
    mutationFn: (submissionId: string) => withdrawStep(submissionId),
    onSuccess: () => {
      toast(t('staff.protocols.step.withdrawn'), 'info');
      void refresh();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });

  const skip = useMutation({
    mutationKey: staffKeys.mutation('skip'),
    mutationFn: (note: string) => skipStep(id, note),
    onSuccess: () => {
      setSkipping(false);
      toast(t('staff.protocols.step.skipped'), 'info');
      void refresh();
    },
  });

  if (stepQ.isPending || !role || !venueId) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: t('staff.protocols.step.title') }} />
        <View style={{ paddingTop: space.m }}>
          <SkeletonList rows={3} height={96} />
        </View>
      </Screen>
    );
  }
  if (stepQ.isError) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: t('staff.protocols.step.title') }} />
        <ErrorState
          testID="staff-step.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(stepQ.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void stepQ.refetch()}
        />
      </Screen>
    );
  }

  const detail = stepQ.data;
  const { run, step, can } = detail;
  const key = step.step_key;
  const history = submissionsNewestFirst(step);
  const targets = sendBackTargets(can.send_back_targets, runQ.data?.steps ?? [step], locale).map((s) => ({
    id: s.id,
    label: s.id === step.id ? t('staff.protocols.step.decide.thisStep', { name: s.name }) : s.name,
  }));
  const approveNeedsCategory = run.kind === 'product_release' && key === 'propose';
  const standing = history.find((s) => s.id === can.decide_submission_id);
  const recordCategory = typeof standing?.record?.category_id === 'string' ? standing.record.category_id : null;
  const chosenCategory = category ?? recordCategory;

  const onDecide = (answer: DecisionAnswer) => {
    setDecisionError(null);
    if (!can.decide_submission_id) return;
    const data = approveNeedsCategory && answer.decision === 'approve' ? { category_id: chosenCategory } : {};
    const found = validateDecision(run.kind, key, {
      decision: answer.decision,
      note: answer.note,
      sendBackTo: answer.sendBackTo,
      sendBackTargets: can.send_back_targets,
      data,
    });
    setDecisionIssues(found);
    if (found.some((i) => i.field === 'category_id')) {
      setDecisionError(t('staff.protocols.step.decide.categoryRequired'));
      return;
    }
    if (found.length > 0) return;
    decide.mutate({ ...answer, submissionId: can.decide_submission_id, data });
  };

  const form = (() => {
    if (!can.submit) return null;
    const props = { detail, runDetail: runQ.data, reads, role, venueId };
    if (run.kind === 'product_release' && key === 'launch') return <LaunchForm {...props} />;
    if (run.kind === 'tournament' && key === 'courts') return <CourtsForm {...props} />;
    if (run.kind === 'hiring' && key === 'interviews') return <CandidatesForm {...props} />;
    if (run.kind === 'hiring' && key === 'add_staff') return <AddStaffForm {...props} />;
    return <GenericStepForm key={`${step.id}:${step.round}`} {...props} />;
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.protocols.step.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <StepHeader detail={detail} role={role} />
        <StepContext detail={detail} reads={reads} />
        <Renames reads={reads} />
        <Checklist step={step} canTick={can.tick} />
        {form}
        {history.length > 0 ? (
          <Section title={t('staff.protocols.step.history')}>
            {history.map((sub) => (
              <SubmissionCard key={sub.id} sub={sub} detail={detail} runDetail={runQ.data} reads={reads} />
            ))}
          </Section>
        ) : null}
        {can.withdraw_submission_id ? (
          <Button
            testID="staff-step.withdraw"
            label={t('staff.protocols.step.withdraw')}
            variant="secondary"
            busy={withdraw.isPending}
            onPress={() =>
              Alert.alert(t('staff.protocols.step.withdraw'), t('staff.protocols.step.withdrawConfirm'), [
                { text: t('staff.protocols.step.decide.cancel'), style: 'cancel' },
                {
                  text: t('work.protocol.action.withdraw'),
                  style: 'destructive',
                  onPress: () => withdraw.mutate(can.withdraw_submission_id as string),
                },
              ])
            }
          />
        ) : null}
        {can.decide_submission_id ? (
          <Section>
            <DecisionBar
              testID="staff-step.decide"
              targets={targets}
              defaultTargetId={step.id}
              busy={decide.isPending}
              error={decisionError}
              issues={decisionIssues}
              onDecide={onDecide}
              approveExtra={
                approveNeedsCategory ? (
                  <View style={{ gap: 4 }}>
                    <OptionPicker
                      testID="staff-step.decide.category"
                      label={t('staff.protocols.step.decide.category')}
                      options={(reads.categories.data ?? []).map((c) => ({
                        value: c.id,
                        label: bilingual(locale, c.name_en, c.name_ar) ?? '',
                      }))}
                      value={chosenCategory ?? ''}
                      onChange={(v) => setCategory(typeof v === 'string' ? v : null)}
                    />
                    <Hint>{t('staff.protocols.step.decide.categoryHint')}</Hint>
                  </View>
                ) : undefined
              }
            />
          </Section>
        ) : null}
        {can.skip ? (
          skipping ? (
            <Section>
              <ReasonForm
                testID="staff-step.skip"
                label={t('staff.protocols.step.skipReason')}
                confirmLabel={t('staff.protocols.step.skipConfirm')}
                busy={skip.isPending}
                error={skip.error ? t(mapStaffError(skip.error)) : null}
                onCancel={() => setSkipping(false)}
                onConfirm={(note) => {
                  if (validateSkip(note).length === 0) skip.mutate(note);
                }}
              />
            </Section>
          ) : (
            <Button
              testID="staff-step.skip"
              label={t('staff.protocols.step.skip')}
              variant="ghost"
              onPress={() => setSkipping(true)}
            />
          )
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffStepRoute() {
  return (
    <RequireStaff>
      <StepScreen />
    </RequireStaff>
  );
}
