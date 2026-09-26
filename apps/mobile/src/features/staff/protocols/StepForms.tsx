/**
 * The form of an open step, for whoever may act on it (build-contracts-2026-09-23
 * §2.8, §6.1 `staff-step.tsx`): every built-in step and the owner's own. Most
 * are drawn from `@touch/core`'s field list (GenericStepForm); four carry
 * their own work and so their own form:
 *   - release `launch` (the owner): the menu photo, now or a date, through
 *     `protocol-action`;
 *   - tournament `courts` (the court desk): block the plan's courts, then send;
 *   - hiring `interviews` (a manager): the candidates, one picked;
 *   - hiring `add_staff` (the owner): the new account, then its id.
 *
 * Every send carries a key minted once per intent (`staffIntentKey`) and
 * dropped after it lands, so a retry after a lost answer replays rather than
 * sending twice (§6.4). The intent names what is sent (the step with its
 * submissions so far, a candidate's details, the blocks asked for), never a
 * counter that starts again when the form reopens: a key left behind by a
 * lost answer must not swallow a different send later.
 */
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  GENERIC_STEP_FORM,
  stepForm,
  validateStep,
  type FieldIssue,
  type StaffRole,
  type StepForm,
} from '@touch/core';
import { formatDateTime, isolate } from '@touch/i18n';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space, useTheme } from '../../../theme';
import { Button, ErrorText, Field, Hint, MicroLabel } from '../../../components/ui';
import { SkeletonList } from '../../../components/states';
import { useToast } from '../../../components/overlays';
import { PhotoButton, type AttachedPhoto } from '../../../components/PhotoButton';
import { clearStaffIntentKey, staffIntentKey } from '../../../lib/idempotency';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import type { PhotoFolder } from '../photo';
import { intentFor } from '../supplies/logic';
import {
  blockCourtsForEvent,
  createStaffAccount,
  deleteHiringCandidate,
  fetchNewHires,
  launchRelease,
  saveHiringCandidate,
  submitStep,
  type CandidateInput,
} from './api';
import {
  draftFromRecord,
  emptyDraft,
  exampleVenueDay,
  parseVenueDateTime,
  recordFromDraft,
  venueDateTimeText,
  type Draft,
} from './assemble';
import { Chip, FormFields, type FieldPicker } from './FormFields';
import {
  bilingual,
  blocksToSend,
  completeRenames,
  courtsRecord,
  interviewsRecord,
  isMgmt,
  launchPhotoChoices,
  plannedWindows,
  positionRole,
  priceNumbersStart,
  priceProposeResubmit,
  readBlockAnswer,
  resubmissionSource,
  submitIntent,
  type BlockConflict,
  type FixedRow,
} from './logic';
import { MULTILINE_BOX, MULTILINE_TEXT } from './multiline';
import { Muted, Section, StoredPhoto, Strong, serverIssue, useRefreshProtocols, useRolesText } from './parts';
import type { RunDetail, StepDetail, SubmitResult } from './types';
import { useAttachedPhotos, type StepReads } from './useStepReads';

interface StepFormProps {
  detail: StepDetail;
  runDetail: RunDetail | undefined;
  reads: StepReads;
  role: StaffRole;
  venueId: string;
}

/** The sent toast: an automatic pass says so (§2.7). */
function useSentToast() {
  const { t } = useLocale();
  const toast = useToast();
  return (result: SubmitResult | null | undefined) =>
    toast(t(result?.auto ? 'staff.protocols.step.autoPassed' : 'staff.protocols.step.sent'), 'success');
}

// ── The generic form ────────────────────────────────────────────────────────

interface Spec {
  form: StepForm;
  draft: Draft;
  fixed: Record<string, { key: string; rows: FixedRow[] }>;
  hidden: string[];
}

/** The form and its first draft, from the step and what the page has read; null while a read is missing. */
function useSpec(p: StepFormProps): Spec | null {
  const { detail, reads, runDetail } = p;
  const kind = detail.run.kind;
  const key = detail.step.step_key;
  const variant = detail.run.variant;
  const runLoaded = runDetail !== undefined;
  const source = resubmissionSource(detail.step);
  const record = (source?.record ?? null) as Record<string, unknown> | null;
  return useMemo<Spec | null>(() => {
    const change = reads.change;
    if (key === null) {
      return { form: GENERIC_STEP_FORM, draft: draftFromRecord(GENERIC_STEP_FORM.fields, record), fixed: {}, hidden: [] };
    }
    // A price or promotion step's fields depend on the run's change kind, read
    // from its proposal in the run detail: the form waits for it rather than
    // mounting with the wrong fields (its draft is made once).
    if (kind === 'price_promo' && !change) return null;
    const form = stepForm(kind, key, { variant, change });
    if (!form) return null;
    const base = record ? draftFromRecord(form.fields, record) : emptyDraft(form.fields);

    if (kind === 'product_release' && key === 'test') {
      const sizes = reads.testContext.data?.sizes;
      if (!sizes) return null;
      const sent = new Map(
        (Array.isArray(record?.servings) ? (record.servings as { variant_id?: string; count?: number }[]) : []).map(
          (s) => [s.variant_id, s.count] as const,
        ),
      );
      const spec: Spec = {
        form,
        draft: {
          ...base,
          servings: sizes.map((s) => ({
            variant_id: s.variant_id,
            count: sent.has(s.variant_id) ? String(sent.get(s.variant_id)) : '',
          })),
        },
        fixed: {
          servings: {
            key: 'variant_id',
            rows: sizes.map((s) => ({ id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: null })),
          },
        },
        hidden: [],
      };
      return spec;
    }
    if (kind === 'product_release' && key === 'analysis') {
      const sizes = reads.cost.data?.sizes;
      // The first round starts from the proposal's names, read from the run.
      if (!sizes || (!record && !runLoaded)) return null;
      const sent = new Map(
        (Array.isArray(record?.prices) ? (record.prices as { variant_id?: string; price_iqd?: number }[]) : []).map(
          (s) => [s.variant_id, s.price_iqd] as const,
        ),
      );
      const names = reads.propose ?? {};
      const spec: Spec = {
        form,
        draft: {
          ...base,
          name_en: record ? (base.name_en ?? '') : typeof names.name_en === 'string' ? names.name_en : '',
          name_ar: record ? (base.name_ar ?? '') : typeof names.name_ar === 'string' ? names.name_ar : '',
          prices: sizes.map((s) => ({
            variant_id: s.variant_id,
            price_iqd: sent.has(s.variant_id) ? String(sent.get(s.variant_id)) : '',
          })),
        },
        fixed: {
          prices: {
            key: 'variant_id',
            rows: sizes.map((s) => ({ id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: null })),
          },
        },
        hidden: [],
      };
      return spec;
    }
    if (kind === 'price_promo' && key === 'propose' && record) {
      // The sizes or add-ons it prices come from the targets; wait for them
      // (a failed read still gives the form, without the rows' names).
      if (change !== 'promotion' && !reads.targets.data && !reads.targets.isError) return null;
      const r = priceProposeResubmit(record, reads.targets.data);
      return { form, draft: r.draft, fixed: r.fixed, hidden: r.hidden };
    }
    if (kind === 'price_promo' && key === 'numbers' && change) {
      if (!reads.numbers.data) return null;
      const n = priceNumbersStart(change, reads.numbers.data);
      const draft: Draft = record
        ? { ...n.draft, recommendation: base.recommendation || n.draft.recommendation || 'go', note: base.note ?? '' }
        : n.draft;
      return { form, draft, fixed: n.fixed, hidden: n.hidden };
    }
    if (kind === 'price_promo' && key === 'apply' && !record) {
      return { form, draft: { ...base, when: 'now' }, fixed: {}, hidden: [] };
    }
    return { form, draft: base, fixed: {}, hidden: [] };
    // The draft is made once per round: later reads refresh the page, not the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    detail.step.id,
    detail.step.round,
    reads.change,
    reads.testContext.data,
    reads.cost.data,
    reads.numbers.data,
    reads.targets.data,
    reads.targets.isError,
    reads.propose,
    runLoaded,
  ]);
}

export function GenericStepForm(p: StepFormProps) {
  const spec = useSpec(p);
  const source = resubmissionSource(p.detail.step);
  const photos = useAttachedPhotos(source?.photos ?? []);
  if (!spec || !photos) return <SkeletonList rows={2} height={64} />;
  return <GenericStepFormBody {...p} spec={spec} initialPhotos={photos} resubmission={source !== null} />;
}

function GenericStepFormBody({
  detail,
  reads,
  role,
  venueId,
  spec,
  initialPhotos,
  resubmission,
}: StepFormProps & { spec: Spec; initialPhotos: AttachedPhoto[]; resubmission: boolean }) {
  const { t, locale } = useLocale();
  const refresh = useRefreshProtocols();
  const sentToast = useSentToast();
  const [draft, setDraft] = useState<Draft>(spec.draft);
  const [photos, setPhotos] = useState<AttachedPhoto[]>(initialPhotos);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const kind = detail.run.kind;
  const key = detail.step.step_key;
  const variant = detail.run.variant;
  const form = spec.form;
  const intent = submitIntent(detail.step);
  const submitterDecides = detail.step.needs_owner_ok ? role === 'owner' : isMgmt(role);
  const fixedKeys = Object.fromEntries(Object.entries(spec.fixed).map(([path, f]) => [path, f.key]));

  const option = (id: string, en: string | null | undefined, ar: string | null | undefined) => ({
    value: id,
    label: bilingual(locale, en, ar) ?? '',
  });
  const pickers: Record<string, FieldPicker> = {};
  if (reads.ingredients.data) pickers['lines.ingredient_id'] = { options: reads.ingredients.data.map((i) => option(i.id, i.name_en, i.name_ar)) };
  if (reads.categories.data) pickers.category_id = { options: reads.categories.data.map((c) => option(c.id, c.name_en, c.name_ar)) };
  if (reads.courts.data) {
    const courts = { options: reads.courts.data.map((c) => option(c.id, c.name_en, c.name_ar)) };
    pickers['ranges.court_ids'] = courts;
    pickers['rule.court_id'] = courts;
    pickers['promotion.scope.courtIds'] = courts;
  }
  if (reads.campaigns.data && reads.campaigns.data.length > 0) {
    pickers.campaign_id = { options: reads.campaigns.data.map((d) => option(d.id, d.name_en, d.name_ar)) };
  }

  const hints: Record<string, string> = {
    lines: t('staff.protocols.form.lineIngredientOrLabel'),
    sizes: t('staff.protocols.form.sizeName'),
  };
  if (kind === 'price_promo' && key === 'propose') {
    hints.prices = t(reads.change === 'shop_launch' ? 'staff.protocols.start.shopPricesHint' : 'staff.protocols.start.pricesHint');
    hints.addons = t('staff.protocols.start.addonHint');
  }
  const optionLabels =
    kind === 'price_promo' && key === 'apply'
      ? { when: { now: t('staff.protocols.schedule.applyNow'), date: t('staff.protocols.schedule.applyDate') } }
      : undefined;

  const send = useMutation({
    mutationKey: staffKeys.mutation('submit'),
    mutationFn: (args: { record: Record<string, unknown>; photos: string[] }) =>
      submitStep(detail.step.id, args.record, args.photos, staffIntentKey(intent, 'submit')),
    onSuccess: (result) => {
      clearStaffIntentKey(intent);
      sentToast(result);
      void refresh();
    },
    onError: (err) => {
      setError(t(mapStaffError(err)));
      const issue = serverIssue(err);
      if (issue) setIssues((all) => [...all, issue]);
    },
  });

  const onSubmit = () => {
    setError(null);
    // A sent-back price proposal's renames complete as a new one's do
    // (staff-start): an empty language keeps today's name (wave 5 §2.2, #9).
    const record = recordFromDraft(form.fields, completeRenames(draft, spec.fixed.renames), { fixedKeys });
    const found = validateStep(kind, key, record, { variant, change: reads.change }, { submitterDecides, photos: photos.length });
    setIssues(found);
    if (found.length > 0) {
      setError(t('staff.protocols.step.checkForm'));
      return;
    }
    const go = () => send.mutate({ record, photos: photos.map((ph) => ph.path) });
    if (kind === 'price_promo' && key === 'apply' && record.when === 'now') {
      Alert.alert(t('staff.protocols.schedule.applyNow'), t('staff.protocols.schedule.confirmNow'), [
        { text: t('staff.protocols.step.decide.cancel'), style: 'cancel' },
        { text: t('staff.protocols.schedule.applyNow'), onPress: go },
      ]);
      return;
    }
    go();
  };

  return (
    <Section title={t('staff.protocols.step.formTitle')}>
      {resubmission ? <Hint>{t('staff.protocols.step.resubmitHint')}</Hint> : null}
      <FormFields
        testID="staff-step"
        fields={form.fields}
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          setIssues([]);
        }}
        issues={issues}
        hidden={new Set(spec.hidden)}
        pickers={pickers}
        fixed={spec.fixed}
        hints={hints}
        optionLabels={optionLabels}
        deciderFields={submitterDecides}
        disabled={send.isPending}
      />
      {form.photoFolder && form.photosMax > 0 ? (
        <View style={{ gap: 6, marginTop: space.sm }}>
          <MicroLabel>{t('staff.protocols.step.photos')}</MicroLabel>
          <PhotoButton
            testID="staff-step.photo"
            venueId={venueId}
            folder={form.photoFolder as PhotoFolder}
            photos={photos}
            onChange={(next) => {
              setPhotos(next);
              setIssues((all) => all.filter((i) => i.field !== 'photos'));
            }}
            max={form.photosMax}
            disabled={send.isPending}
          />
          {form.photosMin > 0 ? <Hint>{t('staff.protocols.step.photosNeeded', { min: form.photosMin })}</Hint> : null}
          {issues.some((i) => i.field === 'photos') ? (
            <ErrorText>{t('staff.protocols.step.photosNeeded', { min: form.photosMin })}</ErrorText>
          ) : null}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button
        testID="staff-step.submit"
        label={
          kind === 'price_promo' && key === 'apply'
            ? t(draft.when === 'date' ? 'staff.protocols.schedule.applyDate' : 'staff.protocols.schedule.applyNow')
            : t('staff.protocols.step.submit')
        }
        variant="primary"
        busy={send.isPending}
        onPress={onSubmit}
      />
    </Section>
  );
}

// ── Launch (the owner) ──────────────────────────────────────────────────────

export function LaunchForm({ detail, runDetail, reads }: StepFormProps) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const refresh = useRefreshProtocols();
  const toast = useToast();
  const choices = useMemo(() => (runDetail ? launchPhotoChoices(runDetail.steps) : []), [runDetail]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [when, setWhen] = useState<'now' | 'date'>('now');
  const [at, setAt] = useState('');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  // An example a week out, for the date hint; read once, not on every render.
  const [example] = useState(() => exampleVenueDay(Date.now(), 7));
  const chosen = photo ?? choices[0] ?? null;
  const intent = `launch:${detail.step.id}:${detail.step.round}`;
  const readiness = reads.readiness.data;

  const launch = useMutation({
    mutationKey: staffKeys.mutation('launch'),
    mutationFn: (args: { when: 'now' | 'date'; at: string | null; photoPath: string }) =>
      launchRelease({ runStepId: detail.step.id, ...args, idempotencyKey: staffIntentKey(intent, 'launch') }),
    onSuccess: (_, args) => {
      clearStaffIntentKey(intent);
      toast(t(args.when === 'now' ? 'staff.protocols.launch.launched' : 'staff.protocols.launch.scheduled'), 'success');
      void refresh();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSubmit = () => {
    setError(null);
    const atIso = when === 'date' ? (parseVenueDateTime(at) ?? Number.NaN) : null;
    const record = { when, ...(when === 'date' ? { at: atIso } : {}), photo_path: chosen ?? '' };
    const found = validateStep('product_release', 'launch', record);
    setIssues(found);
    if (found.length > 0 || !chosen) {
      setError(t('staff.protocols.step.checkForm'));
      return;
    }
    const go = () => launch.mutate({ when, at: typeof atIso === 'string' ? atIso : null, photoPath: chosen });
    if (when === 'now') {
      Alert.alert(t('staff.protocols.launch.whenNow'), t('staff.protocols.launch.confirmNow'), [
        { text: t('staff.protocols.step.decide.cancel'), style: 'cancel' },
        { text: t('staff.protocols.launch.whenNow'), onPress: go },
      ]);
      return;
    }
    go();
  };

  return (
    <Section title={t('staff.protocols.launch.title')}>
      {readiness ? (
        <View style={{ gap: 4 }}>
          <MicroLabel>{t('staff.protocols.context.readiness')}</MicroLabel>
          <Strong style={{ fontSize: 13, color: readiness.ready ? colors.gtext : colors.redtext }}>
            {t(readiness.ready ? 'staff.protocols.context.ready' : 'staff.protocols.context.notReady')}
          </Strong>
          {readiness.checks.map((c) => (
            <Muted key={c.key} style={{ color: c.ok ? colors.mut : colors.redtext }}>
              {`${c.ok ? '✓' : '✗'} ${t(`staff.protocols.context.check.${c.key}`)}`}
            </Muted>
          ))}
          {readiness.warnings.map((w) => (
            <Muted key={w.key} style={{ color: colors.ambtext }}>
              {t(`staff.protocols.context.warning.${w.key}`)}
            </Muted>
          ))}
        </View>
      ) : null}
      <MicroLabel style={{ marginTop: space.s }}>{t('staff.protocols.launch.photo')}</MicroLabel>
      {choices.length === 0 ? (
        <Hint>{t('staff.protocols.launch.noPhotos')}</Hint>
      ) : (
        <>
          <Muted>{t('staff.protocols.launch.photoHint')}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {choices.map((path, i) => (
              <StoredPhoto
                key={path}
                path={path}
                size={84}
                testID={`staff-step.launch.photo.${i}`}
                label={t('staff.media.photo', { n: i + 1 })}
                selected={path === chosen}
                onPress={() => setPhoto(path)}
              />
            ))}
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Chip testID="staff-step.launch.now" label={t('staff.protocols.launch.whenNow')} selected={when === 'now'} onPress={() => setWhen('now')} />
        <Chip testID="staff-step.launch.date" label={t('staff.protocols.launch.whenDate')} selected={when === 'date'} onPress={() => setWhen('date')} />
      </View>
      {when === 'date' ? (
        <View style={{ gap: 4 }}>
          <Field
            testID="staff-step.field.at"
            label={t('staff.protocols.field.at')}
            value={at}
            onChangeText={(v) => {
              setAt(v);
              setIssues([]);
            }}
            keyboardType="numbers-and-punctuation"
            latin
            error={issues.some((i) => i.field === 'at') ? t('staff.protocols.form.invalid') : null}
          />
          {parseVenueDateTime(at) ? <Hint>{formatDateTime(new Date(parseVenueDateTime(at) as string), locale)}</Hint> : null}
          <Hint>
            {`${t('staff.protocols.form.datetimeHint', {
              // Latin digits in an Arabic sentence: isolated, or the time is drawn before the date.
              example: isolate(`${example} 10:00`),
            })} ${t('staff.protocols.launch.atHint')}`}
          </Hint>
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button
        testID="staff-step.submit"
        label={t(when === 'now' ? 'staff.protocols.launch.submitNow' : 'staff.protocols.launch.submitDate')}
        variant="cta"
        busy={launch.isPending}
        disabled={choices.length === 0}
        onPress={onSubmit}
      />
    </Section>
  );
}

// ── Tournament courts (the court desk) ──────────────────────────────────────

export function CourtsForm({ detail, reads }: StepFormProps) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const refresh = useRefreshProtocols();
  const sentToast = useSentToast();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [conflicts, setConflicts] = useState<BlockConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ctx = reads.tournament.data;
  const windows = ctx ? plannedWindows(ctx) : [];
  const remaining = blocksToSend(windows);
  const sendIntent = submitIntent(detail.step);
  // A block request is one intent per set of blocks asked for; a conflict is
  // an answer, and the next press asks again under a new key.
  const blockIntent = (blocks: typeof remaining) => intentFor('event_block', { runId: detail.run.id, blocks });

  const block = useMutation({
    mutationKey: staffKeys.mutation('event_block'),
    mutationFn: (blocks: typeof remaining) =>
      blockCourtsForEvent(detail.run.id, blocks, staffIntentKey(blockIntent(blocks), 'event_block')),
    onSuccess: (data, blocks) => {
      clearStaffIntentKey(blockIntent(blocks));
      const answer = readBlockAnswer(data);
      setConflicts(answer.conflicts);
      if (answer.conflicts.length === 0) toast(t('staff.protocols.courts.blockedNow'), 'success');
      void reads.tournament.refetch();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const send = useMutation({
    mutationKey: staffKeys.mutation('submit'),
    mutationFn: (record: Record<string, unknown>) => submitStep(detail.step.id, record, [], staffIntentKey(sendIntent, 'submit')),
    onSuccess: (result) => {
      clearStaffIntentKey(sendIntent);
      sentToast(result);
      void refresh();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  if (reads.tournament.isPending) return <SkeletonList rows={2} height={64} />;
  if (!ctx) return <Hint>{t(mapStaffError(reads.tournament.error))}</Hint>;
  const courtName = (id: string) => {
    const w = windows.find((x) => x.courtId === id);
    return w ? (bilingual(locale, w.courtName.en, w.courtName.ar) ?? '') : '';
  };

  return (
    <Section title={t('staff.protocols.courts.title')}>
      <Strong>{bilingual(locale, ctx.name.en, ctx.name.ar) ?? ''}</Strong>
      <Muted>{t('staff.protocols.courts.lead')}</Muted>
      {windows.length === 0 ? <Hint>{t('staff.protocols.courts.none')}</Hint> : null}
      {windows.map((w) => (
        <View key={w.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
          <Muted style={{ flexShrink: 1, color: colors.ink }}>
            {`${bilingual(locale, w.courtName.en, w.courtName.ar) ?? ''} · ${formatDateTime(new Date(w.from), locale)} – ${formatDateTime(new Date(w.to), locale)}`}
          </Muted>
          <Muted style={{ color: w.reservationId ? colors.gtext : colors.ambtext }}>
            {t(w.reservationId ? 'staff.protocols.courts.blocked' : 'staff.protocols.courts.toBlock')}
          </Muted>
        </View>
      ))}
      {conflicts.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Muted style={{ color: colors.redtext }}>{t('staff.protocols.courts.conflictBody')}</Muted>
          {conflicts.map((c) => (
            <Muted key={c.reservationId}>
              {`${courtName(c.courtId)} · ${formatDateTime(new Date(c.startAt), locale)} · ${
                c.kind === 'booking' || c.kind === 'hold' || c.kind === 'maintenance'
                  ? t(`staff.protocols.courts.conflict.${c.kind}`)
                  : c.kind
              }`}
            </Muted>
          ))}
        </View>
      ) : null}
      {remaining.length > 0 ? (
        <Button
          testID="staff-step.block.submit"
          label={
            conflicts.length > 0
              ? t('staff.protocols.courts.checkAgain')
              : t('staff.protocols.courts.blockAll', { count: remaining.length })
          }
          variant="secondary"
          size="compact"
          busy={block.isPending}
          onPress={() => {
            setError(null);
            block.mutate(remaining);
          }}
        />
      ) : windows.length > 0 ? (
        <Muted style={{ color: colors.gtext }}>{t('staff.protocols.courts.allBlocked')}</Muted>
      ) : null}
      {remaining.length > 0 && windows.length > remaining.length ? (
        <Hint>{t('staff.protocols.courts.remaining', { count: remaining.length })}</Hint>
      ) : null}
      <Field
        testID="staff-step.field.moved_note"
        label={t('staff.protocols.field.movedNote')}
        value={note}
        onChangeText={setNote}
        multiline
        boxStyle={MULTILINE_BOX}
        style={MULTILINE_TEXT}
        maxLength={2000}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        testID="staff-step.submit"
        label={t('staff.protocols.step.submit')}
        variant="primary"
        busy={send.isPending}
        onPress={() => {
          setError(null);
          const record = courtsRecord(ctx, note);
          if (record.reservation_ids.length === 0) {
            setError(t('staff.protocols.courts.needsBlock'));
            return;
          }
          send.mutate(record);
        }}
      />
    </Section>
  );
}

// ── Hiring interviews (a manager) ───────────────────────────────────────────

interface CandidateDraft {
  id: string | null;
  name: string;
  phone: string;
  brief: string;
  interviewAt: string;
  pickReason: string;
  picked: boolean;
}

export function CandidatesForm({ detail, reads }: StepFormProps) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const refresh = useRefreshProtocols();
  const sentToast = useSentToast();
  const toast = useToast();
  const [editing, setEditing] = useState<CandidateDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = detail.run.id;
  const list = reads.candidates.data?.candidates ?? [];
  const sendIntent = submitIntent(detail.step);
  // A save is keyed by exactly what it sends: a lost answer's key can only
  // ever replay that same candidate, never swallow the next one.
  const saveIntent = (v: { id: string | null; candidate: CandidateInput }) => intentFor('candidate', { runId, ...v });

  const save = useMutation({
    mutationKey: staffKeys.mutation('candidate'),
    mutationFn: (v: { id: string | null; candidate: CandidateInput }) =>
      saveHiringCandidate(runId, v.candidate, v.id, staffIntentKey(saveIntent(v), 'candidate')),
    onSuccess: (_, v) => {
      clearStaffIntentKey(saveIntent(v));
      setEditing(null);
      toast(t('staff.protocols.candidates.saved'), 'success');
      void reads.candidates.refetch();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const remove = useMutation({
    mutationKey: staffKeys.mutation('candidate.delete'),
    mutationFn: (id: string) => deleteHiringCandidate(id),
    onSuccess: () => void reads.candidates.refetch(),
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const send = useMutation({
    mutationKey: staffKeys.mutation('submit'),
    mutationFn: (record: Record<string, unknown>) => submitStep(detail.step.id, record, [], staffIntentKey(sendIntent, 'submit')),
    onSuccess: (result) => {
      clearStaffIntentKey(sendIntent);
      sentToast(result);
      void refresh();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  if (reads.candidates.isPending) return <SkeletonList rows={2} height={64} />;
  if (reads.candidates.isError) return <Hint>{t(mapStaffError(reads.candidates.error))}</Hint>;

  const draftOf = (id: string | null): CandidateDraft => {
    const c = list.find((x) => x.id === id);
    return {
      id,
      name: c?.candidate_name ?? '',
      phone: c?.candidate_phone ?? '',
      brief: c?.brief ?? '',
      interviewAt: c?.interview_at ? venueDateTimeText(c.interview_at) : '',
      pickReason: c?.pick_reason ?? '',
      picked: c?.picked ?? false,
    };
  };

  return (
    <Section title={t('staff.protocols.candidates.title')}>
      {reads.candidates.data?.purged ? <Hint>{t('staff.protocols.candidates.purged')}</Hint> : null}
      <Muted>{t('staff.protocols.candidates.privacy')}</Muted>
      {list.length === 0 ? <Hint>{t('staff.protocols.candidates.none')}</Hint> : null}
      {list.map((c) => (
        <View
          key={c.id}
          testID={`staff-step.candidate.${c.id}`}
          style={{ gap: 2, paddingTop: space.s, borderTopWidth: 1, borderTopColor: colors.sub }}
        >
          <Strong>{c.picked ? `${c.candidate_name} · ${t('staff.protocols.candidates.picked')}` : c.candidate_name}</Strong>
          <Muted>{c.candidate_phone}</Muted>
          {c.interview_at ? <Muted>{`${t('staff.protocols.candidates.interviewAt')}: ${formatDateTime(new Date(c.interview_at), locale)}`}</Muted> : null}
          {c.brief ? <Muted>{c.brief}</Muted> : null}
          {c.pick_reason ? <Muted>{isolate(c.pick_reason)}</Muted> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {!c.picked ? (
              <Button
                testID={`staff-step.candidate.${c.id}.pick`}
                label={t('staff.protocols.candidates.pick')}
                variant="secondary"
                size="compact"
                onPress={() => setEditing({ ...draftOf(c.id), picked: true })}
              />
            ) : null}
            <Button
              testID={`staff-step.candidate.${c.id}.edit`}
              label={t('staff.protocols.candidates.edit')}
              variant="ghost"
              onPress={() => setEditing(draftOf(c.id))}
            />
            <Button
              testID={`staff-step.candidate.${c.id}.delete`}
              label={t('staff.protocols.candidates.delete')}
              variant="ghost"
              busy={remove.isPending && remove.variables === c.id}
              onPress={() =>
                Alert.alert(t('staff.protocols.candidates.delete'), t('staff.protocols.candidates.deleteConfirm'), [
                  { text: t('staff.protocols.candidates.cancel'), style: 'cancel' },
                  { text: t('staff.protocols.candidates.delete'), style: 'destructive', onPress: () => remove.mutate(c.id) },
                ])
              }
            />
          </View>
        </View>
      ))}
      {editing ? (
        <View style={{ gap: space.s, paddingTop: space.s, borderTopWidth: 1, borderTopColor: colors.sub }}>
          <Field
            testID="staff-step.candidate.name"
            label={t('staff.protocols.candidates.name')}
            value={editing.name}
            onChangeText={(name) => setEditing({ ...editing, name })}
            maxLength={80}
          />
          <Field
            testID="staff-step.candidate.phone"
            label={t('staff.protocols.candidates.phone')}
            value={editing.phone}
            onChangeText={(phone) => setEditing({ ...editing, phone })}
            keyboardType="phone-pad"
            latin
            maxLength={32}
          />
          <Field
            testID="staff-step.candidate.interview-at"
            label={t('staff.protocols.form.optionalLabel', { label: t('staff.protocols.candidates.interviewAt') })}
            value={editing.interviewAt}
            onChangeText={(interviewAt) => setEditing({ ...editing, interviewAt })}
            keyboardType="numbers-and-punctuation"
            latin
          />
          <Field
            testID="staff-step.candidate.brief"
            label={t('staff.protocols.form.optionalLabel', { label: t('staff.protocols.candidates.brief') })}
            value={editing.brief}
            onChangeText={(brief) => setEditing({ ...editing, brief })}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            maxLength={1000}
          />
          {editing.picked ? (
            <Field
              testID="staff-step.candidate.pick-reason"
              label={t('staff.protocols.form.optionalLabel', { label: t('staff.protocols.candidates.pickReason') })}
              value={editing.pickReason}
              onChangeText={(pickReason) => setEditing({ ...editing, pickReason })}
              multiline
              boxStyle={MULTILINE_BOX}
              style={MULTILINE_TEXT}
              maxLength={1000}
            />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              testID="staff-step.candidate.cancel"
              label={t('staff.protocols.candidates.cancel')}
              variant="secondary"
              size="compact"
              onPress={() => setEditing(null)}
              style={{ flex: 1 }}
            />
            <Button
              testID="staff-step.candidate.save"
              label={t('staff.protocols.candidates.save')}
              variant="primary"
              size="compact"
              busy={save.isPending}
              onPress={() => {
                setError(null);
                if (!editing.name.trim() || !editing.phone.trim()) {
                  setError(t('staff.protocols.form.required'));
                  return;
                }
                if (editing.interviewAt.trim() && !parseVenueDateTime(editing.interviewAt)) {
                  setError(t('staff.protocols.form.invalid'));
                  return;
                }
                save.mutate({
                  id: editing.id,
                  candidate: {
                    candidate_name: editing.name.trim(),
                    candidate_phone: editing.phone.trim(),
                    brief: editing.brief.trim(),
                    interview_at: editing.interviewAt.trim() ? parseVenueDateTime(editing.interviewAt) : null,
                    picked: editing.picked,
                    pick_reason: editing.pickReason.trim() || null,
                  },
                });
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <Button
          testID="staff-step.candidate.add"
          label={t('staff.protocols.candidates.add')}
          variant="secondary"
          size="compact"
          onPress={() => setEditing(draftOf(null))}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
      <ErrorText>{error}</ErrorText>
      <Button
        testID="staff-step.submit"
        label={t('staff.protocols.step.submit')}
        variant="primary"
        busy={send.isPending}
        onPress={() => {
          setError(null);
          const record = interviewsRecord(list);
          if (!record.picked_id) {
            setError(t('staff.protocols.candidates.pickFirst'));
            return;
          }
          send.mutate(record);
        }}
      />
    </Section>
  );
}

// ── Hiring add_staff (the owner) ────────────────────────────────────────────

/**
 * The new account, then its id. Creating it is never retried on its own: a
 * create whose answer was lost has made the account, and a second try only
 * says the email is taken. So the form also lists the accounts the step can
 * take (active, in the position's role, made since the run started: the rule
 * `protocol_check_hiring_add_staff` applies), and the owner picks the one
 * already made, after a lost answer or when coming back to the step.
 */
export function AddStaffForm({ detail, runDetail }: StepFormProps) {
  const { t, locale } = useLocale();
  const roleText = useRolesText();
  const refresh = useRefreshProtocols();
  const sentToast = useSentToast();
  const toast = useToast();
  const role = runDetail ? positionRole(runDetail.steps) : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<{ id: string; display_name: string; made: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendIntent = submitIntent(detail.step);

  const hires = useQuery({
    queryKey: staffKeys.newHires(detail.run.id),
    queryFn: () => fetchNewHires(role as StaffRole, detail.run.started_at),
    enabled: role !== null && chosen === null,
  });

  const create = useMutation({
    mutationKey: staffKeys.mutation('staff.create'),
    mutationFn: () => createStaffAccount({ email: email.trim(), password, displayName: name.trim(), role: role as StaffRole }),
    // Not keyed, so never retried: a lost answer is found in the list below.
    retry: false,
    onSuccess: (account) => {
      setChosen({ ...account, made: true });
      toast(t('staff.protocols.addStaff.created', { name: account.display_name }), 'success');
    },
    onError: (err) => {
      setError(t(mapStaffError(err)));
      void hires.refetch();
    },
  });

  const send = useMutation({
    mutationKey: staffKeys.mutation('submit'),
    mutationFn: (staffId: string) => submitStep(detail.step.id, { staff_id: staffId }, [], staffIntentKey(sendIntent, 'submit')),
    onSuccess: (result) => {
      clearStaffIntentKey(sendIntent);
      sentToast(result);
      void refresh();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  if (!runDetail) return <SkeletonList rows={2} height={64} />;
  if (!role) return <Hint>{t('staff.protocols.addStaff.roleUnknown')}</Hint>;
  const found = hires.data ?? [];

  return (
    <Section title={t('staff.protocols.addStaff.title')}>
      <Muted>{t('staff.protocols.addStaff.lead', { role: roleText([role]) })}</Muted>
      {chosen ? (
        <>
          <Strong>
            {t(chosen.made ? 'staff.protocols.addStaff.created' : 'staff.protocols.addStaff.chosen', { name: chosen.display_name })}
          </Strong>
          {chosen.made ? null : (
            <Button
              testID="staff-step.hire.change"
              label={t('staff.protocols.addStaff.change')}
              variant="ghost"
              disabled={send.isPending}
              onPress={() => {
                setChosen(null);
                setError(null);
              }}
            />
          )}
        </>
      ) : (
        <>
          {found.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Strong style={{ fontSize: 13.5 }}>{t('staff.protocols.addStaff.existingTitle')}</Strong>
              <Muted>{t('staff.protocols.addStaff.existingHint', { role: roleText([role]) })}</Muted>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {found.map((h) => (
                  <Chip
                    key={h.id}
                    testID={`staff-step.hire.${h.id}`}
                    label={`${h.display_name} · ${formatDateTime(new Date(h.created_at), locale)}`}
                    selected={false}
                    onPress={() => {
                      setChosen({ id: h.id, display_name: h.display_name, made: false });
                      setError(null);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <Field
            testID="staff-step.field.email"
            label={t('staff.protocols.addStaff.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            latin
          />
          <Field
            testID="staff-step.field.password"
            label={t('staff.protocols.addStaff.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            maxLength={72}
          />
          <Hint>{t('staff.protocols.addStaff.passwordHint')}</Hint>
          <Field
            testID="staff-step.field.display-name"
            label={t('staff.protocols.addStaff.displayName')}
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
          <Muted>{t('staff.protocols.addStaff.roleLocked', { role: roleText([role]) })}</Muted>
          <Button
            testID="staff-step.create"
            label={t('staff.protocols.addStaff.create')}
            variant="secondary"
            busy={create.isPending}
            onPress={() => {
              setError(null);
              if (!email.includes('@') || password.length < 10 || password.length > 72 || !name.trim()) {
                setError(t('staff.protocols.step.checkForm'));
                return;
              }
              create.mutate();
            }}
          />
        </>
      )}
      <Hint>{t('staff.protocols.addStaff.pinNote')}</Hint>
      <ErrorText>{error}</ErrorText>
      <Button
        testID="staff-step.submit"
        label={t('staff.protocols.addStaff.send')}
        variant="primary"
        busy={send.isPending}
        disabled={!chosen}
        onPress={() => chosen && send.mutate(chosen.id)}
      />
    </Section>
  );
}
