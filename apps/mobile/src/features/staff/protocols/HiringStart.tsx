/**
 * The hiring start on the staff phone (Sait, 2026-10-17; boards "Hiring 1–4"
 * of the staff-cards canvas): Role, The job, Pay, Check, each a page of its
 * own on the (staff) stack. The native back goes back a step; the answers stay
 * in hiringDraft.ts while the pages come and go.
 *
 * Next checks only its own page with the start's validator, so a step is
 * finished before the next opens; Start checks them all and goes back to the
 * first page with something to fix. "Change" on the Check page opens that step
 * again on top, and its button goes back to Check.
 */
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Pressable, View, type ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { RECORD_CAPS, TEXT_CAPS, type FieldIssue, type StaffRole } from '@touch/core';
import {
  asciiDigits,
  formatDate,
  formatIQD,
  formatNumber,
  formatWeekdayShort,
  makeT,
  type MessageKey,
} from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../../theme';
import { ErrorText, Field } from '../../../components/ui';
import { DateWheelSheet } from '../../../components/DateWheelSheet';
import { useToast } from '../../../components/overlays';
import {
  CalendarIcon,
  CardIcon,
  CheckIcon,
  ChefHatIcon,
  ChevronDownIcon,
  CourtIcon,
  CupIcon,
  GlobeIcon,
  PersonIcon,
  TableIcon,
  TagIcon,
  TruckIcon,
  type IconProps,
} from '../../../components/icons';
import { clearStaffIntentKey, staffIntentKey } from '../../../lib/idempotency';
import { birthDateToDate, todayBirthDate } from '../../profile/birthDate';
import { useBack } from '../../../navigation/back';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { startProtocol } from './api';
import { MULTILINE_BOX, MULTILINE_TEXT } from './multiline';
import { issueMessageKey, serverIssue, useRefreshProtocols } from './parts';
import { dropHiringDraft, updateHiringDraft, useHiringDraft, type HiringDraft } from './hiringDraft';
import {
  HIRING_STEPS,
  ROLE_GROUPS,
  amountOf,
  dayAfter,
  hiringIssues,
  hiringRecord,
  issuesOnStep,
  stepOfIssue,
  stepsDone,
  type HiringAnswers,
  type HiringStep,
} from './hiringSteps';
import { FieldLabel, StepCaption, StepCard, StepPage } from './StepPage';
import { numericText } from './tournamentSteps';

const H = 'staff.protocols.start.hiring';
const FLOW = 'staff.protocols.start.flow';

const ROLE_ICON: Record<StaffRole, ComponentType<IconProps>> = {
  cashier: CardIcon,
  waiter: TableIcon,
  court_desk: CourtIcon,
  shop_staff: TagIcon,
  head_barista: CupIcon,
  barista: CupIcon,
  assistant_barista: CupIcon,
  head_chef: ChefHatIcon,
  chef: ChefHatIcon,
  manager: PersonIcon,
  driver: TruckIcon,
  marketing: GlobeIcon,
  owner: PersonIcon,
  prep: ChefHatIcon,
};

/** The Field's own top margin, taken back so the page's gaps decide the spacing. */
function Bare({ children }: { children: ReactNode }) {
  return <View style={{ marginTop: -space.sm }}>{children}</View>;
}

/** A role to pick: icon square and name, two to a row. */
function RoleCard({
  testID,
  role,
  label,
  on,
  onPick,
}: {
  testID: string;
  role: StaffRole;
  label: string;
  on: boolean;
  onPick: () => void;
}) {
  const { colors, fonts } = useTheme();
  const Icon = ROLE_ICON[role];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => {
        if (!on) void Haptics.selectionAsync().catch(() => undefined);
        onPick();
      }}
      style={({ pressed }) => ({
        flex: 1,
        height: 66,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        // The picked card's border is half a point thicker; the inset gives it back.
        paddingHorizontal: on ? space.m - 0.5 : space.m,
        borderRadius: 14,
        borderWidth: on ? 2 : 1.5,
        borderColor: on ? colors.blue : colors.line,
        backgroundColor: on ? colors.tint : pressed ? colors.sub : colors.card,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: on ? brand.blue : colors.gtint,
        }}
      >
        <Icon size={18} color={on ? brand.white : colors.gstrong} />
      </View>
      <Text numberOfLines={2} style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 15, lineHeight: 19, color: colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The day, written out: "Sat, Nov 1, 2026". */
function dayText(day: string, locale: 'en' | 'ar'): string | null {
  const d = birthDateToDate(day);
  if (!d) return null;
  return `${formatWeekdayShort(d, locale, 'UTC')}${locale === 'ar' ? '، ' : ', '}${formatDate(d, locale, 'UTC')}`;
}

/** A date field that opens the app's date wheel (the native sheet) when pressed. */
function DayButton({
  testID,
  value,
  placeholder,
  label,
  error,
  disabled,
  onPress,
}: {
  testID: string;
  value: string | null;
  placeholder: string;
  label: string;
  error?: string | null;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: space.m,
          borderRadius: radius.cell,
          borderWidth: 2,
          borderColor: error ? colors.redline : colors.line2,
          backgroundColor: pressed ? colors.sub : colors.card,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <CalendarIcon size={18} color={colors.blue} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body600, fontSize: 14, color: value ? colors.ink : colors.fnt2 }}>
          {value ?? placeholder}
        </Text>
        <ChevronDownIcon size={16} color={colors.fnt2} />
      </Pressable>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** A line under a field: what it is for, and how much is typed. */
function UnderLine({ note, count }: { note?: string | null; count?: string | null }) {
  const { colors, fonts } = useTheme();
  const style = { fontFamily: fonts.body400, fontSize: 12, lineHeight: 16, color: colors.mut } as const;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
      <Text style={[style, { flexShrink: 1 }]}>{note ?? ''}</Text>
      {count ? <Text style={style}>{count}</Text> : null}
    </View>
  );
}

export function HiringStart({
  planId,
  step,
  depth,
  returnTo,
  byOwner,
  venueId,
}: {
  planId: string;
  step: HiringStep;
  /** The start's pages above this one (staff-start.tsx `depth`), taken off when the start lands. */
  depth: number;
  /** Opened from the Check page's "Change": the button goes back to it. */
  returnTo: HiringStep | null;
  byOwner: boolean;
  venueId: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const back = useBack('/staff');
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const scroll = useRef<ScrollView>(null);
  const draft = useHiringDraft(planId);
  const a = draft.answers;
  const [picking, setPicking] = useState(false);

  const at = HIRING_STEPS.indexOf(step);
  const total = HIRING_STEPS.length;
  const nextStep = HIRING_STEPS[at + 1];
  const stepLabel = (s: HiringStep) => t(`${H}.steps.${s}` as MessageKey);
  const roleLabel = (r: StaffRole, tr: (k: MessageKey) => string = t) => tr(`op.roles.${r}` as MessageKey);

  const set = (p: Partial<HiringAnswers>) => updateHiringDraft(planId, { answers: p });
  const update = (p: Partial<HiringDraft>) => updateHiringDraft(planId, p);

  // The run's names, made from the role until typed over.
  const en = makeT('en');
  const ar = makeT('ar');
  const titleEn = draft.titleEn ?? (a.role ? en(`${H}.titleFrom`, { role: roleLabel(a.role, en) }) : '');
  const titleAr = draft.titleAr ?? (a.role ? ar(`${H}.titleFrom`, { role: roleLabel(a.role, ar) }) : '');

  const mine = issuesOnStep(draft.issues, step);
  const issueText = (field: string, blank: boolean) => {
    const i = mine.find((x) => x.field === field || x.field.startsWith(`${field}.`));
    return i ? t(issueMessageKey(i, blank)) : null;
  };

  const start = useMutation({
    mutationKey: staffKeys.mutation('start'),
    mutationFn: () =>
      startProtocol({
        kind: 'hiring',
        variant: null,
        titleEn: titleEn.trim() || null,
        titleAr: titleAr.trim() || null,
        data: {},
        record: hiringRecord(a),
        photos: [],
        venueId,
        idempotencyKey: staffIntentKey(draft.intent, 'start'),
      }),
    onSuccess: (result) => {
      clearStaffIntentKey(draft.intent);
      toast(t(result.auto ? 'staff.protocols.start.startedAuto' : 'staff.protocols.start.started'), 'success');
      void refresh();
      dropHiringDraft(planId);
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
    const first = Math.min(...issues.map((i) => HIRING_STEPS.indexOf(stepOfIssue(i))));
    if (first >= 0 && first < at) {
      toast(t('staff.protocols.start.tournament.earlierStep'), 'error');
      router.dismiss(Math.min(at - first, depth));
    } else {
      scroll.current?.scrollTo({ y: 0, animated: true });
    }
  }

  function onNext() {
    const all = hiringIssues(a, titleEn.trim() || null, titleAr.trim() || null, byOwner);
    if (!nextStep) {
      if (all.length > 0) return show(all);
      update({ issues: [] });
      start.mutate();
      return;
    }
    const here = issuesOnStep(all, step);
    if (here.length > 0) return show(here);
    update({ issues: [] });
    if (returnTo) {
      back();
      return;
    }
    router.push({
      pathname: '/staff-start',
      params: { kind: 'hiring', plan: planId, step: nextStep, depth: String(depth + 1) },
    });
  }

  /** "Change" on the Check page: that step again, on top, coming back to Check. */
  const change = (s: HiringStep) =>
    router.push({
      pathname: '/staff-start',
      params: { kind: 'hiring', plan: planId, step: s, ret: 'check', depth: String(depth + 1) },
    });

  const busy = start.isPending;
  const today = todayBirthDate();
  const serverError = start.error && !serverIssue(start.error) ? t(mapStaffError(start.error)) : null;

  const body = (() => {
    switch (step) {
      case 'role': {
        const error = issueText('role', a.role === null);
        return (
          <>
            {ROLE_GROUPS.map((g) => {
              const rows: StaffRole[][] = [];
              for (let i = 0; i < g.roles.length; i += 2) rows.push(g.roles.slice(i, i + 2));
              return (
                <View key={g.key} style={{ gap: 10 }}>
                  <StepCaption>{t(`${H}.groups.${g.key}` as MessageKey)}</StepCaption>
                  {rows.map((row) => (
                    <View key={row.join('|')} style={{ flexDirection: 'row', gap: 10 }}>
                      {row.map((r) => (
                        <RoleCard
                          key={r}
                          testID={`staff-start.hiring.role.${r}`}
                          role={r}
                          label={roleLabel(r)}
                          on={a.role === r}
                          onPick={() => {
                            set({ role: r });
                            update({ issues: draft.issues.filter((i) => i.field !== 'role') });
                          }}
                        />
                      ))}
                      {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                    </View>
                  ))}
                </View>
              );
            })}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </>
        );
      }
      case 'job': {
        const shown = dayText(a.startDate, locale);
        return (
          <StepCard>
            <View style={{ gap: 6 }}>
              <FieldLabel>{t(`${H}.why`, { role: a.role ? roleLabel(a.role).toLocaleLowerCase(locale === 'ar' ? 'ar' : 'en') : '' })}</FieldLabel>
              <Bare>
                <Field
                  testID="staff-start.hiring.why"
                  value={a.why}
                  onChangeText={(why) => set({ why })}
                  placeholder={t(`${H}.whyPlaceholder`)}
                  multiline
                  boxStyle={{ ...MULTILINE_BOX, minHeight: 92 }}
                  style={MULTILINE_TEXT}
                  maxLength={TEXT_CAPS.freeText}
                  editable={!busy}
                  error={issueText('why', a.why.trim() === '')}
                />
              </Bare>
              <UnderLine
                note={t(`${H}.whyHint`)}
                count={`${formatNumber(a.why.length, locale)} / ${formatNumber(TEXT_CAPS.freeText, locale)}`}
              />
            </View>
            <View style={{ gap: 6 }}>
              <FieldLabel>{t(`${H}.hours`)}</FieldLabel>
              <Bare>
                <Field
                  testID="staff-start.hiring.hours"
                  value={a.hours}
                  onChangeText={(hours) => set({ hours })}
                  placeholder={t(`${H}.hoursPlaceholder`)}
                  multiline
                  boxStyle={{ ...MULTILINE_BOX, minHeight: 68 }}
                  style={MULTILINE_TEXT}
                  maxLength={RECORD_CAPS.hours}
                  editable={!busy}
                  error={issueText('hours', a.hours.trim() === '')}
                />
              </Bare>
            </View>
            <View style={{ gap: 6 }}>
              <FieldLabel>{t(`${H}.startDate`)}</FieldLabel>
              <DayButton
                testID="staff-start.hiring.start-date"
                value={shown}
                placeholder={t(`${FLOW}.pickDay`)}
                label={t(`${H}.startDate`)}
                error={issueText('start_date', a.startDate === '')}
                disabled={busy}
                onPress={() => setPicking(true)}
              />
              <UnderLine note={t(`${FLOW}.pressToOpen`)} />
            </View>
            <DateWheelSheet
              testID="staff-start.hiring.start-date.sheet"
              visible={picking}
              title={t(`${H}.startDate`)}
              value={a.startDate || today}
              min={today}
              max={dayAfter(today, 730)}
              confirmLabel={t(`${FLOW}.confirmDay`)}
              onConfirm={(day) => {
                set({ startDate: day });
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          </StepCard>
        );
      }
      case 'pay': {
        const min = amountOf(a.payMin);
        const max = amountOf(a.payMax);
        const preview =
          min !== null && max !== null
            ? t(`${H}.payRange`, { min: formatIQD(min, locale), max: formatIQD(max, locale) })
            : min !== null
              ? t(`${H}.payFromOnly`, { min: formatIQD(min, locale) })
              : max !== null
                ? t(`${H}.payToOnly`, { max: formatIQD(max, locale) })
                : null;
        const wrongWay = min !== null && max !== null && max < min;
        const payField = (testID: string, label: string, value: string, onChange: (v: string) => void, error: string | null) => (
          <View style={{ flex: 1, gap: 6 }}>
            <FieldLabel>{label}</FieldLabel>
            <Bare>
              <Field
                testID={testID}
                value={value}
                onChangeText={(v) => onChange(numericText(asciiDigits(v)))}
                keyboardType="number-pad"
                latin
                unit="IQD"
                editable={!busy}
                error={error}
              />
            </Bare>
          </View>
        );
        return (
          <StepCard>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {payField('staff-start.hiring.pay-min', t(`${H}.payFrom`), a.payMin, (payMin) => set({ payMin }), issueText('pay_min_iqd', false))}
              {payField(
                'staff-start.hiring.pay-max',
                t(`${H}.payTo`),
                a.payMax,
                (payMax) => set({ payMax }),
                wrongWay ? null : issueText('pay_max_iqd', false),
              )}
            </View>
            {wrongWay ? <ErrorText>{t(`${H}.rangeWrong`)}</ErrorText> : null}
            {preview && !wrongWay ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 11,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.cell,
                  backgroundColor: colors.gtint,
                }}
              >
                <CheckIcon size={16} color={colors.gtext} strokeWidth={2.6} />
                <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 18, color: colors.gtext }}>{preview}</Text>
              </View>
            ) : null}
          </StepCard>
        );
      }
      case 'check': {
        const min = amountOf(a.payMin);
        const max = amountOf(a.payMax);
        const pay =
          min !== null && max !== null
            ? `${formatIQD(min, locale)} – ${formatIQD(max, locale)}`
            : min !== null
              ? `${t(`${H}.payFrom`)} ${formatIQD(min, locale)}`
              : max !== null
                ? `${t(`${H}.payTo`)} ${formatIQD(max, locale)}`
                : t(`${H}.payNone`);
        const rows: { key: string; label: string; value: string; step: HiringStep }[] = [
          { key: 'role', label: t(`${H}.summary.role`), value: a.role ? roleLabel(a.role) : '—', step: 'role' },
          { key: 'why', label: t(`${H}.summary.why`), value: a.why.trim() || '—', step: 'job' },
          { key: 'hours', label: t(`${H}.summary.hours`), value: a.hours.trim() || '—', step: 'job' },
          { key: 'start', label: t(`${H}.summary.start`), value: dayText(a.startDate, locale) ?? '—', step: 'job' },
          { key: 'pay', label: t(`${H}.summary.pay`), value: pay, step: 'pay' },
        ];
        const titleError = issueText('title', titleEn.trim() === '' && titleAr.trim() === '');
        const lead = (code: string) => (
          <Text style={{ width: 22, marginStart: space.m, fontFamily: fonts.body700, fontSize: 11, color: colors.mut }}>{code}</Text>
        );
        return (
          <>
            <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: 'hidden' }}>
              {rows.map((r, i) => (
                <View
                  key={r.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 10,
                    paddingVertical: 11,
                    paddingHorizontal: space.m,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.sub,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>{r.label}</Text>
                    <Text numberOfLines={2} style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 19, color: colors.ink }}>
                      {r.value}
                    </Text>
                  </View>
                  <Pressable
                    testID={`staff-start.hiring.change.${r.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${t(`${FLOW}.change`)}: ${r.label}`}
                    hitSlop={7}
                    disabled={busy}
                    onPress={() => change(r.step)}
                    style={({ pressed }) => ({
                      height: 30,
                      justifyContent: 'center',
                      paddingHorizontal: 11,
                      borderRadius: radius.pill,
                      borderWidth: 1.5,
                      borderColor: colors.line2,
                      backgroundColor: pressed ? colors.sub : colors.card,
                    })}
                  >
                    <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.blue }}>{t(`${FLOW}.change`)}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <StepCaption>{t(`${H}.titleCaption`)}</StepCaption>
            <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: space.sm, gap: space.s }}>
              <Bare>
                <Field
                  testID="staff-start.hiring.title-en"
                  value={titleEn}
                  onChangeText={(v) => update({ titleEn: v, issues: draft.issues.filter((i) => i.field !== 'title') })}
                  lead={lead('EN')}
                  latin
                  maxLength={TEXT_CAPS.title}
                  editable={!busy}
                />
              </Bare>
              <Bare>
                <Field
                  testID="staff-start.hiring.title-ar"
                  value={titleAr}
                  onChangeText={(v) => update({ titleAr: v, issues: draft.issues.filter((i) => i.field !== 'title') })}
                  lead={lead('AR')}
                  maxLength={TEXT_CAPS.title}
                  editable={!busy}
                  error={titleError}
                />
              </Bare>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 16, color: colors.mut }}>{t(`${H}.titleHint`)}</Text>
            </View>
          </>
        );
      }
    }
  })();

  const n = formatNumber(at + 1, locale);
  const of = formatNumber(total, locale);
  const stepLine =
    step === 'job' && a.role
      ? t(`${FLOW}.stepOfWith`, { n, total: of, extra: roleLabel(a.role) })
      : step === 'pay'
        ? t(`${FLOW}.stepOfWith`, { n, total: of, extra: t(`${FLOW}.optional`) })
        : t(`${FLOW}.stepOf`, { n, total: of });

  return (
    <StepPage
      title={t('work.protocol.kind.hiring')}
      question={t(`${H}.questions.${step}` as MessageKey)}
      stepLine={stepLine}
      lead={step === 'pay' ? t(`${H}.payLead`) : null}
      done={stepsDone(step)}
      total={total}
      scrollRef={scroll}
      error={serverError}
      action={
        nextStep
          ? {
              testID: 'staff-start.hiring.next',
              label: returnTo
                ? t(`${FLOW}.backTo`, { step: stepLabel(returnTo) })
                : t(`${FLOW}.next`, { step: stepLabel(nextStep) }),
              onPress: onNext,
            }
          : {
              testID: 'staff-start.submit',
              label: t('staff.protocols.start.submit'),
              variant: 'cta',
              busy,
              onPress: onNext,
            }
      }
    >
      {body}
    </StepPage>
  );
}
