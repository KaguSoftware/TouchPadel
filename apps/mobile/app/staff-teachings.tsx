import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STAFF_TEAMS, teamOf, type StaffTeam } from '@touch/core';
import { formatDate, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { staffPhotoUrl } from '../src/features/staff/photo';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { archiveTeaching, fetchTeachings, saveTeaching } from '../src/features/staff/teachings/api';
import {
  BODY_MAX,
  PHOTOS_MAX,
  TEACHING_ROLES,
  TITLE_MAX,
  canWriteTeaching,
  draftFrom,
  emptyTeaching,
  isMgmt,
  teachingArgs,
  teachingFilters,
  teachingIntent,
  teachingsKeyTeam,
  teachingsTeamArg,
  validateTeaching,
  type Teaching,
  type TeachingArgs,
  type TeachingDraft,
  type TeachingField,
  type TeachingIssue,
  type TeachingsFilter,
} from '../src/features/staff/teachings/logic';
import { StaffPhotoThumb, Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Teachings (build-contracts-2026-09-23 §2.24.3, §6.1; plan #64): what the
 * head barista teaches the bar and the head chef the kitchen. The barista and
 * the chef assistant read their own team's; a head writes for their team and
 * edits or removes their own; the manager and the owner read both teams and
 * write for either. One title and one text in the writer's language, with up
 * to six photos. Nothing records who opened a teaching.
 *
 * `?id=` is a teaching a push named; it is listed first.
 */

function TeachingsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const role = status.kind === 'staff' ? status.staff.role : 'barista';
  const mgmt = isMgmt(role);
  const writer = canWriteTeaching(role);
  const venue = venueId ?? '';

  const [filter, setFilter] = useState<TeachingsFilter>('all');
  const listKey = staffKeys.teachings(venue, teachingsKeyTeam(role, filter));
  const teachings = useQuery({
    queryKey: listKey,
    queryFn: () => fetchTeachings(venue, teachingsTeamArg(role, filter)),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => teachings.refetch());

  // The form: closed (null), a new teaching, or an edit.
  const [draft, setDraft] = useState<TeachingDraft | null>(null);
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [issues, setIssues] = useState<TeachingIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const refreshLists = () => {
    for (const team of ['all', ...STAFF_TEAMS]) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.teachings(venue, team) });
    }
  };

  const close = () => {
    setDraft(null);
    setPhotos([]);
    setIssues([]);
    setError(null);
  };

  const save = useMutation({
    mutationKey: staffKeys.mutation('teaching'),
    mutationFn: (args: TeachingArgs) =>
      saveTeaching(args, args.p_id ? null : staffIntentKey(teachingIntent(args), 'teaching')),
    onSuccess: (_result, args) => {
      if (!args.p_id) clearStaffIntentKey(teachingIntent(args));
      toast(t('staff.checklists.teachings.saved'), 'success');
      close();
      refreshLists();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const archive = useMutation({
    mutationKey: staffKeys.mutation('teaching.archive'),
    mutationFn: (id: string) => archiveTeaching(id),
    onSuccess: () => {
      toast(t('staff.checklists.teachings.archived'), 'info');
      refreshLists();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });

  const openNew = () => {
    setDraft(emptyTeaching(role));
    setPhotos([]);
    setIssues([]);
    setError(null);
  };

  // An edit shows the stored photos by signed URL; one that cannot be signed
  // still shows as a grey tile the writer can remove.
  const openEdit = async (teaching: Teaching) => {
    setOpening(teaching.id);
    const attached = await Promise.all(
      teaching.photos.map(async (path) => {
        try {
          const uri = await queryClient.fetchQuery({
            queryKey: staffKeys.photoUrl(path),
            queryFn: () => staffPhotoUrl(path),
            staleTime: 8 * 60_000,
          });
          return { path, uri };
        } catch {
          return { path, uri: '' };
        }
      }),
    );
    setOpening(null);
    setDraft(draftFrom(teaching));
    setPhotos(attached);
    setIssues([]);
    setError(null);
  };

  const edit = (patch: Partial<TeachingDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setError(null);
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const onSave = () => {
    if (!draft || venue === '') return;
    setError(null);
    const withPhotos = { ...draft, photos: photos.map((p) => p.path) };
    const found = validateTeaching(withPhotos, role);
    setIssues(found);
    if (found.length === 0) save.mutate(teachingArgs(withPhotos, role, venue));
  };

  const confirmArchive = (teaching: Teaching) => {
    Alert.alert(t('staff.checklists.teachings.archiveTitle'), t('staff.checklists.teachings.archiveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.checklists.teachings.archive'),
        style: 'destructive',
        onPress: () => archive.mutate(teaching.id),
      },
    ]);
  };

  const fieldError = (field: TeachingField): string | null =>
    issues.some((i) => i.field === field) ? t(`staff.checklists.teachings.errors.${field}`) : null;

  const lead = mgmt
    ? 'staff.checklists.teachings.leadMgmt'
    : writer
      ? 'staff.checklists.teachings.leadHead'
      : 'staff.checklists.teachings.lead';

  const rows = (() => {
    const all = teachings.data?.teachings ?? [];
    const first = params.id ? all.filter((r) => r.id === params.id) : [];
    return [...first, ...all.filter((r) => r.id !== params.id)];
  })();

  const form = () => {
    if (!draft) return null;
    const ownTeam: StaffTeam | null = draft.team ?? teamOf(role);
    return (
      <Card style={{ padding: space.m, gap: space.s }}>
        <MicroLabel>
          {t(draft.id ? 'staff.checklists.teachings.editTitle' : 'staff.checklists.teachings.newTitle')}
        </MicroLabel>
        {mgmt && !draft.id ? (
          <>
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
              {t('staff.checklists.teachings.team')}
            </Text>
            {/* Two buttons, not a segmented control: nothing is picked until
                the writer picks, and a segmented control always shows one. */}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              {STAFF_TEAMS.map((team) => (
                <Button
                  key={team}
                  testID={`staff-teachings.team.${team}`}
                  label={t(`work.team.${team}`)}
                  variant={draft.team === team ? 'primary' : 'secondary'}
                  size="compact"
                  onPress={() => edit({ team })}
                  style={{ flex: 1 }}
                />
              ))}
            </View>
            {fieldError('team') ? <ErrorText>{fieldError('team')}</ErrorText> : null}
          </>
        ) : ownTeam ? (
          <Tag tone="info" label={t('staff.checklists.teachings.forTeam', { team: t(`work.team.${ownTeam}`) })} />
        ) : null}
        <Field
          testID="staff-teachings.title"
          label={t('staff.checklists.teachings.titleField')}
          value={draft.title}
          onChangeText={(title) => edit({ title })}
          maxLength={TITLE_MAX}
          error={fieldError('title')}
        />
        <Field
          testID="staff-teachings.body"
          label={t('staff.checklists.teachings.body')}
          value={draft.body}
          onChangeText={(body) => edit({ body })}
          multiline
          maxLength={BODY_MAX}
          error={fieldError('body')}
        />
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
          {t('staff.checklists.teachings.photos')}
        </Text>
        <PhotoButton
          testID="staff-teachings.photo"
          venueId={venue}
          folder="teachings"
          photos={photos}
          onChange={setPhotos}
          max={PHOTOS_MAX}
          disabled={save.isPending}
        />
        <ErrorText>{error}</ErrorText>
        <Button
          testID="staff-teachings.save"
          label={t('staff.checklists.teachings.save')}
          variant="primary"
          busy={save.isPending}
          onPress={onSave}
        />
        <Button
          testID="staff-teachings.cancel"
          label={t('common.cancel')}
          variant="ghost"
          onPress={close}
          disabled={save.isPending}
        />
      </Card>
    );
  };

  const list = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (teachings.isPending) return <SkeletonList rows={2} height={120} />;
    if (teachings.isError) {
      return (
        <ErrorState
          testID="staff-teachings.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(teachings.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void teachings.refetch()}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          testID="staff-teachings.empty"
          title={t('staff.checklists.teachings.emptyTitle')}
          message={t('staff.checklists.teachings.emptyBody')}
        />
      );
    }
    return rows.map((row) => (
      <Card
        key={row.id}
        style={{
          padding: space.m,
          gap: space.s,
          ...(row.id === params.id ? { borderColor: colors.blue, borderWidth: 1.5 } : null),
        }}
      >
        <View testID={`staff-teachings.item.${row.id}`} style={{ gap: 6 }}>
          {mgmt ? <Tag tone="info" label={t(`work.team.${row.team}`)} /> : null}
          <Text style={{ fontFamily: fonts.body800, fontSize: 15, lineHeight: 21, color: colors.ink }}>
            {row.title}
          </Text>
          <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 21, color: colors.ink }}>
            {row.body}
          </Text>
          {row.photos.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {row.photos.map((path, i) => (
                <StaffPhotoThumb
                  key={path}
                  path={path}
                  size={96}
                  label={t('staff.checklists.teachings.photo', { n: i + 1 })}
                />
              ))}
            </View>
          ) : null}
          <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
            {t('staff.checklists.teachings.byline', {
              name: isolate(row.author_name ?? ''),
              date: formatDate(new Date(row.created_at), locale),
            })}
            {row.updated_at !== row.created_at
              ? ` · ${t('staff.checklists.teachings.edited', { date: formatDate(new Date(row.updated_at), locale) })}`
              : ''}
          </Text>
        </View>
        {row.editable ? (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              testID={`staff-teachings.edit.${row.id}`}
              label={t('staff.checklists.teachings.edit')}
              variant="secondary"
              size="compact"
              busy={opening === row.id}
              disabled={draft !== null}
              onPress={() => void openEdit(row)}
            />
            <Button
              testID={`staff-teachings.archive.${row.id}`}
              label={t('staff.checklists.teachings.archive')}
              variant="ghost"
              busy={archive.isPending && archive.variables === row.id}
              onPress={() => confirmArchive(row)}
            />
          </View>
        ) : null}
      </Card>
    ));
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.teachings.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>
          {t(lead)}
        </Text>
        {writer && !draft ? (
          <Button
            testID="staff-teachings.write"
            label={t('staff.checklists.teachings.write')}
            variant="primary"
            onPress={openNew}
            disabled={venue === ''}
          />
        ) : null}
        {form()}
        {teachingFilters(role).length > 0 ? (
          <SegmentedControl<TeachingsFilter>
            testID="staff-teachings.filter"
            options={teachingFilters(role).map((f) => ({
              value: f,
              label: f === 'all' ? t('staff.checklists.teachings.bothTeams') : t(`work.team.${f}`),
            }))}
            value={filter}
            onChange={setFilter}
          />
        ) : null}
        <View testID="staff-teachings.list" style={{ gap: space.sm }}>
          <MicroLabel style={{ paddingStart: 4 }}>{t('staff.checklists.teachings.listTitle')}</MicroLabel>
          {list()}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function StaffTeachingsRoute() {
  return (
    <RequireStaff roles={TEACHING_ROLES}>
      <TeachingsScreen />
    </RequireStaff>
  );
}
