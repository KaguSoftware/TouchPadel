import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localIsoDate, parseTypedDate } from '@touch/core';
import { formatDate, formatDateTime, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { MenuRow } from '../src/components/booking';
import { EnvelopeIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { staffPhotoUrl } from '../src/features/staff/photo';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { StoredPhotos } from '../src/features/staff/supplies/StoredPhotos';
import { GroupLabel, Lead, MULTILINE_BOX, MULTILINE_TEXT, Tag, type TagTone } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { useReduceMotion } from '../src/lib/useReduceMotion';
import { intentFor } from '../src/features/staff/supplies/logic';
import { PickList, type PickOption } from '../src/features/staff/marketing/PickList';
import {
  addMarketingNote,
  fetchActiveRuns,
  fetchCampaignResults,
  fetchMarketingRequestsPage,
  fetchMenuItemOptions,
  fetchMyCampaignDrafts,
  fetchMyMarketingNotes,
  suggestCampaign,
  type CampaignDraftRow,
  type CampaignResult,
  type NoteSubjectKind,
} from '../src/features/staff/marketing/api';
import {
  MARKETING_CHANNELS,
  MARKETING_TABS,
  NOTE_SUBJECT_KINDS,
  campaignArgs,
  draftFromRow,
  emptyCampaignDraft,
  emptyNoteDraft,
  localName,
  noteArgs,
  validateCampaign,
  validateNote,
  type CampaignDraft,
  type CampaignField,
  type DraftLinkKind,
  type Issue,
  type MarketingChannel,
  type MarketingTab,
  type NoteDraft,
  type NoteField,
} from '../src/features/staff/marketing/logic';

/**
 * Marketing (build-contracts-2026-09-23 §6.1, §2.17, §2.24.11; plan #14, #73).
 *
 *   My take   marketing's own view of an item, a launch or tournament run, or
 *             a campaign (marketing_notes), with photos. It is the feedback
 *             panel, not a log of what guests said; the manager and the owner
 *             read it on the run and the campaign.
 *   Drafts    campaign suggestions. The owner completes the audience and the
 *             promotion and makes it live, on the operator only (plan #14);
 *             a draft stays the suggester's to change until the owner saves it.
 *   Results   what the venue's campaigns reached, in counts: sends, delivered,
 *             failed, promotion redemptions. Never a discount, revenue, tab or
 *             order figure (#73, the server's shape).
 *
 * The Requests row opens staff-marketing-requests, marketing's inbox.
 * "Approval" is parked (§0 P7): nothing here makes a campaign live.
 */

const DRAFT_LINKS: readonly DraftLinkKind[] = ['none', 'item', 'run'];

/** A campaign's status as a tag: live is good news, scheduled is on its way, cancelled did not happen. */
const CAMPAIGN_TONE: Record<CampaignDraftRow['status'], TagTone> = {
  draft: 'plain',
  scheduled: 'info',
  live: 'good',
  ended: 'plain',
  cancelled: 'bad',
};

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function MarketingScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const example = localIsoDate(new Date());

  const [tab, setTab] = useState<MarketingTab>('take');
  const scroll = useRef<ScrollView>(null);
  const reduceMotion = useReduceMotion();

  // ── The take form's and the draft form's state ─────────────────────────────
  const [note, setNote] = useState<NoteDraft>(emptyNoteDraft);
  const [notePhotos, setNotePhotos] = useState<AttachedPhoto[]>([]);
  const [noteIssues, setNoteIssues] = useState<Issue<NoteField>[]>([]);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [campaign, setCampaign] = useState<CampaignDraft | null>(null);
  const [campaignPhotos, setCampaignPhotos] = useState<AttachedPhoto[]>([]);
  const [campaignIssues, setCampaignIssues] = useState<Issue<CampaignField>[]>([]);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  // What the pickers need, read only once one is showing.
  const wantsItems =
    (tab === 'take' && note.subjectKind === 'item') || (tab === 'drafts' && campaign?.linkKind === 'item');
  const wantsRuns =
    (tab === 'take' && note.subjectKind === 'run') || (tab === 'drafts' && campaign?.linkKind === 'run');

  const notes = useQuery({
    queryKey: staffKeys.marketingNotes(venue),
    queryFn: () => fetchMyMarketingNotes(venue),
    enabled: venue !== '' && tab === 'take',
  });
  const drafts = useQuery({
    queryKey: staffKeys.campaignDrafts(venue),
    queryFn: () => fetchMyCampaignDrafts(venue),
    enabled: venue !== '' && tab === 'drafts',
  });
  const results = useQuery({
    queryKey: staffKeys.campaignResults(venue),
    queryFn: () => fetchCampaignResults(venue),
    enabled: venue !== '' && (tab === 'results' || (tab === 'take' && note.subjectKind === 'campaign')),
  });
  const requests = useQuery({
    queryKey: staffKeys.marketingRequests(venue, 'open'),
    queryFn: () => fetchMarketingRequestsPage(venue, 'open'),
    enabled: venue !== '',
  });
  const items = useQuery({
    queryKey: staffKeys.menuItems(venue),
    queryFn: () => fetchMenuItemOptions(venue),
    enabled: venue !== '' && wantsItems,
  });
  const runs = useQuery({
    queryKey: staffKeys.runs(venue, 'active'),
    queryFn: () => fetchActiveRuns(venue),
    enabled: venue !== '' && wantsRuns,
  });

  // A pull reads again what the open tab shows, and the Requests row's count.
  const pull = usePullRefresh(() =>
    Promise.all([
      requests.refetch(),
      tab === 'take' ? notes.refetch() : tab === 'drafts' ? drafts.refetch() : results.refetch(),
    ]),
  );

  const itemOptions: PickOption[] = useMemo(
    () =>
      (items.data ?? [])
        .map((i) => ({ id: i.id, label: localName(i.name_en, i.name_ar, locale) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [items.data, locale],
  );
  const runOptions: PickOption[] = useMemo(
    () =>
      (runs.data?.runs ?? []).map((r) => {
        const kind = t(`work.protocol.kind.${r.kind}`);
        return { id: r.id, label: localName(r.title_en, r.title_ar, locale) || kind, detail: kind };
      }),
    [runs.data, locale, t],
  );
  const campaignOptions: PickOption[] = useMemo(
    () =>
      (results.data?.campaigns ?? []).map((c) => ({
        id: c.campaign_id,
        label: localName(c.name_en, c.name_ar, locale),
        detail: t(`staff.marketing.campaignStatus.${c.status}`),
      })),
    [results.data, locale, t],
  );

  // ── My take ────────────────────────────────────────────────────────────────
  const addNote = useMutation({
    mutationKey: staffKeys.mutation('marketing_note'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof noteArgs>; intent: string }) =>
      addMarketingNote(args, staffIntentKey(intent, 'marketing_note')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.marketing.take.saved'), 'success');
      setNote(emptyNoteDraft());
      setNotePhotos([]);
      setNoteIssues([]);
      void queryClient.invalidateQueries({ queryKey: staffKeys.marketingNotes(venue) });
    },
    onError: (err) => setNoteError(t(mapStaffError(err))),
  });

  const onAddNote = () => {
    setNoteError(null);
    const current = { ...note, photos: notePhotos.map((p) => p.path) };
    const found = validateNote(current);
    setNoteIssues(found);
    if (found.length > 0 || !venue) return;
    const args = noteArgs(current, venue);
    addNote.mutate({ args, intent: intentFor('marketing_note', args) });
  };

  const noteFieldError = (field: NoteField): string | null => {
    const issue = noteIssues.find((i) => i.field === field);
    if (!issue) return null;
    if (field === 'subject') return t('staff.marketing.take.errors.subject');
    if (field === 'body') {
      return t(issue.code === 'tooLong' ? 'staff.marketing.take.errors.bodyTooLong' : 'staff.marketing.take.errors.body');
    }
    return null;
  };

  // ── Drafts ─────────────────────────────────────────────────────────────────
  const openDraft = async (row: CampaignDraftRow | null) => {
    setCampaignIssues([]);
    setCampaignError(null);
    if (!row) {
      setCampaign(emptyCampaignDraft());
      setCampaignPhotos([]);
      return;
    }
    setCampaign(draftFromRow(row, locale));
    // A saved image shows through its signed URL; one that cannot be read
    // still keeps its path, so saving never drops it.
    const shown = await Promise.all(
      row.images.map(async (path) => {
        try {
          const uri = await queryClient.fetchQuery({
            queryKey: staffKeys.photoUrl(path),
            queryFn: () => staffPhotoUrl(path),
          });
          return { path, uri };
        } catch {
          return { path, uri: '' };
        }
      }),
    );
    setCampaignPhotos(shown);
  };

  // The draft form opens above the list; bring it into view, or a draft tapped
  // low in the list looks as if the tap did nothing.
  const openForm = campaign ? (campaign.id ?? 'new') : null;
  useEffect(() => {
    if (openForm) scroll.current?.scrollTo({ y: 0, animated: !reduceMotion });
  }, [openForm, reduceMotion]);

  const editCampaign = (patch: Partial<CampaignDraft>) => {
    setCampaign((c) => (c ? { ...c, ...patch } : c));
    setCampaignIssues((all) => all.filter((i) => !(i.field in patch) && !(i.field === 'link' && 'linkId' in patch)));
  };

  const saveCampaign = useMutation({
    mutationKey: staffKeys.mutation('campaign'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof campaignArgs>; intent: string | null }) =>
      suggestCampaign(args, intent ? staffIntentKey(intent, 'campaign') : null),
    onSuccess: (_data, { intent }) => {
      if (intent) clearStaffIntentKey(intent);
      toast(t('staff.marketing.drafts.saved'), 'success');
      setCampaign(null);
      setCampaignPhotos([]);
      setCampaignIssues([]);
      void queryClient.invalidateQueries({ queryKey: staffKeys.campaignDrafts(venue) });
      void queryClient.invalidateQueries({ queryKey: staffKeys.campaignResults(venue) });
    },
    onError: (err) => {
      setCampaignError(t(mapStaffError(err)));
      void queryClient.invalidateQueries({ queryKey: staffKeys.campaignDrafts(venue) });
    },
  });

  const onSaveCampaign = () => {
    if (!campaign) return;
    setCampaignError(null);
    const current = { ...campaign, images: campaignPhotos.map((p) => p.path) };
    const found = validateCampaign(current);
    setCampaignIssues(found);
    if (found.length > 0 || !venue) return;
    const args = campaignArgs(current, venue);
    // Only a new draft is keyed (0168): a change to one's own draft is a plain update.
    saveCampaign.mutate({ args, intent: current.id ? null : intentFor('campaign', args) });
  };

  const campaignFieldError = (field: CampaignField): string | null => {
    const issue = campaignIssues.find((i) => i.field === field);
    if (!issue) return null;
    switch (field) {
      case 'name':
        return t(issue.code === 'tooLong' ? 'staff.marketing.drafts.errors.nameTooLong' : 'staff.marketing.drafts.errors.name');
      case 'channel':
        return t('staff.marketing.drafts.errors.channel');
      case 'starts':
      case 'ends':
        return issue.code === 'order'
          ? t('staff.marketing.drafts.errors.order')
          : t('staff.marketing.drafts.errors.date', { example: isolate(example) });
      case 'bodyEn':
      case 'bodyAr':
        return t('staff.marketing.drafts.errors.bodyTooLong');
      case 'note':
        return t('staff.marketing.drafts.errors.noteTooLong');
      case 'link':
        return t('staff.marketing.drafts.errors.link');
      default:
        return null;
    }
  };

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  const small = { fontFamily: fonts.body400, fontSize: 12, color: colors.mut };
  const openCount = requests.data?.open_count ?? 0;

  const loadError = (testID: string, query: { error: unknown; refetch: () => unknown }) => (
    <ErrorState
      testID={testID}
      title={t('errors.loadFailedTitle')}
      message={t(mapStaffError(query.error))}
      retryLabel={t('common.retry')}
      onRetry={() => void query.refetch()}
    />
  );

  /** Under a date field: the typed day as the reader says it, so a swapped month shows. */
  const datePreview = (text: string) => {
    const day = parseTypedDate(text);
    return day ? <Hint style={{ marginTop: 0 }}>{dayLabel(day, locale)}</Hint> : null;
  };

  const windowLabel = (starts: string | null, ends: string | null): string | null => {
    const from = starts ? formatDate(new Date(starts), locale) : null;
    const to = ends ? formatDate(new Date(ends), locale) : null;
    if (from && to) return t('staff.marketing.drafts.window', { from, to });
    if (from) return t('staff.marketing.drafts.from', { day: from });
    if (to) return t('staff.marketing.drafts.until', { day: to });
    return null;
  };

  const subjectOptions: Record<NoteSubjectKind, { options: PickOption[]; loading: boolean }> = {
    item: { options: itemOptions, loading: items.isPending && wantsItems },
    run: { options: runOptions, loading: runs.isPending && wantsRuns },
    campaign: { options: campaignOptions, loading: results.isPending && note.subjectKind === 'campaign' },
  };

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const takeTab = (
    <>
      <Lead>{t('staff.marketing.take.lead')}</Lead>
      <Card style={{ padding: space.m, gap: space.s }}>
        <MicroLabel>{t('staff.marketing.take.newTitle')}</MicroLabel>
        <GroupLabel>{t('staff.marketing.take.about')}</GroupLabel>
        <SegmentedControl<NoteSubjectKind>
          testID="staff-marketing.note.kind"
          options={NOTE_SUBJECT_KINDS.map((k) => ({ value: k, label: t(`staff.marketing.take.kinds.${k}`) }))}
          value={note.subjectKind}
          onChange={(subjectKind) => {
            setNote((n) => ({ ...n, subjectKind, subjectId: null }));
            setNoteIssues((all) => all.filter((i) => i.field !== 'subject'));
          }}
        />
        <PickList
          testID="staff-marketing.note.subject"
          options={subjectOptions[note.subjectKind].options}
          loading={subjectOptions[note.subjectKind].loading}
          value={note.subjectId}
          onChange={(subjectId) => {
            setNote((n) => ({ ...n, subjectId }));
            setNoteIssues((all) => all.filter((i) => i.field !== 'subject'));
          }}
          error={noteFieldError('subject')}
        />
        <Field
          testID="staff-marketing.note.body"
          label={t('staff.marketing.take.body')}
          value={note.body}
          onChangeText={(text) => {
            setNote((n) => ({ ...n, body: text }));
            setNoteIssues((all) => all.filter((i) => i.field !== 'body'));
          }}
          multiline
          boxStyle={MULTILINE_BOX}
          style={MULTILINE_TEXT}
          error={noteFieldError('body')}
        />
        <GroupLabel>{t('staff.marketing.take.photos')}</GroupLabel>
        <PhotoButton
          testID="staff-marketing.note.photo"
          venueId={venue}
          folder="marketing"
          photos={notePhotos}
          onChange={setNotePhotos}
          max={6}
          disabled={addNote.isPending}
        />
        <ErrorText>{noteError}</ErrorText>
        <Button
          testID="staff-marketing.note.add"
          label={t('staff.marketing.take.submit')}
          variant="primary"
          busy={addNote.isPending}
          onPress={onAddNote}
        />
      </Card>
      <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.marketing.take.mine')}</MicroLabel>
      {notes.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={80} />
      ) : notes.isError ? (
        loadError('staff-marketing.notes-error', notes)
      ) : (notes.data?.notes ?? []).length === 0 ? (
        <Hint>{t('staff.marketing.take.empty')}</Hint>
      ) : (
        (notes.data?.notes ?? []).map((n) => (
          <Card key={n.id} style={{ padding: space.m, gap: 6 }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
              {localName(n.subject_name_en, n.subject_name_ar, locale)}
            </Text>
            <Text style={small}>
              {`${t(`staff.marketing.take.kinds.${n.subject_kind}`)} · ${formatDateTime(new Date(n.created_at), locale)}`}
            </Text>
            <Text style={body}>{n.body}</Text>
            <StoredPhotos paths={n.photos} />
          </Card>
        ))
      )}
    </>
  );

  const draftForm = campaign ? (
    <Card style={{ padding: space.m, gap: space.s }}>
      <MicroLabel>{t(campaign.id ? 'staff.marketing.drafts.editTitle' : 'staff.marketing.drafts.newTitle')}</MicroLabel>
      <Field
        testID="staff-marketing.draft.name"
        label={t('staff.marketing.drafts.name')}
        value={campaign.name}
        onChangeText={(name) => editCampaign({ name })}
        error={campaignFieldError('name')}
      />
      <Hint style={{ marginTop: 0 }}>{t('staff.marketing.drafts.nameHint')}</Hint>
      <GroupLabel>{t('staff.marketing.drafts.channel')}</GroupLabel>
      <SegmentedControl<MarketingChannel>
        testID="staff-marketing.draft.channel"
        options={MARKETING_CHANNELS.map((c) => ({ value: c, label: t(`staff.marketing.channels.${c}`) }))}
        value={campaign.channel ?? 'telegram'}
        onChange={(channel) => editCampaign({ channel })}
      />
      <ErrorText>{campaignFieldError('channel')}</ErrorText>
      <Field
        testID="staff-marketing.draft.starts"
        label={t('staff.marketing.drafts.starts')}
        value={campaign.starts}
        onChangeText={(starts) => editCampaign({ starts })}
        keyboardType="numbers-and-punctuation"
        latin
        error={campaignFieldError('starts')}
      />
      {datePreview(campaign.starts)}
      <Field
        testID="staff-marketing.draft.ends"
        label={t('staff.marketing.drafts.ends')}
        value={campaign.ends}
        onChangeText={(ends) => editCampaign({ ends })}
        keyboardType="numbers-and-punctuation"
        latin
        error={campaignFieldError('ends')}
      />
      {datePreview(campaign.ends)}
      <Hint style={{ marginTop: 0 }}>{t('staff.marketing.dateHint', { example: isolate(example) })}</Hint>
      <Field
        testID="staff-marketing.draft.body-en"
        label={t('staff.marketing.drafts.bodyEn')}
        value={campaign.bodyEn}
        onChangeText={(bodyEn) => editCampaign({ bodyEn })}
        multiline
        boxStyle={MULTILINE_BOX}
        style={MULTILINE_TEXT}
        error={campaignFieldError('bodyEn')}
      />
      <Field
        testID="staff-marketing.draft.body-ar"
        label={t('staff.marketing.drafts.bodyAr')}
        value={campaign.bodyAr}
        onChangeText={(bodyAr) => editCampaign({ bodyAr })}
        multiline
        boxStyle={MULTILINE_BOX}
        style={MULTILINE_TEXT}
        error={campaignFieldError('bodyAr')}
      />
      <Field
        testID="staff-marketing.draft.note"
        label={t('staff.marketing.drafts.note')}
        value={campaign.note}
        onChangeText={(value) => editCampaign({ note: value })}
        multiline
        boxStyle={MULTILINE_BOX}
        style={MULTILINE_TEXT}
        error={campaignFieldError('note')}
      />
      <GroupLabel>{t('staff.marketing.drafts.link')}</GroupLabel>
      <SegmentedControl<DraftLinkKind>
        testID="staff-marketing.draft.link"
        options={DRAFT_LINKS.map((k) => ({ value: k, label: t(`staff.marketing.drafts.links.${k}`) }))}
        value={campaign.linkKind}
        onChange={(linkKind) => editCampaign({ linkKind, linkId: null })}
      />
      {campaign.linkKind !== 'none' ? (
        <PickList
          testID="staff-marketing.draft.link-pick"
          options={campaign.linkKind === 'item' ? itemOptions : runOptions}
          loading={campaign.linkKind === 'item' ? items.isPending : runs.isPending}
          value={campaign.linkId}
          onChange={(linkId) => editCampaign({ linkId })}
          error={campaignFieldError('link')}
        />
      ) : null}
      <GroupLabel>{t('staff.marketing.drafts.images')}</GroupLabel>
      <PhotoButton
        testID="staff-marketing.draft.photo"
        venueId={venue}
        folder="campaigns"
        photos={campaignPhotos}
        onChange={setCampaignPhotos}
        max={6}
        disabled={saveCampaign.isPending}
      />
      <ErrorText>{campaignError}</ErrorText>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID="staff-marketing.draft.save"
          label={t(campaign.id ? 'staff.marketing.drafts.saveChanges' : 'staff.marketing.drafts.save')}
          variant="primary"
          busy={saveCampaign.isPending}
          onPress={onSaveCampaign}
          style={{ flex: 1 }}
        />
        <Button
          testID="staff-marketing.draft.cancel"
          label={t('staff.marketing.drafts.cancel')}
          variant="secondary"
          onPress={() => setCampaign(null)}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  ) : null;

  const draftsTab = (
    <>
      <Lead>{t('staff.marketing.drafts.lead')}</Lead>
      {draftForm ?? (
        <Button
          testID="staff-marketing.draft.new"
          label={t('staff.marketing.drafts.new')}
          variant="secondary"
          onPress={() => void openDraft(null)}
        />
      )}
      <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.marketing.drafts.mine')}</MicroLabel>
      {drafts.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={72} />
      ) : drafts.isError ? (
        loadError('staff-marketing.drafts-error', drafts)
      ) : (drafts.data?.drafts ?? []).length === 0 ? (
        <Hint>{t('staff.marketing.drafts.empty')}</Hint>
      ) : (
        (drafts.data?.drafts ?? []).map((d) => {
          const when = windowLabel(d.starts_at, d.ends_at);
          const editing = campaign?.id === d.id;
          return (
            <Pressable
              key={d.id}
              testID={`staff-marketing.draft.${d.id}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: !d.editable }}
              disabled={!d.editable}
              onPress={() => void openDraft(d)}
              style={({ pressed }) => ({
                padding: space.m,
                gap: 4,
                borderRadius: radius.card,
                borderWidth: editing ? 1.5 : 1,
                borderColor: editing ? colors.blue : colors.line,
                backgroundColor: pressed ? colors.sub : colors.card,
              })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
                  {localName(d.name_en, d.name_ar, locale)}
                </Text>
                <Tag tone={CAMPAIGN_TONE[d.status]} label={t(`staff.marketing.campaignStatus.${d.status}`)} />
              </View>
              <Text style={small}>
                {when
                  ? `${t(`staff.marketing.channels.${d.channel}`)} · ${when}`
                  : t(`staff.marketing.channels.${d.channel}`)}
              </Text>
              <Text style={{ ...small, color: d.editable ? colors.blue : colors.mut }}>
                {t(d.editable ? 'staff.marketing.drafts.tapToChange' : 'staff.marketing.drafts.pickedUp')}
              </Text>
            </Pressable>
          );
        })
      )}
    </>
  );

  const count = (labelKey: MessageKey, value: number) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={small}>{t(labelKey)}</Text>
      <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>{formatNumber(value, locale)}</Text>
    </View>
  );

  const resultCard = (c: CampaignResult) => {
    const when = windowLabel(c.starts_at, c.ends_at);
    return (
      <Card key={c.campaign_id} style={{ padding: space.m, gap: space.s }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
          <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
            {localName(c.name_en, c.name_ar, locale)}
          </Text>
          <Tag tone={CAMPAIGN_TONE[c.status]} label={t(`staff.marketing.campaignStatus.${c.status}`)} />
        </View>
        <Text style={small}>
          {when ? `${t(`staff.marketing.channels.${c.channel}`)} · ${when}` : t(`staff.marketing.channels.${c.channel}`)}
        </Text>
        {c.suggested_by_me ? (
          <Text style={{ ...small, fontFamily: fonts.body700, color: colors.gtext }}>
            {t('staff.marketing.results.yours')}
          </Text>
        ) : null}
        {c.sends > 0 ? (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {count('staff.marketing.results.sends', c.sends)}
            {count('staff.marketing.results.delivered', c.delivered)}
            {count('staff.marketing.results.failed', c.failed)}
          </View>
        ) : (
          <Text style={small}>{t('staff.marketing.results.notSent')}</Text>
        )}
        {c.attributable && c.redemptions !== null ? (
          <View style={{ flexDirection: 'row' }}>{count('staff.marketing.results.redemptions', c.redemptions)}</View>
        ) : (
          <Text style={small}>{t('staff.marketing.results.noPromotion')}</Text>
        )}
        {c.last_sent_at ? (
          <Text style={small}>
            {t('staff.marketing.results.lastSent', { when: formatDateTime(new Date(c.last_sent_at), locale) })}
          </Text>
        ) : null}
      </Card>
    );
  };

  const resultsTab = (
    <>
      <Lead>{t('staff.marketing.results.lead')}</Lead>
      {results.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={120} />
      ) : results.isError ? (
        loadError('staff-marketing.results-error', results)
      ) : (results.data?.campaigns ?? []).length === 0 ? (
        <Hint>{t('staff.marketing.results.empty')}</Hint>
      ) : (
        (results.data?.campaigns ?? []).map(resultCard)
      )}
    </>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.marketing.title') }} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <MenuRow
            testID="staff-marketing.requests"
            icon={<EnvelopeIcon size={15} color={colors.gstrong} />}
            label={
              openCount > 0
                ? t('staff.marketing.requestsRowOpen', { count: openCount })
                : t('staff.marketing.requestsRow')
            }
            onPress={() => router.push('/staff-marketing-requests')}
            last
          />
        </Card>
        <SegmentedControl<MarketingTab>
          testID="staff-marketing.tab"
          options={MARKETING_TABS.map((k) => ({ value: k, label: t(`staff.marketing.tabs.${k}`) }))}
          value={tab}
          onChange={setTab}
        />
        {tab === 'take' ? takeTab : tab === 'drafts' ? draftsTab : resultsTab}
      </ScrollView>
    </Screen>
  );
}

export default function StaffMarketingRoute() {
  return (
    <RequireStaff roles={['marketing']}>
      <MarketingScreen />
    </RequireStaff>
  );
}
