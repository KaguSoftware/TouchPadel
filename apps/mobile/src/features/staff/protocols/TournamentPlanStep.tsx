/**
 * One page of the tournament start on the staff phone (owner, 2026-10-16):
 * the operator's "Start: Tournament" sections (Name, Courts & time, Players &
 * money, Risks & notes, Sponsor), each a page of its own with its step and a
 * progress bar on top and one way on at the bottom: the next step, and on the
 * last the start. The native back goes back a step; the plan stays in
 * tournamentDraft.ts while the pages come and go.
 *
 * Next checks only the page's own section with the start's validator, so a
 * step is finished before the next opens; the start checks them all and goes
 * back to the first page with something to fix. The record and its sections
 * are the operator's (`@touch/core/protocols` tournamentPlan.ts).
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  cellKey,
  hourColumns,
  isFullPlan,
  planRecord,
  slotsOf,
  toggleClass,
  tradingSpan,
  wallTimeToUtc,
  type FieldIssue,
  type PlanClass,
  type PlanFormat,
  type PlanSection,
  type PlanSlot,
  type PlanSponsor,
  type PlanUnit,
  type TournamentVariant,
  type Window,
} from '@touch/core';
import {
  asciiDigits,
  formatDayNumber,
  formatIQD,
  formatTimeRange,
  formatWeekdayShort,
  type MessageKey,
} from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../../theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen } from '../../../components/ui';
import { ErrorState, SkeletonList } from '../../../components/states';
import { useToast } from '../../../components/overlays';
import { CheckIcon, CloseIcon, LockIcon, MinusIcon, PlusIcon, type IconProps } from '../../../components/icons';
import { DayChip } from '../../../components/booking';
import { listBookableDates, DEFAULT_TZ } from '../../availability/assemble';
import { useVenueSettings } from '../../availability/hooks';
import { clearStaffIntentKey, staffIntentKey } from '../../../lib/idempotency';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { fetchCourtBookings, fetchCourts, startProtocol } from './api';
import { bilingual } from './logic';
import { MULTILINE_BOX, MULTILINE_TEXT } from './multiline';
import { issueMessageKey, serverIssue, useRefreshProtocols } from './parts';
import { dropDraft, updateDraft, useTournamentDraft, type TournamentDraft } from './tournamentDraft';
import {
  bookedHours,
  issueAt,
  issuesOnStep,
  numericText,
  phoneSteps,
  planIssues,
  stepCount,
  stepOfIssue,
  type PlanStep,
} from './tournamentSteps';

const F = 'ws.team.tasks.form.field';
const S = 'ws.tournaments.start';
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type Tone = 'red' | 'amber' | 'green' | 'blue' | 'grey';

const CLASSES: readonly { value: PlanClass; tone: Tone }[] = [
  { value: 'A', tone: 'red' },
  { value: 'B', tone: 'amber' },
  { value: 'C', tone: 'green' },
];
/** Green where the app runs the format, grey where it is a plan only. */
const FORMATS: readonly { value: PlanFormat; tone: Tone }[] = [
  { value: 'americano', tone: 'green' },
  { value: 'mexicano', tone: 'green' },
  { value: 'knockout', tone: 'grey' },
  { value: 'league', tone: 'grey' },
];
/** A type's pill: the club's own blue, community green, a sponsor's amber (the operator's). */
export const TYPE_TONE: Record<TournamentVariant, Tone> = { type1: 'blue', type2: 'green', type3: 'amber' };
const BOOKING_KINDS = ['booking', 'hold', 'maintenance', 'lesson'] as const;

export function useTone(tone: Tone): { bg: string; fg: string } {
  const { colors } = useTheme();
  return {
    red: { bg: colors.redtint, fg: colors.redtext },
    amber: { bg: colors.amb, fg: colors.ambtext },
    green: { bg: colors.gtint, fg: colors.gtext },
    blue: { bg: colors.tint, fg: colors.blue },
    grey: { bg: colors.sub, fg: colors.mut },
  }[tone];
}

/** A small coloured label: a class's level, a format's "Runs in the app", a type's kind. */
export function TonePill({ label, tone }: { label: string; tone: Tone }) {
  const { fonts } = useTheme();
  const c = useTone(tone);
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: c.bg }}>
      <Text numberOfLines={1} style={{ fontFamily: fonts.body700, fontSize: 11, color: c.fg }}>
        {label}
      </Text>
    </View>
  );
}

/** One choice of a set (a class, a format, the capacity unit): a card with a radio at its end. */
function OptionCard({
  testID,
  on,
  title,
  tag,
  body,
  multiple = false,
  onPick,
}: {
  testID: string;
  on: boolean;
  title: string;
  tag?: { label: string; tone: Tone } | null;
  body?: string | null;
  /** One of several that may all be on (the classes, 0354): a checkbox, not a radio. */
  multiple?: boolean;
  onPick: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: on }}
      onPress={() => {
        if (!on) void Haptics.selectionAsync().catch(() => undefined);
        onPick();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.m,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: on ? colors.blue : colors.line,
        backgroundColor: on ? colors.tint : pressed ? colors.sub : colors.card,
      })}
    >
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 20, color: colors.ink }}>{title}</Text>
          {tag ? <TonePill label={tag.label} tone={tag.tone} /> : null}
        </View>
        {body ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>{body}</Text>
        ) : null}
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: on ? 0 : 1.5,
          borderColor: colors.line2,
          backgroundColor: on ? colors.blue : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on ? <CheckIcon size={14} color={colors.card} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

/** A group's heading, and what is wrong with the group under it. */
function Group({ title, hint, error, children }: { title: string; hint?: string; error?: string | null; children: ReactNode }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: space.s }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
        {title}
      </Text>
      {hint ? <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>{hint}</Text> : null}
      {children}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

function RoundButton({
  testID,
  icon: Icon,
  label,
  onPress,
}: {
  testID: string;
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.seg : colors.sub,
      })}
    >
      <Icon size={20} color={colors.ink} strokeWidth={2.5} />
    </Pressable>
  );
}

export function TournamentPlanStep({
  planId,
  variant,
  step,
  depth,
  byOwner,
  venueId,
}: {
  planId: string;
  variant: TournamentVariant;
  step: PlanStep;
  /** The start's pages above the first (staff-start.tsx `depth`), taken off when the start lands. */
  depth: number;
  byOwner: boolean;
  venueId: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const scroll = useRef<ScrollView>(null);
  const draft = useTournamentDraft(planId, variant);
  const { plan } = draft;
  const settings = useVenueSettings(venueId);
  const courts = useQuery({ queryKey: staffKeys.courts(venueId), queryFn: () => fetchCourts(venueId) });
  const tz = settings.data?.timezone ?? DEFAULT_TZ;
  const courtOrder = (courts.data ?? []).map((c) => c.id);
  const full = isFullPlan(variant);
  const steps = phoneSteps(variant);
  const at = steps.indexOf(step);
  const nextStep = steps[at + 1];
  const update = (patch: Parameters<typeof updateDraft>[2]) => updateDraft(planId, variant, patch);
  const set = (p: Partial<TournamentDraft['plan']>) => update({ plan: p });
  const setSponsor = (p: Partial<PlanSponsor>) => set({ sponsor: { ...plan.sponsor, ...p } });

  const label = (s: PlanSection) =>
    t(
      (s === 'players' && !full
        ? `${S}.sections.playersShort`
        : s === 'notes' && !full
          ? `${S}.sections.notesShort`
          : `${S}.sections.${s}`) as MessageKey,
    );
  const mine = issuesOnStep(draft.issues, step, variant);
  const issueText = (path: string, blank: boolean) => {
    const i = issueAt(mine, path);
    return i ? t(issueMessageKey(i, blank)) : null;
  };

  const start = useMutation({
    mutationKey: staffKeys.mutation('start'),
    mutationFn: () =>
      startProtocol({
        kind: 'tournament',
        variant,
        titleEn: plan.nameEn.trim() || null,
        titleAr: plan.nameAr.trim() || null,
        data: {},
        record: planRecord(plan, tz, courtOrder),
        photos: [],
        venueId,
        idempotencyKey: staffIntentKey(draft.intent, 'start'),
      }),
    onSuccess: (result) => {
      clearStaffIntentKey(draft.intent);
      toast(t(result.auto ? 'staff.protocols.start.startedAuto' : 'staff.protocols.start.started'), 'success');
      void refresh();
      dropDraft(planId);
      // The start's pages come off, so back from the run leaves the start.
      if (depth > 0) router.dismiss(depth);
      router.replace({ pathname: '/staff-run', params: { id: result.run_id } });
    },
    onError: (err) => {
      const issue = serverIssue(err);
      if (issue) show([issue]);
    },
  });

  /** Show issues: on this page, or back on the first page that has one. */
  function show(issues: FieldIssue[]) {
    update({ issues });
    const first = Math.min(...issues.map((i) => steps.indexOf(stepOfIssue(i, variant))));
    if (first >= 0 && first < at) {
      toast(t('staff.protocols.start.tournament.earlierStep'), 'error');
      router.dismiss(Math.min(at - first, depth));
    } else {
      scroll.current?.scrollTo({ y: 0, animated: true });
    }
  }

  function onNext() {
    const all = planIssues(plan, tz, courtOrder, byOwner);
    if (!nextStep) {
      if (all.length > 0) return show(all);
      update({ issues: [] });
      start.mutate();
      return;
    }
    const here = issuesOnStep(all, step, variant);
    if (here.length > 0) return show(here);
    update({ issues: [] });
    router.push({
      pathname: '/staff-start',
      params: { kind: 'tournament', variant, plan: planId, step: nextStep, depth: String(depth + 1) },
    });
  }

  const numberField = (testID: string, key: MessageKey, value: string, onChange: (v: string) => void, error: string | null, iqd = false) => {
    const n = Number(value.replace(/,/g, ''));
    return (
      <View style={{ gap: 4 }}>
        <Field
          testID={testID}
          label={t(key)}
          value={value}
          onChangeText={(v) => onChange(numericText(asciiDigits(v)))}
          keyboardType="number-pad"
          latin
          editable={!start.isPending}
          error={error}
        />
        {iqd && value.trim() && Number.isFinite(n) ? <Hint>{formatIQD(n, locale)}</Hint> : null}
      </View>
    );
  };
  const textField = (testID: string, key: MessageKey, value: string, onChange: (v: string) => void, error: string | null, opts: { multiline?: boolean; latin?: boolean } = {}) => (
    <Field
      testID={testID}
      label={t(key)}
      value={value}
      onChangeText={onChange}
      multiline={opts.multiline}
      boxStyle={opts.multiline ? MULTILINE_BOX : undefined}
      style={opts.multiline ? MULTILINE_TEXT : undefined}
      latin={opts.latin}
      editable={!start.isPending}
      error={error}
    />
  );

  const body = (() => {
    switch (step) {
      case 'name':
        return (
          <>
            <Card style={{ padding: space.m, gap: 2 }}>
              {textField('staff-start.plan.name_en', `${F}.name_en` as MessageKey, plan.nameEn, (nameEn) => set({ nameEn }), issueText('name_en', plan.nameEn.trim() === ''), { latin: true })}
              {textField('staff-start.plan.name_ar', `${F}.name_ar` as MessageKey, plan.nameAr, (nameAr) => set({ nameAr }), issueText('name_ar', plan.nameAr.trim() === ''))}
            </Card>
            {/* 0354: one or more classes; the years played are no longer asked. */}
            <Group
              title={t(`${F}.classes` as MessageKey)}
              hint={t(`${S}.classesHint` as MessageKey)}
              error={issueText('classes', plan.classes.length === 0)}
            >
              {CLASSES.map((c) => (
                <OptionCard
                  key={c.value}
                  testID={`staff-start.plan.class.${c.value}`}
                  multiple
                  on={plan.classes.includes(c.value)}
                  title={t(`ws.team.tasks.form.option.class${c.value}` as MessageKey)}
                  tag={{ label: t(`${S}.classes.${c.value}.tag` as MessageKey), tone: c.tone }}
                  body={t(`${S}.classes.${c.value}.body` as MessageKey)}
                  onPick={() => set({ classes: toggleClass(plan.classes, c.value) })}
                />
              ))}
            </Group>
            {full ? (
              <Group title={t(`${F}.format` as MessageKey)} error={issueText('format', plan.format === null)}>
                {FORMATS.map((f) => (
                  <OptionCard
                    key={f.value}
                    testID={`staff-start.plan.format.${f.value}`}
                    on={plan.format === f.value}
                    title={t(`ws.team.tasks.form.option.${f.value}` as MessageKey)}
                    tag={{ label: t(`${S}.formats.${f.value}.tag` as MessageKey), tone: f.tone }}
                    body={t(`${S}.formats.${f.value}.body` as MessageKey)}
                    onPick={() => set({ format: f.value })}
                  />
                ))}
              </Group>
            ) : null}
          </>
        );
      case 'courts':
        return (
          <CourtsStep
            draft={draft}
            onDay={(day) => update({ day })}
            onPicks={(picks) => set({ picks })}
            settings={settings}
            courts={courts}
            tz={tz}
            venueId={venueId}
            error={issueText('ranges', plan.picks.length === 0)}
          />
        );
      case 'players':
        return (
          <>
            <Group title={t(`${F}.capacityUnit` as MessageKey)}>
              {(['players', 'pairs'] as const satisfies readonly PlanUnit[]).map((u) => (
                <OptionCard
                  key={u}
                  testID={`staff-start.plan.unit.${u}`}
                  on={plan.unit === u}
                  title={t(`ws.team.tasks.form.option.${u}` as MessageKey)}
                  body={t(u === 'players' ? `${S}.capacityPlayers` : `${S}.capacityPairs`)}
                  onPick={() => set({ unit: u })}
                />
              ))}
            </Group>
            <Group title={t(`${F}.capacityCount` as MessageKey)} error={issueText('capacity', plan.count.trim() === '')}>
              <Card style={{ padding: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <RoundButton
                  testID="staff-start.plan.count.less"
                  icon={MinusIcon}
                  label="−"
                  onPress={() => set({ count: stepCount(plan.count, -1) })}
                />
                <View style={{ flex: 1 }}>
                  <Field
                    testID="staff-start.plan.count"
                    value={plan.count}
                    onChangeText={(v) => set({ count: numericText(asciiDigits(v)) })}
                    keyboardType="number-pad"
                    latin
                    editable={!start.isPending}
                    style={{ textAlign: 'center', fontFamily: fonts.display800, fontSize: 20 }}
                    accessibilityLabel={t(`${F}.capacityCount` as MessageKey)}
                  />
                </View>
                <RoundButton
                  testID="staff-start.plan.count.more"
                  icon={PlusIcon}
                  label="+"
                  onPress={() => set({ count: stepCount(plan.count, 1) })}
                />
              </Card>
            </Group>
            {full ? (
              <Card style={{ padding: space.m, gap: 2 }}>
                {numberField('staff-start.plan.expected', `${F}.expected_entries` as MessageKey, plan.expected, (expected) => set({ expected }), issueText('expected_entries', false))}
                {numberField('staff-start.plan.fee', `${F}.entry_fee_iqd` as MessageKey, plan.fee, (fee) => set({ fee }), issueText('entry_fee_iqd', false), true)}
                {textField('staff-start.plan.prize_text', `${F}.prizeText` as MessageKey, plan.prizeText, (prizeText) => set({ prizeText }), issueText('prize.text', false))}
                {numberField('staff-start.plan.prize_iqd', `${F}.prizeIqd` as MessageKey, plan.prizeIqd, (prizeIqd) => set({ prizeIqd }), issueText('prize.iqd', false), true)}
                {numberField('staff-start.plan.budget', `${F}.budget_iqd` as MessageKey, plan.budget, (budget) => set({ budget }), issueText('budget_iqd', false), true)}
              </Card>
            ) : null}
          </>
        );
      case 'notes':
        return (
          <Card style={{ padding: space.m, gap: 2 }}>
            <Hint>{t(`${S}.optional`)}</Hint>
            {full
              ? textField('staff-start.plan.risks', `${F}.risks` as MessageKey, plan.risks, (risks) => set({ risks }), issueText('risks', false), { multiline: true })
              : null}
            {textField('staff-start.plan.notes', `${F}.notes` as MessageKey, plan.notes, (notes) => set({ notes }), issueText('notes', false), { multiline: true })}
          </Card>
        );
      case 'sponsor': {
        const whole = mine.find((i) => i.field === 'sponsor');
        return (
          <>
            {whole ? <ErrorText>{t(issueMessageKey(whole, true))}</ErrorText> : null}
            <Card style={{ padding: space.m, gap: 2 }}>
              {textField('staff-start.plan.sponsor_name', `${F}.sponsorName` as MessageKey, plan.sponsor.name, (name) => setSponsor({ name }), issueText('sponsor.name', plan.sponsor.name.trim() === ''))}
              {textField('staff-start.plan.sponsor_contact', `${F}.contact` as MessageKey, plan.sponsor.contact, (contact) => setSponsor({ contact }), issueText('sponsor.contact', plan.sponsor.contact.trim() === ''))}
              {numberField('staff-start.plan.sponsor_contribution', `${F}.contribution_iqd` as MessageKey, plan.sponsor.contribution, (contribution) => setSponsor({ contribution }), issueText('sponsor.contribution_iqd', plan.sponsor.contribution.trim() === ''), true)}
              {textField('staff-start.plan.sponsor_branding', `${F}.branding` as MessageKey, plan.sponsor.branding, (branding) => setSponsor({ branding }), issueText('sponsor.branding', false), { multiline: true })}
            </Card>
            <Card style={{ padding: space.m, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
              <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 14, color: colors.ink }}>
                {t(`${F}.invoice` as MessageKey)}
              </Text>
              <Switch
                testID="staff-start.plan.sponsor_invoice"
                accessibilityLabel={t(`${F}.invoice` as MessageKey)}
                value={plan.sponsor.invoice}
                onValueChange={(invoice) => setSponsor({ invoice })}
                disabled={start.isPending}
                trackColor={{ true: brand.blue, false: colors.seg }}
              />
            </Card>
          </>
        );
      }
    }
  })();

  const serverError =
    start.error && !serverIssue(start.error) ? t(mapStaffError(start.error)) : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('work.protocol.kind.tournament') }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ paddingTop: space.m, paddingBottom: space.xl, gap: space.l }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Where the start is: a bar a step, the step's number and its name. */}
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {steps.map((s, i) => (
                <View
                  key={s}
                  style={{
                    flex: 1,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: i < at ? colors.gstrong : i === at ? colors.blue : colors.seg,
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
              <MicroLabel style={{ color: colors.blue, letterSpacing: tracking(0.8) }}>
                {t('staff.protocols.start.tournament.stepOf', { n: String(at + 1), total: String(steps.length) })}
              </MicroLabel>
              <TonePill
                label={`${t(`${S}.typeName.${variant}`)} · ${t(`${S}.typeTag.${variant}`)}`}
                tone={TYPE_TONE[variant]}
              />
            </View>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display800, fontSize: 26, lineHeight: 32, color: colors.ink }}>
              {label(step)}
            </Text>
          </View>
          {body}
        </ScrollView>
        {/* One way on: the next step, and on the last the start itself. */}
        <View
          style={{
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.m),
            paddingHorizontal: space.l,
            marginHorizontal: -space.l,
            gap: space.s,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.bg,
          }}
        >
          {serverError ? <ErrorText>{serverError}</ErrorText> : null}
          {nextStep ? (
            <Button
              testID="staff-start.plan.next"
              label={t('staff.protocols.start.tournament.next', { step: label(nextStep) })}
              onPress={onNext}
            />
          ) : (
            <Button
              testID="staff-start.submit"
              label={t(`${S}.submit`)}
              variant="cta"
              busy={start.isPending}
              onPress={onNext}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * Courts & time: the day as a strip of day chips, then the day's courts as
 * columns and its hours as rows; a tap picks an hour or takes it off. A
 * booked or started hour cannot be picked, and a tap on one says why. The
 * picks of every day are listed under it as slots, each one tap to take off.
 */
function CourtsStep({
  draft,
  onDay,
  onPicks,
  settings,
  courts,
  tz,
  venueId,
  error,
}: {
  draft: TournamentDraft;
  onDay: (day: string) => void;
  onPicks: (picks: string[]) => void;
  settings: ReturnType<typeof useVenueSettings>;
  courts: { data?: { id: string; name_en: string | null; name_ar: string | null }[]; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  tz: string;
  venueId: string;
  error: string | null;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const picks = draft.plan.picks;
  // The time an hour counts as started against, a minute at a time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const dates = settings.data ? listBookableDates(new Date(now), tz, 60, settings.data) : [];
  const day = draft.day && dates.includes(draft.day) ? draft.day : (dates[0] ?? null);
  const hours = (settings.data?.opening_hours ?? {}) as Partial<Record<(typeof DAY_KEYS)[number], readonly Window[]>>;
  const dayIndex = day ? new Date(`${day}T12:00:00Z`).getUTCDay() : 0;
  const span = tradingSpan(hours[DAY_KEYS[dayIndex]!], hours[DAY_KEYS[(dayIndex + 1) % 7]!]);
  const closedDates = settings.data?.closed_dates ?? [];
  const columns = day && !closedDates.includes(day) ? hourColumns(span.startMin, span.endMin) : [];
  const from = day && columns.length ? wallTimeToUtc(day, columns[0]!, tz).toISOString() : '';
  const to = day && columns.length ? wallTimeToUtc(day, columns[columns.length - 1]! + 60, tz).toISOString() : '';
  const bookings = useQuery({
    queryKey: staffKeys.courtBookings(venueId, day ?? ''),
    queryFn: () => fetchCourtBookings(venueId, from, to),
    enabled: day !== null && columns.length > 0,
    refetchInterval: 60_000,
  });
  const booked = day ? bookedHours(bookings.data ?? [], day, columns, tz) : new Map();
  const picked = new Set(picks);
  const list = courts.data ?? [];
  const courtName = (id: string) => {
    const c = list.find((x) => x.id === id);
    return c ? (bilingual(locale, c.name_en, c.name_ar) ?? '') : '—';
  };
  const slots = slotsOf(picks, list.map((c) => c.id));
  const range = (date: string, a: number, b: number) =>
    formatTimeRange(wallTimeToUtc(date, a, tz), wallTimeToUtc(date, b, tz), locale, tz);
  const hourLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00`;

  if (settings.isPending || courts.isPending) return <SkeletonList rows={4} height={56} />;
  if (courts.isError) {
    return (
      <ErrorState
        testID="staff-start.plan.courts-error"
        title={t('errors.loadFailedTitle')}
        message={t(mapStaffError(courts.error))}
        retryLabel={t('common.retry')}
        onRetry={() => void courts.refetch()}
      />
    );
  }

  const tap = (k: string, courtId: string, m: number) => {
    const on = picked.has(k);
    const why = booked.get(`${courtId}|${m}`) as { kind: string; start_at: string; end_at: string }[] | undefined;
    if (why && !on) {
      const first = why[0]!;
      const kind = (BOOKING_KINDS as readonly string[]).includes(first.kind)
        ? t(`ws.courtDesk.detail.kindLabel.${first.kind}` as MessageKey)
        : null;
      const when = formatTimeRange(new Date(first.start_at), new Date(first.end_at), locale, tz);
      toast([t(`${S}.courts.booked`), kind, when].filter(Boolean).join(' · '), 'info');
      return;
    }
    if (!on && day && wallTimeToUtc(day, m, tz).getTime() < now) {
      toast(t('staff.protocols.start.tournament.pastHour'), 'info');
      return;
    }
    void Haptics.selectionAsync().catch(() => undefined);
    onPicks(on ? picks.filter((x) => x !== k) : [...picks, k]);
  };

  return (
    <View style={{ gap: space.m }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}>
        {dates.map((d) => {
          const noon = new Date(`${d}T09:00:00Z`);
          const has = picks.some((k) => k.startsWith(`${d}|`));
          return (
            <View key={d} style={{ alignItems: 'center', gap: 4 }}>
              <DayChip
                testID={`staff-start.plan.day.${d}`}
                dow={formatWeekdayShort(noon, locale, tz)}
                dayNum={formatDayNumber(noon, locale, tz)}
                selected={d === day}
                closed={closedDates.includes(d)}
                closedLabel={t('booking.closedChip')}
                onPress={() => onDay(d)}
              />
              {/* A day with picks carries a dot under its chip. */}
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: has ? colors.gstrong : 'transparent' }} />
            </View>
          );
        })}
      </ScrollView>

      <View style={{ gap: space.s }}>
        <Hint>{t('staff.protocols.start.tournament.courtsHint')}</Hint>
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <Legend swatch={<View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.blue }} />} label={t(`${S}.courts.picked`)} />
          <Legend swatch={<View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.sub, alignItems: 'center', justifyContent: 'center' }}><LockIcon size={9} color={colors.fnt2} /></View>} label={t(`${S}.courts.booked`)} />
        </View>
      </View>

      {columns.length === 0 ? (
        <Hint>{t(`${S}.courts.closed`)}</Hint>
      ) : bookings.isError ? (
        <ErrorState
          testID="staff-start.plan.bookings-error"
          title={t('errors.loadFailedTitle')}
          message={t('staff.protocols.start.tournament.bookingsFailed')}
          retryLabel={t('common.retry')}
          onRetry={() => void bookings.refetch()}
        />
      ) : (
        <Card style={{ padding: space.s, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ width: 48 }} />
            {list.map((c) => (
              <Text
                key={c.id}
                numberOfLines={1}
                style={{ flex: 1, textAlign: 'center', fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}
              >
                {bilingual(locale, c.name_en, c.name_ar)}
              </Text>
            ))}
          </View>
          {columns.map((m) => (
            <View key={m} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ width: 48, fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut, writingDirection: 'ltr' }}>
                {hourLabel(m)}
              </Text>
              {list.map((c) => {
                const k = cellKey(day!, c.id, m);
                const on = picked.has(k);
                const isBooked = booked.has(`${c.id}|${m}`);
                const past = wallTimeToUtc(day!, m, tz).getTime() < now;
                const blocked = !on && (isBooked || past);
                return (
                  <Pressable
                    key={c.id}
                    testID={`staff-start.plan.cell.${c.id}-${m}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: blocked }}
                    accessibilityLabel={`${courtName(c.id)}, ${range(day!, m, m + 60)}${isBooked ? ` · ${t(`${S}.courts.booked`)}` : ''}`}
                    onPress={() => tap(k, c.id, m)}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: 42,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: on || isBooked ? 0 : 1,
                      borderColor: colors.line,
                      opacity: past && !on ? 0.4 : 1,
                      backgroundColor: on ? colors.blue : isBooked ? colors.sub : pressed ? colors.tint : colors.card,
                    })}
                  >
                    {on ? <CheckIcon size={16} color={colors.card} strokeWidth={3} /> : isBooked ? <LockIcon size={13} color={colors.fnt2} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Card>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={{ gap: space.s }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
          {t(`${S}.courts.slots`)}
        </Text>
        {slots.length === 0 ? (
          <Hint>{t(`${S}.courts.none`)}</Hint>
        ) : (
          slots.map((s) => (
            <SlotCard
              key={`${s.date}|${s.startMin}|${s.endMin}|${s.courtIds.join(',')}`}
              slot={s}
              tz={tz}
              time={range(s.date, s.startMin, s.endMin)}
              courtNames={s.courtIds.map(courtName)}
              onOpen={() => onDay(s.date)}
              onRemove={() => onPicks(picks.filter((k) => !s.keys.includes(k)))}
            />
          ))
        )}
      </View>
    </View>
  );
}

function Legend({ swatch, label }: { swatch: ReactNode; label: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch}
      <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>{label}</Text>
    </View>
  );
}

/** A picked slot: its day as a small date tile, the hours, its courts; × takes it off. */
function SlotCard({
  slot,
  tz,
  time,
  courtNames,
  onOpen,
  onRemove,
}: {
  slot: PlanSlot;
  tz: string;
  time: string;
  courtNames: string[];
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const noon = new Date(`${slot.date}T09:00:00Z`);
  const id = `${slot.date}-${slot.startMin}-${slot.endMin}`;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.sm,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: colors.blue,
        backgroundColor: colors.tint,
      }}
    >
      <Pressable
        testID={`staff-start.plan.slot.${id}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
      >
        <View style={{ width: 46, paddingVertical: 6, borderRadius: radius.cell, backgroundColor: colors.card, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 10, color: colors.mut, textTransform: 'uppercase' }}>
            {formatWeekdayShort(noon, locale, tz)}
          </Text>
          <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>{formatDayNumber(noon, locale, tz)}</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.ink }}>{time}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {courtNames.map((n, i) => (
              <View key={i} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.card }}>
                <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.ink }}>{n}</Text>
              </View>
            ))}
          </View>
        </View>
      </Pressable>
      <Pressable
        testID={`staff-start.plan.slot.${id}.remove`}
        accessibilityRole="button"
        accessibilityLabel={t(`${S}.courts.remove`, { slot: `${time}` })}
        onPress={onRemove}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.sub : colors.card,
        })}
      >
        <CloseIcon size={15} color={colors.ink} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}
