import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StaffRole } from '@touch/core';
import { formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
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
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
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
import { Chip } from '../src/features/staff/protocols/FormFields';
import { fetchCourts } from '../src/features/staff/protocols/api';
import { parseVenueDateTime, venueDateTimeText } from '../src/features/staff/protocols/assemble';
import { StoredPhotos } from '../src/features/staff/supplies/StoredPhotos';
import { intentFor } from '../src/features/staff/supplies/logic';
import { localName, namedFirst } from '../src/features/staff/marketing/logic';
import {
  fetchIncidentsPage,
  fetchMyIncidents,
  reviewIncident,
  submitIncident,
  type IncidentRow,
  type IncidentsFilter,
} from '../src/features/staff/incidents/api';
import {
  INCIDENT_CAPS,
  INCIDENT_FILTERS,
  INCIDENT_KINDS,
  INCIDENT_PLACES,
  INCIDENT_TONE,
  emptyIncidentDraft,
  incidentArgs,
  ownReportLine,
  reviewsIncidents,
  toReviewCount,
  validateIncident,
  validateReviewNote,
  withPlace,
  type IncidentDraft,
  type IncidentField,
  type IncidentIssue,
} from '../src/features/staff/incidents/logic';

/**
 * Incidents (wave5-addendum-2026-09-25 §2.6, §5.3; migration 0198).
 *
 *   every role        reports an accident, an injury, a fight or damage at
 *                     the venue, with photos (folder `incidents`), and follows
 *                     its own reports and the reviewer's note
 *   manager, owner    also review the venue's open reports with a note the
 *                     reporter reads, never their own (CANNOT_DECIDE_OWN)
 *
 * The report is immutable once sent (§8 Q12): corrections go in the review
 * note. Redacting is on the operator only (§5.1). `?id=` is a report a link
 * named, listed first and marked. Only the kind ever reaches a lock screen
 * (§2.3); the text and photos stay here.
 */

type IncidentsView = 'review' | 'report';

function IncidentsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();

  const role: StaffRole = status.kind === 'staff' ? status.staff.role : 'cashier';
  const reviews = reviewsIncidents(role);
  const venue = venueId ?? '';

  const [view, setView] = useState<IncidentsView>(reviews ? 'review' : 'report');
  const [filter, setFilter] = useState<IncidentsFilter>('open');

  // ── Reads ──────────────────────────────────────────────────────────────────
  const mine = useQuery({
    queryKey: staffKeys.myIncidents(venue),
    queryFn: () => fetchMyIncidents(venue),
    enabled: venue !== '' && view === 'report',
  });
  // Read on both views for management, so the switch shows how many wait.
  const page = useQuery({
    queryKey: staffKeys.incidents(venue, filter),
    queryFn: () => fetchIncidentsPage(venue, filter),
    enabled: venue !== '' && reviews,
  });
  // The count on the switch is always the Open page's (the same cache when
  // Open is the filter): the reviewer's own open reports come off it.
  const openPage = useQuery({
    queryKey: staffKeys.incidents(venue, 'open'),
    queryFn: () => fetchIncidentsPage(venue, 'open'),
    enabled: venue !== '' && reviews,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: staffKeys.myIncidents(venue) });
    for (const f of INCIDENT_FILTERS) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.incidents(venue, f) });
    }
  };
  const pull = usePullRefresh(() =>
    Promise.all([
      view === 'report' ? mine.refetch() : null,
      reviews ? page.refetch() : null,
      reviews && filter !== 'open' ? openPage.refetch() : null,
    ]),
  );

  // ── Report ─────────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<IncidentDraft>(() => emptyIncidentDraft(Date.now()));
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [issues, setIssues] = useState<IncidentIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const courts = useQuery({
    queryKey: staffKeys.courts(venue),
    queryFn: () => fetchCourts(venue),
    enabled: venue !== '' && draft.place === 'court',
  });

  const edit = (patch: Partial<IncidentDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const submit = useMutation({
    mutationKey: staffKeys.mutation('incident'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof incidentArgs>; intent: string }) =>
      submitIncident(args, staffIntentKey(intent, 'incident')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.incidents.form.sent'), 'success');
      setDraft(emptyIncidentDraft(Date.now()));
      setPhotos([]);
      setIssues([]);
      refreshAll();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSubmit = () => {
    setError(null);
    const current = { ...draft, photos: photos.map((p) => p.path) };
    const found = validateIncident(current, Date.now());
    setIssues(found);
    if (found.length > 0 || !venue) return;
    const args = incidentArgs(current, venue);
    submit.mutate({ args, intent: intentFor('incident.submit', args) });
  };

  // The example under "When" is now at the venue, the shape the field takes.
  const example = venueDateTimeText(new Date().toISOString());
  const fieldError = (field: Exclude<IncidentField, 'photos'>): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    const keys: Record<Exclude<IncidentField, 'photos'>, MessageKey> = {
      kind: 'staff.incidents.form.errors.kind',
      when:
        issue.code === 'future'
          ? 'staff.incidents.form.errors.future'
          : issue.code === 'tooOld'
            ? 'staff.incidents.form.errors.tooOld'
            : 'staff.incidents.form.errors.when',
      place: 'staff.incidents.form.errors.place',
      courtId: 'staff.incidents.form.errors.court',
      placeDetail: 'staff.incidents.form.errors.placeDetailTooLong',
      description:
        issue.code === 'tooLong'
          ? 'staff.incidents.form.errors.descriptionTooLong'
          : 'staff.incidents.form.errors.description',
      people: 'staff.incidents.form.errors.peopleTooLong',
    };
    return t(keys[field], { example: isolate(example) });
  };

  // ── Review ─────────────────────────────────────────────────────────────────
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const review = useMutation({
    mutationKey: staffKeys.mutation('incident.review'),
    mutationFn: (v: { id: string; note: string }) => reviewIncident(v.id, v.note),
    onSuccess: () => {
      toast(t('staff.incidents.review.done'), 'success');
      setReviewing(null);
      setNote('');
      refreshAll();
    },
    onError: (err) => {
      setNoteError(t(mapStaffError(err)));
      refreshAll();
    },
  });

  const onReview = (id: string) => {
    const problem = validateReviewNote(note);
    if (problem) {
      setNoteError(
        t(
          problem === 'tooLong'
            ? 'staff.incidents.review.errors.noteTooLong'
            : 'staff.incidents.review.errors.note',
        ),
      );
      return;
    }
    setNoteError(null);
    review.mutate({ id, note: note.trim() });
  };

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const small = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut };

  const loadError = (testID: string, query: { error: unknown; refetch: () => unknown }) => (
    <ErrorState
      testID={testID}
      title={t('errors.loadFailedTitle')}
      message={t(mapStaffError(query.error))}
      retryLabel={t('common.retry')}
      onRetry={() => void query.refetch()}
    />
  );

  const whereOf = (r: IncidentRow): string => {
    const place =
      r.place === 'court'
        ? localName(r.court_name_en, r.court_name_ar, locale) || t('work.incident.place.court')
        : t(`work.incident.place.${r.place}`);
    return r.place_detail
      ? t('staff.incidents.list.where', { place, detail: isolate(r.place_detail) })
      : place;
  };

  /** One report as both lists show it; the review controls go under it. */
  const reportRow = (r: IncidentRow, last: boolean, withReporter: boolean) => {
    const open = reviewing === r.id;
    return (
      <View
        key={r.id}
        testID={`staff-incidents.item.${r.id}`}
        style={{
          padding: space.m,
          gap: 4,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.sub,
          backgroundColor: r.id === params.id ? colors.tint : 'transparent',
        }}
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
            style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}
          >
            {t(`work.incident.kind.${r.kind}`)}
          </Text>
          <Tag tone={INCIDENT_TONE[r.status]} label={t(`work.incident.status.${r.status}`)} />
        </View>
        <Text style={small}>
          {formatDateTime(new Date(r.occurred_at), locale)} · {whereOf(r)}
        </Text>
        {withReporter && r.reported_by_name ? (
          <Text style={{ ...small, fontFamily: fonts.body600 }}>
            {r.reported_by_role
              ? t('staff.incidents.list.from', {
                  name: isolate(r.reported_by_name),
                  role: t(`op.roles.${r.reported_by_role as StaffRole}`),
                })
              : r.reported_by_name}
          </Text>
        ) : null}
        {r.redacted ? (
          <Text style={{ ...body, fontStyle: 'italic' }}>{t('staff.incidents.list.redacted')}</Text>
        ) : (
          <Text style={{ ...body, color: colors.ink }}>{r.description}</Text>
        )}
        {r.people_involved ? (
          <Text style={body}>
            {t('staff.incidents.list.people', { people: isolate(r.people_involved) })}
          </Text>
        ) : null}
        {/* A redacted report keeps its photos only until protocol-action's next
            tick (0198 redact_incident); they are never shown again meanwhile. */}
        {r.redacted ? (
          r.photos.length > 0 ? (
            <Text style={small}>{t('staff.incidents.list.photosGoing')}</Text>
          ) : null
        ) : (
          <StoredPhotos paths={r.photos} />
        )}
        {r.review_note ? (
          <Text style={{ ...body, color: colors.ink }}>
            {t('staff.incidents.list.reviewedBy', {
              name: isolate(r.reviewed_by_name ?? ''),
              note: isolate(r.review_note),
            })}
          </Text>
        ) : null}
        {withReporter && r.status === 'open' && r.can_review === false ? (
          <Text style={small}>
            {t(`staff.incidents.review.${ownReportLine(r.reported_by_role)}`)}
          </Text>
        ) : null}
        {withReporter && r.can_review && !open ? (
          <Button
            testID={`staff-incidents.review.${r.id}`}
            label={t('staff.incidents.review.open')}
            variant="secondary"
            size="compact"
            onPress={() => {
              setReviewing(r.id);
              setNote('');
              setNoteError(null);
            }}
            style={{ alignSelf: 'flex-start', marginTop: space.xs }}
          />
        ) : null}
        {withReporter && r.can_review && open ? (
          <View
            style={{
              gap: space.s,
              marginTop: space.s,
              paddingTop: space.s,
              borderTopWidth: 1,
              borderTopColor: colors.sub,
            }}
          >
            <Field
              testID="staff-incidents.review.note"
              label={t('staff.incidents.review.note')}
              value={note}
              onChangeText={(text) => {
                setNote(text);
                setNoteError(null);
              }}
              multiline
              boxStyle={MULTILINE_BOX}
              style={MULTILINE_TEXT}
              maxLength={INCIDENT_CAPS.note}
              error={noteError}
            />
            <Hint style={{ marginTop: 0 }}>{t('staff.incidents.review.noteHint')}</Hint>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                testID="staff-incidents.review.confirm"
                label={t('staff.incidents.review.confirm')}
                variant="primary"
                size="compact"
                busy={review.isPending}
                onPress={() => onReview(r.id)}
                style={{ flex: 1 }}
              />
              <Button
                testID="staff-incidents.review.cancel"
                label={t('staff.incidents.review.cancel')}
                variant="secondary"
                size="compact"
                disabled={review.isPending}
                onPress={() => {
                  setReviewing(null);
                  setNote('');
                  setNoteError(null);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const whenPreview = parseVenueDateTime(draft.when);

  // ── The report form, then one's own reports ─────────────────────────────────
  const reportView = (
    <>
      <Lead>{t('staff.incidents.lead')}</Lead>
      <Card style={{ padding: space.m, gap: space.s }}>
        <Text
          accessibilityRole="header"
          style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: colors.ink }}
        >
          {t('staff.incidents.form.title')}
        </Text>
        <GroupLabel>{t('staff.incidents.form.kind')}</GroupLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {INCIDENT_KINDS.map((kind) => (
            <Chip
              key={kind}
              testID={`staff-incidents.kind.${kind}`}
              label={t(`work.incident.kind.${kind}`)}
              selected={draft.kind === kind}
              onPress={() => edit({ kind })}
            />
          ))}
        </View>
        <ErrorText>{fieldError('kind')}</ErrorText>
        <Field
          testID="staff-incidents.when"
          label={t('staff.incidents.form.when')}
          value={draft.when}
          onChangeText={(when) => edit({ when })}
          keyboardType="numbers-and-punctuation"
          latin
          error={fieldError('when')}
        />
        <Hint style={{ marginTop: 0 }}>
          {whenPreview
            ? formatDateTime(new Date(whenPreview), locale)
            : t('staff.incidents.form.whenHint', { example: isolate(example) })}
        </Hint>
        <GroupLabel>{t('staff.incidents.form.place')}</GroupLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {INCIDENT_PLACES.map((place) => (
            <Chip
              key={place}
              testID={`staff-incidents.place.${place}`}
              label={t(`work.incident.place.${place}`)}
              selected={draft.place === place}
              onPress={() => {
                setDraft((d) => withPlace(d, place));
                setIssues((all) => all.filter((i) => i.field !== 'place' && i.field !== 'courtId'));
              }}
            />
          ))}
        </View>
        <ErrorText>{fieldError('place')}</ErrorText>
        {draft.place === 'court' ? (
          <>
            <GroupLabel>{t('staff.incidents.form.court')}</GroupLabel>
            {courts.isPending ? (
              <SkeletonList rows={1} height={36} />
            ) : courts.isError ? (
              loadError('staff-incidents.courts-error', courts)
            ) : (courts.data ?? []).length === 0 ? (
              <Hint style={{ marginTop: 0 }}>{t('staff.incidents.form.noCourts')}</Hint>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {(courts.data ?? []).map((c) => (
                  <Chip
                    key={c.id}
                    testID={`staff-incidents.court.${c.id}`}
                    label={localName(c.name_en, c.name_ar, locale)}
                    selected={draft.courtId === c.id}
                    onPress={() => edit({ courtId: c.id })}
                  />
                ))}
              </View>
            )}
            <ErrorText>{fieldError('courtId')}</ErrorText>
          </>
        ) : null}
        <Field
          testID="staff-incidents.place-detail"
          label={t('staff.incidents.form.placeDetail')}
          value={draft.placeDetail}
          onChangeText={(placeDetail) => edit({ placeDetail })}
          maxLength={INCIDENT_CAPS.placeDetail}
          error={fieldError('placeDetail')}
        />
        <Field
          testID="staff-incidents.description"
          label={t('staff.incidents.form.description')}
          value={draft.description}
          onChangeText={(description) => edit({ description })}
          multiline
          boxStyle={MULTILINE_BOX}
          style={MULTILINE_TEXT}
          maxLength={INCIDENT_CAPS.description}
          error={fieldError('description')}
        />
        <Field
          testID="staff-incidents.people"
          label={t('staff.incidents.form.people')}
          value={draft.people}
          onChangeText={(people) => edit({ people })}
          multiline
          boxStyle={MULTILINE_BOX}
          style={MULTILINE_TEXT}
          maxLength={INCIDENT_CAPS.people}
          error={fieldError('people')}
        />
        <Hint style={{ marginTop: 0 }}>{t('staff.incidents.form.privacyHint')}</Hint>
        <GroupLabel>{t('staff.incidents.form.photos')}</GroupLabel>
        <PhotoButton
          testID="staff-incidents.photo"
          venueId={venue}
          folder="incidents"
          photos={photos}
          onChange={setPhotos}
          max={INCIDENT_CAPS.photos}
          disabled={submit.isPending || venue === ''}
        />
        <Text style={{ ...body, marginTop: space.xs }}>{t('staff.incidents.form.whoSees')}</Text>
        <ErrorText>{error}</ErrorText>
        <Button
          testID="staff-incidents.submit"
          label={t('staff.incidents.form.submit')}
          variant="primary"
          busy={submit.isPending}
          disabled={venue === ''}
          onPress={onSubmit}
        />
      </Card>

      <MicroLabel style={{ paddingStart: 4, marginTop: space.m }}>
        {t('staff.incidents.mine.title')}
      </MicroLabel>
      {mine.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={96} />
      ) : mine.isError ? (
        loadError('staff-incidents.mine-error', mine)
      ) : (mine.data?.incidents ?? []).length === 0 ? (
        <Hint>{t('staff.incidents.mine.empty')}</Hint>
      ) : (
        <ListCard>
          {namedFirst(mine.data?.incidents ?? [], params.id).map((r, i, all) =>
            reportRow(r, i === all.length - 1, false),
          )}
        </ListCard>
      )}
    </>
  );

  // ── Management's review list ────────────────────────────────────────────────
  const pageRows = namedFirst(page.data?.incidents ?? [], params.id);
  const reviewView = (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {INCIDENT_FILTERS.map((f) => (
          <Chip
            key={f}
            testID={`staff-incidents.filter.${f}`}
            label={t(`staff.incidents.review.filters.${f}`)}
            selected={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>
      {page.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={110} />
      ) : page.isError ? (
        loadError('staff-incidents.review-error', page)
      ) : pageRows.length === 0 ? (
        <Hint>
          {t(
            filter === 'open' ? 'staff.incidents.review.emptyOpen' : 'staff.incidents.review.empty',
          )}
        </Hint>
      ) : (
        <ListCard>{pageRows.map((r, i) => reportRow(r, i === pageRows.length - 1, true))}</ListCard>
      )}
    </>
  );

  const openCount = toReviewCount(openPage.data);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.incidents.title') }} />
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
        {reviews ? (
          <SegmentedControl<IncidentsView>
            testID="staff-incidents.view"
            options={[
              {
                value: 'review',
                label:
                  openCount > 0
                    ? t('staff.incidents.views.review', { count: openCount })
                    : t('staff.incidents.views.reviewNone'),
              },
              { value: 'report', label: t('staff.incidents.views.report') },
            ]}
            value={view}
            onChange={setView}
          />
        ) : null}
        {view === 'report' ? reportView : reviewView}
      </ScrollView>
    </Screen>
  );
}

export default function StaffIncidentsRoute() {
  return (
    <RequireStaff>
      <IncidentsScreen />
    </RequireStaff>
  );
}
