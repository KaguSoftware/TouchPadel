import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space, useTheme } from '../../src/theme';
import { Button, Card, ErrorText, Field, Hint, Screen } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../../src/components/PhotoButton';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import { useBack } from '../../src/navigation/back';
import {
  GroupLabel,
  Lead,
  MULTILINE_BOX,
  MULTILINE_TEXT,
} from '../../src/features/staff/checklists/parts';
import { Chip } from '../../src/features/staff/protocols/FormFields';
import { fetchCourts } from '../../src/features/staff/protocols/api';
import { parseVenueDateTime, venueDateTimeText } from '../../src/features/staff/protocols/assemble';
import { intentFor } from '../../src/features/staff/supplies/logic';
import { localName } from '../../src/features/staff/marketing/logic';
import { submitIncident } from '../../src/features/staff/incidents/api';
import {
  INCIDENT_CAPS,
  INCIDENT_FILTERS,
  INCIDENT_KINDS,
  INCIDENT_PLACES,
  emptyIncidentDraft,
  incidentArgs,
  validateIncident,
  withPlace,
  type IncidentDraft,
  type IncidentField,
  type IncidentIssue,
} from '../../src/features/staff/incidents/logic';

/**
 * Report an incident (wave5-addendum-2026-09-25 §2.6, §5.3; migration 0198):
 * an accident, an injury, a fight or damage at the venue, with photos (folder
 * `incidents`). Every role reports. Opened by the + in the incidents page's top
 * bar; a sent report goes back to that page, which lists it.
 *
 * The report is immutable once sent (§8 Q12): corrections go in the review
 * note. Only the kind ever reaches a lock screen (§2.3).
 */
function IncidentReportScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const back = useBack('/staff-incidents');
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const venue = venueId ?? '';

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
      void queryClient.invalidateQueries({ queryKey: staffKeys.myIncidents(venue) });
      for (const f of INCIDENT_FILTERS) {
        void queryClient.invalidateQueries({ queryKey: staffKeys.incidents(venue, f) });
      }
      back();
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

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const whenPreview = parseVenueDateTime(draft.when);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.incidents.form.title') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        <Lead>{t('staff.incidents.lead')}</Lead>
        <Card style={{ padding: space.m, gap: space.s }}>
          <GroupLabel>{t('staff.incidents.form.kind')}</GroupLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {INCIDENT_KINDS.map((kind) => (
              <Chip
                key={kind}
                testID={`staff-incident-report.kind.${kind}`}
                label={t(`work.incident.kind.${kind}`)}
                selected={draft.kind === kind}
                onPress={() => edit({ kind })}
              />
            ))}
          </View>
          <ErrorText>{fieldError('kind')}</ErrorText>
          <Field
            testID="staff-incident-report.when"
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
                testID={`staff-incident-report.place.${place}`}
                label={t(`work.incident.place.${place}`)}
                selected={draft.place === place}
                onPress={() => {
                  setDraft((d) => withPlace(d, place));
                  setIssues((all) =>
                    all.filter((i) => i.field !== 'place' && i.field !== 'courtId'),
                  );
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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {(courts.data ?? []).map((c) => (
                    <Chip
                      key={c.id}
                      testID={`staff-incident-report.court.${c.id}`}
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
            testID="staff-incident-report.place-detail"
            label={t('staff.incidents.form.placeDetail')}
            value={draft.placeDetail}
            onChangeText={(placeDetail) => edit({ placeDetail })}
            maxLength={INCIDENT_CAPS.placeDetail}
            error={fieldError('placeDetail')}
          />
          <Field
            testID="staff-incident-report.description"
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
            testID="staff-incident-report.people"
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
            testID="staff-incident-report.photo"
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
            testID="staff-incident-report.submit"
            label={t('staff.incidents.form.submit')}
            variant="primary"
            busy={submit.isPending}
            disabled={venue === ''}
            onPress={onSubmit}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

export default function StaffIncidentReportRoute() {
  return (
    <RequireStaff>
      <IncidentReportScreen />
    </RequireStaff>
  );
}
