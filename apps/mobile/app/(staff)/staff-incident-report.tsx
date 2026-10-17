import { useState, type ComponentType, type ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VENUE_TZ, formatDate, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Field, Hint, MicroLabel, Screen } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import { DateTimeField } from '../../src/components/DateTimeField';
import { PhotoButton } from '../../src/components/PhotoButton';
import {
  CheckIcon,
  CourtIcon,
  FistIcon,
  GlassBrokenIcon,
  InfoIcon,
  MedicalIcon,
  MoreIcon,
  ShieldIcon,
  WarningIcon,
  type IconProps,
} from '../../src/components/icons';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import { useBack } from '../../src/navigation/back';
import { MULTILINE_BOX, MULTILINE_TEXT } from '../../src/features/staff/checklists/parts';
import { fetchCourts } from '../../src/features/staff/protocols/api';
import { parseVenueDateTime, venueDateTimeText } from '../../src/features/staff/protocols/assemble';
import { localName } from '../../src/features/staff/marketing/logic';
import { submitIncident, type IncidentKind } from '../../src/features/staff/incidents/api';
import {
  FORM_STEPS,
  INCIDENT_CAPS,
  INCIDENT_FILTERS,
  INCIDENT_PLACES,
  KIND_ORDER,
  QUICK_TIMES,
  REPORT_STEPS,
  incidentArgs,
  issuesOnStep,
  parseReportStep,
  stepDone,
  stepOfField,
  validateIncident,
  withPlace,
  type IncidentField,
  type IncidentIssue,
  type ReportStep,
  type WhenChoice,
} from '../../src/features/staff/incidents/logic';
import { dropReport, newReportId, updateReport, useReportDraft } from '../../src/features/staff/incidents/reportDraft';

/**
 * Report an incident (wave5-addendum-2026-09-25 §2.6, §5.3; migration 0198),
 * the operator's stepped dialog (ReportIncidentForm) on the phone: the same
 * four steps in the same order (What kind, What happened, Where & when,
 * Review), the same cards in the same colours, the same words (its
 * `ws.incidents.form.*` strings) and the same rule that a step is finished
 * before the next opens.
 *
 * Each step is a page of its own, as the tournament start's are (owner,
 * 2026-10-16), so the native back goes back a step; the report lives in
 * reportDraft.ts, named by the `draft` param. The operator's step menu is the
 * strip on top (a tick once passed, a red "!" where something is missing), its
 * progress card and footer the bar at the bottom. Send is on the review, which
 * lists every answer with a Change that goes back to its step.
 *
 * Every role reports, opened by the + in the incidents page's top bar; a sent
 * report goes back to that page, which lists it. The report is immutable once
 * sent (§8 Q12): corrections go in the review note.
 */

/** Each kind's icon, as the operator's cards and the incidents list draw them. */
const KIND_ICON: Record<IncidentKind, ComponentType<IconProps>> = {
  accident: WarningIcon,
  injury: MedicalIcon,
  fight: FistIcon,
  damage: GlassBrokenIcon,
  other: MoreIcon,
};

/** A missing required answer, said in its step's words; any other field keeps the generic line. */
const MISSING_KEY: Partial<Record<IncidentField, MessageKey>> = {
  kind: 'ws.incidents.form.missing.kind',
  description: 'ws.incidents.form.missing.description',
  place: 'ws.incidents.form.missing.place',
  courtId: 'ws.incidents.form.missing.courtId',
  when: 'ws.incidents.form.missing.when',
};

const LIMIT: Partial<Record<IncidentField, number>> = {
  description: INCIDENT_CAPS.description,
  people: INCIDENT_CAPS.people,
  placeDetail: INCIDENT_CAPS.placeDetail,
  photos: INCIDENT_CAPS.photos,
};

/** Half strength, as the operator's outlines (`color-mix(… 50%, surface)`), and its 45% wash. */
const HALF = '80';
const WASH = '73';

function IncidentReportScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const back = useBack('/staff-incidents');
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const params = useLocalSearchParams<{ draft?: string; step?: string }>();
  // The first page names the report; the pages after it are given its name.
  const [minted] = useState(newReportId);
  const id = params.draft ?? minted;
  const step = parseReportStep(params.step);
  const report = useReportDraft(id);
  const { draft, photos, whenChoice, openedAt, flagged } = report;

  const courts = useQuery({
    queryKey: staffKeys.courts(venue),
    queryFn: () => fetchCourts(venue),
    enabled: venue !== '' && step === 'placeTime' && draft.place === 'court',
  });

  const current = { ...draft, photos: photos.map((p) => p.path) };
  // Counted from when the report was opened, as the quick times are (the server checks its own now).
  const issues = validateIncident(current, openedAt);
  const idx = REPORT_STEPS.indexOf(step);
  const prev = REPORT_STEPS[idx - 1];
  const next = REPORT_STEPS[idx + 1];
  const done = (s: ReportStep) => stepDone(s, issues);
  const doneCount = FORM_STEPS.filter(done).length;

  const set = (patch: Partial<typeof draft>) => updateReport(id, { draft: patch });
  const flag = (fields: readonly IncidentField[]) => updateReport(id, { flagged: [...new Set([...flagged, ...fields])] });

  const submit = useMutation({
    mutationKey: staffKeys.mutation('incident'),
    mutationFn: () => submitIncident(incidentArgs(current, venue), staffIntentKey(report.intent, 'incident')),
    onSuccess: () => {
      clearStaffIntentKey(report.intent);
      toast(t('ws.incidents.form.sent'), 'success');
      void queryClient.invalidateQueries({ queryKey: staffKeys.myIncidents(venue) });
      for (const f of INCIDENT_FILTERS) {
        void queryClient.invalidateQueries({ queryKey: staffKeys.incidents(venue, f) });
      }
      dropReport(id);
      // The report's pages come off, then the first one goes back to the list.
      if (idx > 0) router.dismiss(idx);
      back();
    },
  });
  const busy = submit.isPending;

  /** What a flagged field is missing, in the operator's words. */
  const messageOf = (issue: IncidentIssue): string => {
    const limit = formatNumber(LIMIT[issue.field] ?? 0, locale);
    if (issue.code === 'required') return t(MISSING_KEY[issue.field] ?? 'ws.incidents.form.issue.required');
    if (issue.code === 'tooLong') return t(issue.field === 'photos' ? 'ws.incidents.form.issue.tooMany' : 'ws.incidents.form.issue.tooLong', { limit });
    return t('ws.incidents.form.issue.whenRange');
  };
  const stepMessages = [
    ...new Set(issuesOnStep(issues, step).filter((i) => flagged.includes(i.field)).map(messageOf)),
  ];

  const stepLabel = (s: ReportStep) => t(`ws.incidents.form.steps.${s}`);
  const whenLabel = (choice: WhenChoice): string => {
    if (choice === 'now') return t('ws.incidents.form.now');
    if (choice === 'm15') return t('ws.incidents.form.minutesAgo', { count: formatNumber(15, locale) });
    if (choice === 'h1') return t('ws.incidents.form.hourAgo');
    return t('ws.incidents.form.pickTime');
  };
  const pickWhen = (choice: WhenChoice) => {
    const quick = QUICK_TIMES.find((q) => q.id === choice);
    updateReport(id, {
      whenChoice: choice,
      draft: quick ? { when: venueDateTimeText(new Date(openedAt - quick.minutes * 60_000).toISOString()) } : {},
    });
  };
  const courtName = (courtId: string | null) => {
    const c = (courts.data ?? []).find((x) => x.id === courtId);
    return c ? localName(c.name_en, c.name_ar, locale) : '';
  };
  const whereText = () => {
    if (!draft.place) return '—';
    const where = draft.place === 'court' && draft.courtId ? courtName(draft.courtId) || t('work.incident.place.court') : t(`work.incident.place.${draft.place}`);
    return draft.placeDetail.trim() ? `${where} · ${draft.placeDetail.trim()}` : where;
  };
  /** When, as the review reads it: the date, then the time. */
  const whenText = () => {
    const quick = QUICK_TIMES.find((q) => q.id === whenChoice);
    const iso = quick ? null : parseVenueDateTime(draft.when);
    const at = quick ? new Date(openedAt - quick.minutes * 60_000) : iso ? new Date(iso) : null;
    return at ? `${formatDate(at, locale)} · ${formatTime(at, locale)}` : '—';
  };

  /** Go back to a step behind this one (the review's Change, and Send with something missing). */
  const backTo = (target: ReportStep) => {
    const n = idx - REPORT_STEPS.indexOf(target);
    if (n > 0) router.dismiss(n);
  };

  function onNext() {
    if (!next) {
      // Send: everything is checked, and something missing opens its step.
      updateReport(id, { flagged: [...new Set([...flagged, ...issues.map((i) => i.field)])] });
      const first = issues[0];
      if (first) return backTo(stepOfField(first.field));
      if (venue && !busy) submit.mutate();
      return;
    }
    const here = issuesOnStep(issues, step);
    if (here.length > 0) return flag(here.map((i) => i.field));
    router.push({ pathname: '/staff-incident-report', params: { draft: id, step: next } });
  }

  if (status.kind !== 'staff') return null;

  const muted = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut };
  const groupLabel = (text: string, end?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm }}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{text}</Text>
      {end ? <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{end}</Text> : null}
    </View>
  );

  let body: ReactNode = null;
  if (step === 'kind') {
    body = (
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {KIND_ORDER.map((k) => (
          <KindCard
            key={k}
            testID={`staff-incident-report.kind.${k}`}
            kind={k}
            label={t(`work.incident.kind.${k}`)}
            hint={t(`ws.incidents.form.kindHint.${k}`)}
            pressed={draft.kind === k}
            onPress={() => set({ kind: k })}
          />
        ))}
      </View>
    );
  } else if (step === 'story') {
    body = (
      <View style={{ gap: space.l }}>
        {/* The contract's privacy line, once, above the fields it is about. */}
        <View
          testID="staff-incident-report.privacy"
          style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-start', paddingVertical: space.s, paddingHorizontal: space.sm, borderRadius: radius.cell, backgroundColor: colors.sub }}
        >
          <ShieldIcon size={16} color={colors.mut} />
          <Text style={{ flex: 1, fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.ink }}>{t('ws.incidents.form.privacyHint')}</Text>
        </View>
        <Field
          testID="staff-incident-report.description"
          label={t('ws.incidents.form.description')}
          value={draft.description}
          onChangeText={(description) => set({ description })}
          multiline
          boxStyle={MULTILINE_BOX}
          style={MULTILINE_TEXT}
          maxLength={INCIDENT_CAPS.description}
          editable={!busy}
        />
        <View style={{ gap: space.xs }}>
          <Field
            testID="staff-incident-report.people"
            label={t('ws.incidents.form.people')}
            value={draft.people}
            onChangeText={(people) => set({ people })}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            maxLength={INCIDENT_CAPS.people}
            editable={!busy}
          />
          <Hint style={{ marginTop: 0 }}>{t('ws.incidents.form.peopleHint')}</Hint>
        </View>
        <View style={{ gap: space.s }}>
          {groupLabel(t('ws.incidents.cols.photos'))}
          <PhotoButton
            testID="staff-incident-report.photo"
            venueId={venue}
            folder="incidents"
            photos={photos}
            onChange={(next) => updateReport(id, { photos: next })}
            max={INCIDENT_CAPS.photos}
            disabled={busy || venue === ''}
          />
        </View>
      </View>
    );
  } else if (step === 'placeTime') {
    const picked = parseVenueDateTime(draft.when);
    body = (
      <View style={{ gap: space.xl }}>
        {/* The window ("Up to 7 days ago.") on the label's line, at its end. */}
        <View style={{ gap: space.s }}>
          {groupLabel(t('ws.incidents.form.when'), t('ws.incidents.form.whenHint'))}
          <View style={cardRow}>
            {([...QUICK_TIMES.map((q) => q.id), 'pick'] as const).map((c) => {
              const quick = QUICK_TIMES.find((q) => q.id === c);
              return (
                <ChoiceCard key={c} testID={`staff-incident-report.when.${c}`} pressed={whenChoice === c} disabled={busy} onPress={() => pickWhen(c)}>
                  <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{whenLabel(c)}</Text>
                  {/* A quick time shows the clock time it means; "Pick a time" is just its word. */}
                  {quick ? <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{formatTime(new Date(openedAt - quick.minutes * 60_000), locale)}</Text> : null}
                </ChoiceCard>
              );
            })}
          </View>
          {whenChoice === 'pick' ? (
            <DateTimeField
              testID="staff-incident-report.when-picker"
              label={t('ws.incidents.form.pickTime')}
              value={picked ? new Date(picked) : new Date(openedAt)}
              mode="datetime"
              timeZone={VENUE_TZ}
              minimumDate={new Date(openedAt - INCIDENT_CAPS.backMs)}
              maximumDate={new Date(openedAt + INCIDENT_CAPS.aheadMs)}
              onChange={(d) => set({ when: venueDateTimeText(d.toISOString()) })}
              disabled={busy}
            />
          ) : null}
        </View>
        <View style={{ gap: space.s }}>
          {groupLabel(t('ws.incidents.form.place'))}
          <View style={cardRow}>
            {INCIDENT_PLACES.map((p) => (
              <ChoiceCard
                key={p}
                testID={`staff-incident-report.place.${p}`}
                pressed={draft.place === p}
                disabled={busy}
                onPress={() => updateReport(id, { draft: withPlace(draft, p) })}
              >
                <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{t(`work.incident.place.${p}`)}</Text>
              </ChoiceCard>
            ))}
          </View>
        </View>
        {draft.place === 'court' ? (
          <View style={{ gap: space.s }}>
            {groupLabel(t('ws.incidents.form.court'))}
            {courts.isPending ? (
              <SkeletonList rows={1} height={48} />
            ) : courts.isError ? (
              <ErrorState
                testID="staff-incident-report.courts-error"
                title={t('errors.loadFailedTitle')}
                message={t(mapStaffError(courts.error))}
                retryLabel={t('common.retry')}
                onRetry={() => void courts.refetch()}
              />
            ) : (courts.data ?? []).length === 0 ? (
              <Hint style={{ marginTop: 0 }}>{t('staff.incidents.form.noCourts')}</Hint>
            ) : (
              <View style={cardRow}>
                {(courts.data ?? []).map((c) => {
                  const on = draft.courtId === c.id;
                  return (
                    <ChoiceCard key={c.id} testID={`staff-incident-report.court.${c.id}`} pressed={on} disabled={busy} onPress={() => set({ courtId: c.id })}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                        <CourtIcon size={18} color={on ? colors.blue : colors.mut} />
                        <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{localName(c.name_en, c.name_ar, locale)}</Text>
                      </View>
                    </ChoiceCard>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
        <Field
          testID="staff-incident-report.place-detail"
          label={t('ws.incidents.form.placeDetail')}
          value={draft.placeDetail}
          onChangeText={(placeDetail) => set({ placeDetail })}
          placeholder={t('ws.incidents.form.placeDetailPlaceholder')}
          maxLength={INCIDENT_CAPS.placeDetail}
          editable={!busy}
        />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: space.sm }}>
        <Text style={muted}>{t('ws.incidents.form.reviewLead')}</Text>
        <View style={{ borderRadius: radius.cell, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.card, overflow: 'hidden' }}>
          <ReviewRow id="kind" label={t('ws.incidents.form.kind')} target="kind" onChange={backTo} busy={busy}>
            {draft.kind ? t(`work.incident.kind.${draft.kind}`) : '—'}
          </ReviewRow>
          <ReviewRow id="description" label={t('ws.incidents.form.description')} target="story" onChange={backTo} busy={busy}>
            {draft.description.trim() || '—'}
          </ReviewRow>
          <ReviewRow id="people" label={t('ws.incidents.form.people')} target="story" onChange={backTo} busy={busy}>
            {draft.people.trim() || '—'}
          </ReviewRow>
          {/* Where and when on one line, as the step asks them together. */}
          <ReviewRow id="place-time" label={t('ws.incidents.form.steps.placeTime')} target="placeTime" onChange={backTo} busy={busy}>
            {`${whereText()} · ${whenText()}`}
          </ReviewRow>
          <ReviewRow id="photos" label={t('ws.incidents.cols.photos')} target="story" onChange={backTo} busy={busy} last>
            {photos.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {photos.map((p, i) => (
                  <Image
                    key={p.path}
                    source={{ uri: p.uri }}
                    accessibilityLabel={t('ws.incidents.sheet.photoAlt', { n: formatNumber(i + 1, locale) })}
                    style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: colors.sub }}
                  />
                ))}
              </View>
            ) : (
              '—'
            )}
          </ReviewRow>
        </View>
      </View>
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('ws.incidents.form.title') }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
        <ScrollView
          contentContainerStyle={{ paddingTop: space.m, paddingBottom: space.xl, gap: space.l }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
          {/* The operator's step menu, across: a tick once passed, a red "!" where something is missing, the open step in blue. */}
          <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityLabel={t('ws.incidents.form.menu')}>
            {REPORT_STEPS.map((s, i) => {
              const now = s === step;
              const ok = i < idx && done(s);
              const warn = issues.some((x) => stepOfField(x.field) === s && flagged.includes(x.field));
              return (
                <View
                  key={s}
                  accessibilityState={{ selected: now }}
                  style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: space.s, paddingHorizontal: 2, borderRadius: radius.cell, backgroundColor: now ? brand.blue : 'transparent' }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: warn ? colors.danger : ok ? brand.green : now ? brand.white : colors.seg,
                    }}
                  >
                    {warn ? (
                      <Text style={{ fontFamily: fonts.body800, fontSize: 12, color: brand.white }}>!</Text>
                    ) : ok ? (
                      <CheckIcon size={14} color={brand.greenInk} strokeWidth={3} />
                    ) : (
                      <Text style={{ fontFamily: fonts.body800, fontSize: 12, color: now ? brand.blue : colors.mut }}>{formatNumber(i + 1, locale)}</Text>
                    )}
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{ textAlign: 'center', fontFamily: now ? fonts.body700 : fonts.body600, fontSize: 11, lineHeight: 14, color: now ? brand.white : warn ? colors.redtext : colors.ink }}
                  >
                    {warn && !now ? t('ws.incidents.form.needsLook') : stepLabel(s)}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={{ gap: 6 }}>
            <MicroLabel style={{ color: colors.blue, letterSpacing: locale === 'ar' ? 0 : tracking(0.8) }}>
              {t('ws.incidents.form.stepOf', { n: formatNumber(idx + 1, locale), total: formatNumber(REPORT_STEPS.length, locale) })}
            </MicroLabel>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display800, fontSize: 26, lineHeight: 32, color: colors.ink }}>
              {stepLabel(step)}
            </Text>
            {idx === 0 ? <Text style={muted}>{t('ws.incidents.form.lead')}</Text> : null}
          </View>
          {body}
        </ScrollView>

        {/* The operator's bottom row: what the step is missing, the progress, and the way back and on. */}
        <View
          style={{
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.m),
            paddingHorizontal: space.l,
            marginHorizontal: -space.l,
            gap: space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.bg,
          }}
        >
          {stepMessages.length > 0 ? (
            <View
              testID="staff-incident-report.missing"
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 10, paddingHorizontal: space.sm, borderRadius: radius.cell, borderWidth: 1, borderColor: colors.redtext, backgroundColor: colors.redtint }}
            >
              <InfoIcon size={18} color={colors.redtext} />
              <View style={{ flex: 1, gap: 2 }}>
                {stepMessages.map((m) => (
                  <Text key={m} style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.redtext }}>
                    {m}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
          {submit.isError ? <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.redtext }}>{t(mapStaffError(submit.error))}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
              {t('ws.incidents.form.progress', { done: formatNumber(doneCount, locale), total: formatNumber(FORM_STEPS.length, locale) })}
            </Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.seg, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${Math.round((doneCount / FORM_STEPS.length) * 100)}%`, backgroundColor: brand.green }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              testID="staff-incident-report.back"
              label={prev ? stepLabel(prev) : t('common.cancel')}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                if (prev) back();
                else {
                  dropReport(id);
                  back();
                }
              }}
              style={{ flex: 1 }}
            />
            {next ? (
              <Button key="next" testID="staff-incident-report.next" label={stepLabel(next)} onPress={onNext} disabled={busy} style={{ flex: 1 }} />
            ) : (
              <Button
                key="send"
                testID="staff-incident-report.submit"
                label={t('ws.incidents.form.submit')}
                busy={busy}
                disabled={venue === ''}
                onPress={onNext}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** A row of choice cards, two to a row on a phone (the operator's 7.5rem cards). */
const cardRow = { flexDirection: 'row', flexWrap: 'wrap', gap: space.s } as const;

/** A place, a time or a court as the operator's choice card: the picked one on the blue wash with a half-strength outline. */
function ChoiceCard({
  testID,
  pressed,
  disabled,
  onPress,
  children,
}: {
  testID: string;
  pressed: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: pressed, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed: down }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        gap: 4,
        padding: pressed ? space.sm - 1 : space.sm,
        borderRadius: radius.cell,
        borderWidth: pressed ? 2 : 1,
        borderColor: pressed ? `${colors.blue}${HALF}` : colors.line2,
        backgroundColor: pressed ? colors.tint : down ? colors.sub : colors.card,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/** A kind as the operator's card in its own colour: the word and its icon on its tint, the line under it. */
function KindCard({
  testID,
  kind,
  label,
  hint,
  pressed,
  onPress,
}: {
  testID: string;
  kind: IncidentKind;
  label: string;
  hint: string;
  pressed: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const look = {
    accident: { bg: colors.incAccidentTint, fg: colors.incAccident },
    injury: { bg: colors.incInjuryTint, fg: colors.incInjury },
    fight: { bg: colors.incFightTint, fg: colors.incFight },
    damage: { bg: colors.incDamageTint, fg: colors.incDamage },
    other: { bg: colors.incOtherTint, fg: colors.incOther },
  }[kind];
  const Icon = KIND_ICON[kind];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: pressed }}
      onPress={onPress}
      style={({ pressed: down }) => ({
        gap: space.s,
        padding: pressed ? space.l - 1 : space.l,
        borderRadius: radius.cell,
        borderWidth: pressed ? 2 : 1,
        // Picked, the card takes its kind's colour, not the blue (the operator's .tp-incident-kind).
        borderColor: pressed || down ? `${look.fg}${HALF}` : colors.line2,
        backgroundColor: colors.card,
        overflow: 'hidden',
      })}
    >
      {pressed ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: `${look.bg}${WASH}` }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.l }}>
        <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 17, lineHeight: 22, color: colors.ink }}>{label}</Text>
        <View style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: look.bg }}>
          <Icon size={22} color={look.fg} />
        </View>
      </View>
      <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}>{hint}</Text>
    </Pressable>
  );
}

/** One answer on the review: its label, what was given, and a Change that goes back to its step. */
function ReviewRow({
  id,
  label,
  target,
  onChange,
  busy,
  last,
  children,
}: {
  /** The row's own part of the Change button's id. */
  id: string;
  label: string;
  target: ReportStep;
  onChange: (step: ReportStep) => void;
  busy?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.m,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>{label}</Text>
        {typeof children === 'string' ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 14, lineHeight: 20, color: colors.ink }}>{children}</Text>
        ) : (
          children
        )}
      </View>
      {/* Bordered, so it reads as a button beside the answer. */}
      <Pressable
        testID={`staff-incident-report.change.${id}`}
        accessibilityRole="button"
        accessibilityLabel={t('ws.incidents.form.changeLabel', { what: label })}
        disabled={busy}
        onPress={() => onChange(target)}
        hitSlop={6}
        style={({ pressed }) => ({
          paddingVertical: 6,
          paddingHorizontal: space.sm,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.line2,
          backgroundColor: pressed ? colors.sub : colors.card,
        })}
      >
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>{t('ws.incidents.form.change')}</Text>
      </Pressable>
    </View>
  );
}

export default function StaffIncidentReportRoute() {
  return (
    <RequireStaff>
      <IncidentReportScreen />
    </RequireStaff>
  );
}
