import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localIsoDate, parseTypedDate, type StaffRole } from '@touch/core';
import { formatDate, formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
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
import { ChevronIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { staffPhotoUrl } from '../src/features/staff/photo';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import {
  GroupLabel,
  Lead,
  MULTILINE_BOX,
  MULTILINE_TEXT,
  StaffPhotoThumb,
  Tag,
} from '../src/features/staff/checklists/parts';
import { ListCard } from '../src/features/staff/protocols/parts';
import { Chip } from '../src/features/staff/protocols/FormFields';
import { StoredPhotos } from '../src/features/staff/supplies/StoredPhotos';
import { intentFor } from '../src/features/staff/supplies/logic';
import { PickList, type PickOption } from '../src/features/staff/marketing/PickList';
import { fetchCampaignResults, fetchMenuItemOptions } from '../src/features/staff/marketing/api';
import { localName } from '../src/features/staff/marketing/logic';
import {
  decideContent,
  fetchContentDetail,
  fetchContentPage,
  reviseContent,
  submitContent,
  withdrawContent,
  type ContentDecision,
  type ContentDetail,
  type ContentFilter,
  type ContentItem,
  type ContentRow,
  type ContentVersion,
} from '../src/features/staff/content/api';
import {
  CONTENT_CAPS,
  CONTENT_CHANNELS,
  CONTENT_FILTERS,
  CONTENT_LINK_KINDS,
  CONTENT_ROLES,
  CONTENT_TONE,
  canSendAgain,
  contentAccess,
  contentArgs,
  currentVersion,
  draftFromDetail,
  emptyContentDraft,
  initialFilter,
  reviseArgs,
  sendAgainDraft,
  validateContent,
  validateDecision,
  type ContentDraft,
  type ContentField,
  type ContentIssue,
  type ContentLinkKind,
} from '../src/features/staff/content/logic';

/**
 * Content for approval (wave5-addendum-2026-09-25 §2.7, §5.3; migration 0199).
 *
 *   marketing   sends a post (a title, where it goes, a planned day, the
 *               caption, up to ten images in `campaigns`, an optional https://
 *               link and note), follows the venue's queue, sends a new version
 *               while it waits or changes were asked, withdraws, and sends a
 *               closed item again as a new one
 *   owner       reads the queue and every version, and approves, asks for
 *               changes or declines, the last two with a reason
 *
 * A manager never reaches this page (§8 Q14: RequireStaff and the RPCs both
 * keep them out). Without `?id=` it is the queue (and marketing's form); with
 * it, one item and every round of it. Approved is final (§8 Q16).
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function invalidateContent(
  queryClient: ReturnType<typeof useQueryClient>,
  venue: string,
  id?: string,
) {
  for (const f of CONTENT_FILTERS)
    void queryClient.invalidateQueries({ queryKey: staffKeys.content(venue, f) });
  if (id) void queryClient.invalidateQueries({ queryKey: staffKeys.contentDetail(id) });
}

// ── The form: a new item, the next version of one, or a closed one sent again ─

type FormMode = 'new' | 'revise' | 'again';

const SEND_ID: Record<FormMode, string> = {
  new: 'staff-content.submit',
  revise: 'staff-content.revise.send',
  again: 'staff-content.again.send',
};

function ContentForm({
  mode,
  initial,
  initialPhotos,
  base,
  onDone,
  onCancel,
}: {
  mode: FormMode;
  initial: ContentDraft;
  initialPhotos: AttachedPhoto[];
  /** The item a revision is of. */
  base?: ContentItem;
  onDone: (id: string) => void;
  onCancel?: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const today = localIsoDate(new Date());

  const [draft, setDraft] = useState<ContentDraft>(initial);
  const [photos, setPhotos] = useState<AttachedPhoto[]>(initialPhotos);
  const [issues, setIssues] = useState<ContentIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const linking = mode !== 'revise';
  const items = useQuery({
    queryKey: staffKeys.menuItems(venue),
    queryFn: () => fetchMenuItemOptions(venue),
    enabled: venue !== '' && linking && draft.linkKind === 'item',
  });
  const campaigns = useQuery({
    queryKey: staffKeys.campaignResults(venue),
    queryFn: () => fetchCampaignResults(venue),
    enabled: venue !== '' && linking && draft.linkKind === 'campaign',
  });
  const linkOptions: PickOption[] = useMemo(() => {
    if (draft.linkKind === 'item') {
      return (items.data ?? [])
        .map((i) => ({ id: i.id, label: localName(i.name_en, i.name_ar, locale) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale));
    }
    return (campaigns.data?.campaigns ?? []).map((c) => ({
      id: c.campaign_id,
      label: localName(c.name_en, c.name_ar, locale),
    }));
  }, [draft.linkKind, items.data, campaigns.data, locale]);

  const edit = (patch: Partial<ContentDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues((all) =>
      all.filter(
        (i) =>
          !(i.field in patch) &&
          !(i.field === 'linkId' && ('linkKind' in patch || 'linkId' in patch)),
      ),
    );
  };

  const send = useMutation({
    mutationKey: staffKeys.mutation(mode === 'revise' ? 'content.revise' : 'content'),
    mutationFn: async (current: ContentDraft): Promise<{ id: string; intent: string }> => {
      if (mode === 'revise' && base) {
        const args = reviseArgs(current, base);
        const intent = intentFor('content.revise', args);
        const result = await reviseContent(args, staffIntentKey(intent, 'content'));
        return { id: result.id, intent };
      }
      const args = contentArgs(current, venue);
      const intent = intentFor('content.submit', args);
      const result = await submitContent(args, staffIntentKey(intent, 'content'));
      return { id: result.id, intent };
    },
    onSuccess: ({ id, intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.content.form.sent'), 'success');
      invalidateContent(queryClient, venue, base?.id);
      onDone(id);
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSend = () => {
    setError(null);
    const current = { ...draft, images: photos.map((p) => p.path) };
    const found = validateContent(current, today, mode === 'revise' ? base : undefined);
    setIssues(found);
    if (found.length > 0 || !venue) return;
    send.mutate(current);
  };

  const fieldError = (field: Exclude<ContentField, 'images'>): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    const keys: Record<Exclude<ContentField, 'images'>, MessageKey> = {
      title:
        issue.code === 'tooLong'
          ? 'staff.content.form.errors.titleTooLong'
          : 'staff.content.form.errors.title',
      channel: 'staff.content.form.errors.channel',
      plannedFor:
        issue.code === 'past'
          ? 'staff.content.form.errors.past'
          : 'staff.content.form.errors.planned',
      body:
        issue.code === 'tooLong'
          ? 'staff.content.form.errors.bodyTooLong'
          : 'staff.content.form.errors.body',
      link: 'staff.content.form.errors.link',
      note: 'staff.content.form.errors.noteTooLong',
      linkId: 'staff.content.form.errors.about',
    };
    return t(keys[field], { example: isolate(today) });
  };

  const planned = parseTypedDate(draft.plannedFor);
  const nextVersion = (base?.current_version ?? 0) + 1;
  const heading =
    mode === 'revise'
      ? t('staff.content.form.reviseTitle', { version: nextVersion })
      : mode === 'again'
        ? t('staff.content.form.againTitle')
        : t('staff.content.form.newTitle');

  return (
    <Card style={{ padding: space.m, gap: space.s }}>
      <Text
        accessibilityRole="header"
        style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: colors.ink }}
      >
        {heading}
      </Text>
      <Field
        testID="staff-content.title"
        label={t('staff.content.form.title')}
        value={draft.title}
        onChangeText={(title) => edit({ title })}
        maxLength={CONTENT_CAPS.title}
        error={fieldError('title')}
      />
      <GroupLabel>{t('staff.content.form.channel')}</GroupLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {CONTENT_CHANNELS.map((channel) => (
          <Chip
            key={channel}
            testID={`staff-content.channel.${channel}`}
            label={t(`work.content.channel.${channel}`)}
            selected={draft.channel === channel}
            onPress={() => edit({ channel })}
          />
        ))}
      </View>
      <ErrorText>{fieldError('channel')}</ErrorText>
      <Field
        testID="staff-content.planned"
        label={t('staff.content.form.planned')}
        value={draft.plannedFor}
        onChangeText={(plannedFor) => edit({ plannedFor })}
        keyboardType="numbers-and-punctuation"
        latin
        error={fieldError('plannedFor')}
      />
      <Hint style={{ marginTop: 0 }}>
        {planned
          ? dayLabel(planned, locale)
          : t('staff.content.form.plannedHint', { example: isolate(today) })}
      </Hint>
      <Field
        testID="staff-content.body"
        label={t('staff.content.form.body')}
        value={draft.body}
        onChangeText={(body) => edit({ body })}
        multiline
        boxStyle={MULTILINE_BOX}
        style={MULTILINE_TEXT}
        maxLength={CONTENT_CAPS.body}
        error={fieldError('body')}
      />
      <GroupLabel>{t('staff.content.form.images')}</GroupLabel>
      <PhotoButton
        testID="staff-content.photo"
        venueId={venue}
        folder="campaigns"
        photos={photos}
        onChange={setPhotos}
        max={CONTENT_CAPS.images}
        disabled={send.isPending || venue === ''}
      />
      <Hint style={{ marginTop: 0 }}>{t('staff.content.form.consentHint')}</Hint>
      {mode === 'again' ? (
        <Hint style={{ marginTop: 0 }}>{t('staff.content.form.againImages')}</Hint>
      ) : null}
      <Field
        testID="staff-content.link"
        label={t('staff.content.form.link')}
        value={draft.link}
        onChangeText={(link) => edit({ link })}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        latin
        maxLength={CONTENT_CAPS.link}
        error={fieldError('link')}
      />
      <Hint style={{ marginTop: 0 }}>{t('staff.content.form.linkHint')}</Hint>
      <Field
        testID="staff-content.note"
        label={t('staff.content.form.note')}
        value={draft.note}
        onChangeText={(note) => edit({ note })}
        multiline
        boxStyle={MULTILINE_BOX}
        style={MULTILINE_TEXT}
        maxLength={CONTENT_CAPS.note}
        error={fieldError('note')}
      />
      {linking ? (
        <>
          <GroupLabel>{t('staff.content.form.about')}</GroupLabel>
          <SegmentedControl<ContentLinkKind>
            testID="staff-content.about"
            options={CONTENT_LINK_KINDS.map((k) => ({
              value: k,
              label: t(`staff.content.form.abouts.${k}`),
            }))}
            value={draft.linkKind}
            onChange={(linkKind) => edit({ linkKind, linkId: null })}
          />
          {draft.linkKind !== 'none' ? (
            <PickList
              testID="staff-content.about-pick"
              options={linkOptions}
              loading={draft.linkKind === 'item' ? items.isPending : campaigns.isPending}
              value={draft.linkId}
              onChange={(linkId) => edit({ linkId })}
              error={fieldError('linkId')}
            />
          ) : null}
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={SEND_ID[mode]}
          label={
            mode === 'revise'
              ? t('staff.content.form.sendVersion', { version: nextVersion })
              : t('staff.content.form.submit')
          }
          variant="primary"
          size={onCancel ? 'compact' : 'regular'}
          busy={send.isPending}
          disabled={venue === ''}
          onPress={onSend}
          style={{ flex: 1 }}
        />
        {onCancel ? (
          <Button
            testID="staff-content.form.cancel"
            label={t('staff.content.form.cancel')}
            variant="secondary"
            size="compact"
            disabled={send.isPending}
            onPress={onCancel}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>
    </Card>
  );
}

// ── The queue ─────────────────────────────────────────────────────────────────

function ContentList({ role }: { role: StaffRole }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const access = contentAccess(role);

  const [filter, setFilter] = useState<ContentFilter>(() => initialFilter(access));
  // A fresh form after each send, so its photos and fields start empty.
  const [formKey, setFormKey] = useState(0);

  const page = useQuery({
    queryKey: staffKeys.content(venue, filter),
    queryFn: () => fetchContentPage(venue, filter),
    enabled: venue !== '',
  });
  // Marketing's "waiting on you": what the owner sent back, above the form,
  // so a post to fix is never below a screen of fields.
  const onYou = useQuery({
    queryKey: staffKeys.content(venue, 'changes'),
    queryFn: () => fetchContentPage(venue, 'changes'),
    enabled: venue !== '' && access.sends,
  });
  const pull = usePullRefresh(() =>
    Promise.all([page.refetch(), access.sends ? onYou.refetch() : null]),
  );

  const rows = page.data?.content ?? [];
  const toFix = access.sends ? (onYou.data?.content ?? []) : [];
  const small = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut };

  /** One item in a list; it opens the item with every version. */
  const itemRow = (r: ContentRow, last: boolean, testID: string) => (
    <Pressable
      key={r.id}
      testID={testID}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/staff-content', params: { id: r.id } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.m,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
        backgroundColor: pressed ? colors.sub : 'transparent',
      })}
    >
      {r.cover_image ? (
        <StaffPhotoThumb path={r.cover_image} size={52} label={t('staff.media.photo', { n: 1 })} />
      ) : null}
      <View style={{ flex: 1, gap: 3 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: space.s,
          }}
        >
          <Text
            numberOfLines={2}
            style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}
          >
            {r.title}
          </Text>
          <Tag tone={CONTENT_TONE[r.status]} label={t(`work.content.status.${r.status}`)} />
        </View>
        <Text style={small}>
          {t('staff.content.queue.meta', {
            channel: t(`work.content.channel.${r.channel}`),
            day: dayLabel(r.planned_for, locale),
          })}
        </Text>
        {r.current_version > 1 || (access.decides && r.author_name) ? (
          <Text style={small}>
            {[
              r.current_version > 1
                ? t('staff.content.queue.version', { version: r.current_version })
                : null,
              access.decides && r.author_name
                ? t('staff.content.queue.by', { name: isolate(r.author_name) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );

  return (
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
      <Lead>{t(access.sends ? 'staff.content.lead' : 'staff.content.ownerLead')}</Lead>
      {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
      {toFix.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <MicroLabel style={{ paddingStart: 4 }}>
            {t('staff.content.queue.onYou', { count: toFix.length })}
          </MicroLabel>
          <ListCard>
            {toFix.map((r, i) =>
              itemRow(r, i === toFix.length - 1, `staff-content.on-you.${r.id}`),
            )}
          </ListCard>
        </View>
      ) : null}
      {access.sends ? (
        <ContentForm
          key={formKey}
          mode="new"
          initial={emptyContentDraft()}
          initialPhotos={[]}
          onDone={() => setFormKey((k) => k + 1)}
        />
      ) : null}

      {access.sends ? (
        <MicroLabel style={{ paddingStart: 4, marginTop: space.m }}>
          {t('staff.content.queue.title')}
        </MicroLabel>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {CONTENT_FILTERS.map((f) => (
          <Chip
            key={f}
            testID={`staff-content.filter.${f}`}
            label={t(`staff.content.queue.filters.${f}`)}
            selected={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>
      {page.isPending && venue !== '' ? (
        <SkeletonList rows={3} height={76} />
      ) : page.isError ? (
        <ErrorState
          testID="staff-content.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(page.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void page.refetch()}
        />
      ) : rows.length === 0 ? (
        <Hint>
          {t(
            access.decides && filter === 'waiting'
              ? 'staff.content.queue.emptyWaiting'
              : 'staff.content.queue.empty',
          )}
        </Hint>
      ) : (
        <ListCard>
          {rows.map((r, i) => itemRow(r, i === rows.length - 1, `staff-content.item.${r.id}`))}
        </ListCard>
      )}
    </ScrollView>
  );
}

// ── One item ──────────────────────────────────────────────────────────────────

type Choice = ContentDecision | null;

function ContentItemView({ id, role }: { id: string; role: StaffRole }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const access = contentAccess(role);
  const today = localIsoDate(new Date());

  const detail = useQuery({
    queryKey: staffKeys.contentDetail(id),
    queryFn: () => fetchContentDetail(id),
  });
  const pull = usePullRefresh(() => detail.refetch());

  // Marketing's forms: the next version, or a closed item sent again.
  const [form, setForm] = useState<{
    mode: 'revise' | 'again';
    draft: ContentDraft;
    photos: AttachedPhoto[];
  } | null>(null);

  const openRevise = async (d: ContentDetail) => {
    const draft = draftFromDetail(d);
    // An image already sent shows through its signed URL; one that cannot be
    // read still keeps its path, so the new version never drops it.
    const photos = await Promise.all(
      draft.images.map(async (path) => {
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
    setForm({ mode: 'revise', draft, photos });
  };

  // ── Withdraw ─────────────────────────────────────────────────────────────
  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('content.withdraw'),
    mutationFn: () => withdrawContent(id),
    onSuccess: () => {
      toast(t('staff.content.item.withdrawn'), 'info');
      invalidateContent(queryClient, venue, id);
    },
    onError: (err) => {
      toast(t(mapStaffError(err)), 'error');
      invalidateContent(queryClient, venue, id);
    },
  });
  const confirmWithdraw = () =>
    Alert.alert(t('staff.content.item.withdrawTitle'), t('staff.content.item.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.content.item.withdraw'),
        style: 'destructive',
        onPress: () => withdraw.mutate(),
      },
    ]);

  // ── Decide (the owner) ───────────────────────────────────────────────────
  const [choice, setChoice] = useState<Choice>(null);
  const [note, setNote] = useState('');
  const [decideError, setDecideError] = useState<string | null>(null);

  const decide = useMutation({
    mutationKey: staffKeys.mutation('content.decide'),
    mutationFn: (v: { version: number; decision: ContentDecision; note: string | null }) =>
      decideContent(id, v.version, v.decision, v.note),
    onSuccess: (_result, v) => {
      const done: Record<ContentDecision, MessageKey> = {
        approve: 'staff.content.decide.approved',
        changes: 'staff.content.decide.changes',
        decline: 'staff.content.decide.declined',
      };
      toast(t(done[v.decision]), 'success');
      setChoice(null);
      setNote('');
      invalidateContent(queryClient, venue, id);
    },
    onError: (err) => {
      setDecideError(t(mapStaffError(err)));
      invalidateContent(queryClient, venue, id);
    },
  });

  const onDecide = (version: number) => {
    if (!choice) return;
    const problem = validateDecision(choice, note);
    if (problem) {
      setDecideError(
        t(
          problem === 'tooLong'
            ? 'staff.content.decide.errors.tooLong'
            : 'staff.content.decide.errors.reason',
        ),
      );
      return;
    }
    setDecideError(null);
    decide.mutate({ version, decision: choice, note: note.trim() || null });
  };

  const d = detail.data;
  // The version the item is on leads the page; the rest follow, newest first.
  const current = d ? currentVersion(d) : null;
  const earlier = d ? d.versions.filter((v) => v !== current) : [];
  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const small = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut };

  const versionTag = (v: ContentVersion, current: boolean) => {
    if (v.decision === 'approve')
      return <Tag tone="good" label={t('work.content.status.approved')} />;
    if (v.decision === 'changes')
      return <Tag tone="info" label={t('work.content.status.changes')} />;
    if (v.decision === 'decline')
      return <Tag tone="bad" label={t('work.content.status.declined')} />;
    if (v.superseded_at) return <Tag tone="plain" label={t('staff.content.item.superseded')} />;
    return current ? <Tag tone="warn" label={t('staff.content.item.current')} /> : null;
  };

  /** What one version says: who sent it, the caption, images, link, note, and its decision. */
  const versionDetails = (
    v: ContentVersion,
    imageSize: number,
    opts: { decision: boolean } = { decision: true },
  ) => (
    <>
      <Text style={small}>
        {t('staff.content.item.sentBy', {
          name: isolate(v.submitted_by_name ?? ''),
          when: formatDateTime(new Date(v.submitted_at), locale),
        })}
      </Text>
      <Text style={{ ...body, color: colors.ink }}>{v.body}</Text>
      <StoredPhotos paths={v.images} size={imageSize} />
      {v.media_link ? (
        <View style={{ gap: 2 }}>
          <MicroLabel>{t('staff.content.item.link')}</MicroLabel>
          {/* Text, never opened from here (§8 Q15): press and hold copies it. */}
          <Text
            selectable
            style={{
              fontFamily: fonts.body600,
              fontSize: 13,
              color: colors.blue,
              writingDirection: 'ltr',
            }}
          >
            {v.media_link}
          </Text>
          <Text style={small}>{t('staff.content.item.linkHint')}</Text>
        </View>
      ) : null}
      {v.note ? (
        <Text style={body}>{t('staff.content.item.note', { note: isolate(v.note) })}</Text>
      ) : null}
      {opts.decision && v.decision ? (
        <Text style={{ ...body, color: colors.ink }}>
          {v.decision_note
            ? t('staff.content.item.decidedNote', {
                decided: t(`staff.content.item.decided.${v.decision}`, {
                  name: isolate(v.decided_by_name ?? ''),
                }),
                note: isolate(v.decision_note),
              })
            : t(`staff.content.item.decided.${v.decision}`, {
                name: isolate(v.decided_by_name ?? ''),
              })}
        </Text>
      ) : null}
    </>
  );

  const decisionPanel = (version: number) => {
    const pick = (next: ContentDecision) => {
      setChoice((c) => (c === next ? null : next));
      setDecideError(null);
    };
    const hint: Record<ContentDecision, MessageKey> = {
      approve: 'staff.content.decide.approveHint',
      changes: 'staff.content.decide.changesHint',
      decline: 'staff.content.decide.declineHint',
    };
    return (
      <Card style={{ padding: space.m, gap: space.s }}>
        <Text
          accessibilityRole="header"
          style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: colors.ink }}
        >
          {t('staff.content.decide.title')}
        </Text>
        <Button
          testID="staff-content.decide.approve"
          label={t('work.content.decision.approve')}
          variant={choice === 'approve' ? 'primary' : 'secondary'}
          size="compact"
          disabled={decide.isPending}
          onPress={() => pick('approve')}
        />
        <Button
          testID="staff-content.decide.changes"
          label={t('work.content.decision.changes')}
          variant={choice === 'changes' ? 'primary' : 'secondary'}
          size="compact"
          disabled={decide.isPending}
          onPress={() => pick('changes')}
        />
        <Button
          testID="staff-content.decide.decline"
          label={t('work.content.decision.decline')}
          variant={choice === 'decline' ? 'danger' : 'dangerOutline'}
          size="compact"
          disabled={decide.isPending}
          onPress={() => pick('decline')}
        />
        {choice ? (
          <View
            style={{
              gap: space.s,
              marginTop: space.xs,
              padding: space.sm,
              borderRadius: radius.cell,
              borderWidth: 1,
              borderColor: choice === 'decline' ? colors.redline : colors.line,
              backgroundColor: colors.bg,
            }}
          >
            <Text style={body}>{t(hint[choice])}</Text>
            <Field
              testID="staff-content.decide.note"
              label={t(
                choice === 'approve' ? 'staff.content.decide.note' : 'staff.content.decide.reason',
              )}
              value={note}
              onChangeText={(text) => {
                setNote(text);
                setDecideError(null);
              }}
              multiline
              boxStyle={MULTILINE_BOX}
              style={MULTILINE_TEXT}
              maxLength={CONTENT_CAPS.decisionNote}
              error={decideError}
            />
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                testID="staff-content.decide.confirm"
                // The confirm names what it does, and a decline confirms in red.
                label={
                  choice === 'approve'
                    ? t('staff.content.decide.confirmApprove', { version })
                    : choice === 'changes'
                      ? t('staff.content.decide.confirmChanges')
                      : t('staff.content.decide.confirmDecline')
                }
                variant={choice === 'decline' ? 'danger' : 'primary'}
                size="compact"
                busy={decide.isPending}
                onPress={() => onDecide(version)}
                style={{ flex: 1 }}
              />
              <Button
                testID="staff-content.decide.cancel"
                label={t('staff.content.decide.cancel')}
                variant="secondary"
                size="compact"
                disabled={decide.isPending}
                onPress={() => {
                  setChoice(null);
                  setNote('');
                  setDecideError(null);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <>
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
        {detail.isPending ? (
          <SkeletonList rows={3} height={96} />
        ) : detail.isError || !d ? (
          <ErrorState
            testID="staff-content.item-error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(detail.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <>
            {/* The item: what it is, where it goes, when, and where it stands. */}
            <View style={{ gap: 4 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: space.s,
                }}
              >
                <Text
                  accessibilityRole="header"
                  style={{
                    flexShrink: 1,
                    fontFamily: fonts.display800,
                    fontSize: 20,
                    lineHeight: 26,
                    color: colors.ink,
                  }}
                >
                  {d.content.title}
                </Text>
                <Tag
                  tone={CONTENT_TONE[d.content.status]}
                  label={t(`work.content.status.${d.content.status}`)}
                />
              </View>
              <Text style={small}>
                {t('staff.content.queue.meta', {
                  channel: t(`work.content.channel.${d.content.channel}`),
                  day: t('staff.content.item.planned', {
                    day: dayLabel(d.content.planned_for, locale),
                  }),
                })}
              </Text>
              {d.content.menu_item_id || d.content.campaign_id ? (
                <Text style={small}>
                  {t('staff.content.item.about', {
                    name: isolate(
                      d.content.menu_item_id
                        ? localName(d.content.item_name_en, d.content.item_name_ar, locale)
                        : localName(d.content.campaign_name_en, d.content.campaign_name_ar, locale),
                    ),
                  })}
                </Text>
              ) : null}
              {d.content.author_name ? (
                <Text style={small}>
                  {t('staff.content.item.by', { name: isolate(d.content.author_name) })}
                </Text>
              ) : null}
            </View>

            {/* Marketing, sent back: what the owner asked, before the post it is about. */}
            {access.sends && d.content.status === 'changes' ? (
              <View style={{ gap: 4 }}>
                <Text style={{ ...body, color: colors.ink, fontFamily: fonts.body600 }}>
                  {t('staff.content.item.changesAsked')}
                </Text>
                {current?.decision === 'changes' && current.decision_note ? (
                  <Text style={{ ...body, color: colors.ink }}>
                    {t('staff.content.item.ownerSaid', { note: isolate(current.decision_note) })}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* The post as it stands, before anything is decided about it. */}
            {current ? (
              <Card style={{ padding: space.m, gap: 6 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: space.s,
                  }}
                >
                  <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                    {t('staff.content.item.version', { version: current.version })}
                  </Text>
                  {versionTag(current, true)}
                </View>
                {versionDetails(current, 96, {
                  // Marketing reads the owner's reason in the line above.
                  decision: !(access.sends && d.content.status === 'changes'),
                })}
              </Card>
            ) : null}

            {access.decides && d.can_decide ? decisionPanel(d.content.current_version) : null}

            {access.sends && d.content.status === 'waiting' ? (
              <Hint>{t('staff.content.item.waitsOnOwner')}</Hint>
            ) : null}
            {access.sends && d.content.status === 'approved' ? (
              <Hint>{t('staff.content.item.finalApproved')}</Hint>
            ) : null}

            {access.sends && form ? (
              <ContentForm
                key={form.mode}
                mode={form.mode}
                initial={form.draft}
                initialPhotos={form.photos}
                base={form.mode === 'revise' ? d.content : undefined}
                onCancel={() => setForm(null)}
                onDone={(newId) => {
                  setForm(null);
                  if (newId !== id)
                    router.replace({ pathname: '/staff-content', params: { id: newId } });
                }}
              />
            ) : null}
            {access.sends &&
            !form &&
            (d.can_revise || d.can_withdraw || canSendAgain(d.content.status)) ? (
              <View style={{ gap: space.s }}>
                {d.can_revise ? (
                  <Button
                    testID="staff-content.revise"
                    label={t('staff.content.item.revise')}
                    variant="primary"
                    onPress={() => void openRevise(d)}
                  />
                ) : null}
                {canSendAgain(d.content.status) ? (
                  <Button
                    testID="staff-content.again"
                    label={t('staff.content.item.again')}
                    variant="secondary"
                    onPress={() =>
                      setForm({ mode: 'again', draft: sendAgainDraft(d, today), photos: [] })
                    }
                  />
                ) : null}
                {d.can_withdraw ? (
                  <Button
                    testID="staff-content.withdraw"
                    label={t('staff.content.item.withdraw')}
                    variant="ghost"
                    busy={withdraw.isPending}
                    onPress={confirmWithdraw}
                    style={{ alignSelf: 'flex-start' }}
                  />
                ) : null}
              </View>
            ) : null}

            {earlier.length > 0 ? (
              <>
                <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
                  {t('staff.content.item.versions')}
                </MicroLabel>
                <ListCard>
                  {earlier.map((v, i) => (
                    <View
                      key={v.version}
                      style={{
                        padding: space.m,
                        gap: 6,
                        borderBottomWidth: i === earlier.length - 1 ? 0 : 1,
                        borderBottomColor: colors.sub,
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
                          style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}
                        >
                          {t('staff.content.item.version', { version: v.version })}
                        </Text>
                        {versionTag(v, false)}
                      </View>
                      {versionDetails(v, 72)}
                    </View>
                  ))}
                </ListCard>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function ContentScreen() {
  const { t } = useLocale();
  const { status } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  if (status.kind !== 'staff') return null;
  const role = status.staff.role;
  // One title for the queue and an item: the item names itself in its own heading.
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.content.title') }} />
      {params.id ? <ContentItemView id={params.id} role={role} /> : <ContentList role={role} />}
    </Screen>
  );
}

export default function StaffContentRoute() {
  return (
    <RequireStaff roles={CONTENT_ROLES}>
      <ContentScreen />
    </RequireStaff>
  );
}
