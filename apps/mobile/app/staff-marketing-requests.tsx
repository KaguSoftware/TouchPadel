import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localIsoDate, parseTypedDate, type StaffRole } from '@touch/core';
import { formatDate, formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, LinkText, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { StoredPhotos } from '../src/features/staff/supplies/StoredPhotos';
import { GroupLabel, Lead, MULTILINE_BOX, MULTILINE_TEXT, Tag, type TagTone } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { intentFor } from '../src/features/staff/supplies/logic';
import { PickList, type PickOption } from '../src/features/staff/marketing/PickList';
import {
  addMarketingRequest,
  answerMarketingRequest,
  fetchMarketingRequestsPage,
  fetchMenuItemOptions,
  fetchMyMarketingRequests,
  withdrawMarketingRequest,
  type MarketingRequest,
  type RequestsFilter,
} from '../src/features/staff/marketing/api';
import {
  CAPS,
  REQUEST_FILTERS,
  canAnswer,
  canWithdraw,
  emptyRequestDraft,
  localName,
  namedFirst,
  requestArgs,
  requestsView,
  validateAnswer,
  validateRequest,
  type Issue,
  type RequestDraft,
  type RequestField,
} from '../src/features/staff/marketing/logic';

/**
 * Requests to marketing (build-contracts-2026-09-23 §6.1, §2.24.11; plan #73).
 *
 *   every role but marketing  asks (a title, the details, an optional day and
 *                             menu item, up to four photos), follows its own
 *                             and may withdraw an open one
 *   marketing                 the inbox: answers each open request, done or
 *                             declined, with an answer the asker reads
 *   manager, owner            ask as anyone does, and read every request
 *
 * "Approval" is parked (§0 P7): an answer makes nothing live. `?id=` is a
 * request a link named; it is listed first, and marketing's answer opens on it.
 */

/** A request's status as a tag, the same tag every staff list uses. */
const STATUS_TONE: Record<MarketingRequest['status'], TagTone> = {
  open: 'warn',
  done: 'good',
  declined: 'bad',
  withdrawn: 'plain',
};

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function RequestsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();

  const role: StaffRole = status.kind === 'staff' ? status.staff.role : 'cashier';
  const view = requestsView(role);
  const venue = venueId ?? '';
  const today = localIsoDate(new Date());

  const [filter, setFilter] = useState<RequestsFilter>('open');
  const [pickingItem, setPickingItem] = useState(false);

  const mine = useQuery({
    queryKey: staffKeys.myMarketingRequests(venue),
    queryFn: () => fetchMyMarketingRequests(venue),
    enabled: venue !== '' && view.asks,
  });
  const page = useQuery({
    queryKey: staffKeys.marketingRequests(venue, filter),
    queryFn: () => fetchMarketingRequestsPage(venue, filter),
    enabled: venue !== '' && view.readsAll,
  });
  const items = useQuery({
    queryKey: staffKeys.menuItems(venue),
    queryFn: () => fetchMenuItemOptions(venue),
    enabled: venue !== '' && view.asks && pickingItem,
  });
  const itemOptions: PickOption[] = useMemo(
    () =>
      (items.data ?? [])
        .map((i) => ({ id: i.id, label: localName(i.name_en, i.name_ar, locale) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [items.data, locale],
  );

  // A pull reads again the lists this role sees: its own, and the inbox.
  const pull = usePullRefresh(() =>
    Promise.all([view.asks ? mine.refetch() : null, view.readsAll ? page.refetch() : null]),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: staffKeys.myMarketingRequests(venue) });
    for (const f of REQUEST_FILTERS) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.marketingRequests(venue, f) });
    }
  };

  // ── Ask ────────────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<RequestDraft>(emptyRequestDraft);
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [issues, setIssues] = useState<Issue<RequestField>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<RequestDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const ask = useMutation({
    mutationKey: staffKeys.mutation('marketing_request'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof requestArgs>; intent: string }) =>
      addMarketingRequest(args, staffIntentKey(intent, 'marketing_request')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.marketing.requests.sent'), 'success');
      setDraft(emptyRequestDraft());
      setPhotos([]);
      setIssues([]);
      setPickingItem(false);
      refresh();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onAsk = () => {
    setError(null);
    const current = { ...draft, photos: photos.map((p) => p.path) };
    const found = validateRequest(current, today);
    setIssues(found);
    if (found.length > 0 || !venue) return;
    const args = requestArgs(current, venue);
    ask.mutate({ args, intent: intentFor('marketing_request', args) });
  };

  const fieldError = (field: Exclude<RequestField, 'photos'>): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    const keys: Record<typeof field, MessageKey> = {
      title: issue.code === 'tooLong' ? 'staff.marketing.requests.errors.titleTooLong' : 'staff.marketing.requests.errors.title',
      body: issue.code === 'tooLong' ? 'staff.marketing.requests.errors.bodyTooLong' : 'staff.marketing.requests.errors.body',
      wantBy: issue.code === 'past' ? 'staff.marketing.requests.errors.past' : 'staff.marketing.requests.errors.date',
    };
    return t(keys[field], { example: isolate(today) });
  };

  // ── Withdraw, answer ───────────────────────────────────────────────────────
  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('marketing_request.withdraw'),
    mutationFn: (id: string) => withdrawMarketingRequest(id),
    onSuccess: () => {
      toast(t('staff.marketing.requests.withdrawn'), 'info');
      refresh();
    },
    onError: (err) => {
      toast(t(mapStaffError(err)), 'error');
      refresh();
    },
  });

  const confirmWithdraw = (id: string) => {
    Alert.alert(t('staff.marketing.requests.withdraw'), t('staff.marketing.requests.withdrawConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staff.marketing.requests.withdraw'), style: 'destructive', onPress: () => withdraw.mutate(id) },
    ]);
  };

  // Marketing answers one request at a time; a named one opens first.
  const [answering, setAnswering] = useState<string | null>(view.answers ? (params.id ?? null) : null);
  const [answer, setAnswer] = useState('');
  const [answerError, setAnswerError] = useState<string | null>(null);

  const reply = useMutation({
    mutationKey: staffKeys.mutation('marketing_request.answer'),
    mutationFn: (v: { id: string; outcome: 'done' | 'declined'; answer: string }) =>
      answerMarketingRequest(v.id, v.outcome, v.answer),
    onSuccess: () => {
      toast(t('staff.marketing.requests.answered'), 'success');
      setAnswering(null);
      setAnswer('');
      refresh();
    },
    onError: (err) => {
      setAnswerError(t(mapStaffError(err)));
      refresh();
    },
  });

  const onAnswer = (id: string, outcome: 'done' | 'declined') => {
    const problem = validateAnswer(answer);
    if (problem) {
      setAnswerError(
        t(problem === 'tooLong' ? 'staff.marketing.requests.errors.answerTooLong' : 'staff.marketing.requests.errors.answer'),
      );
      return;
    }
    setAnswerError(null);
    reply.mutate({ id, outcome, answer: answer.trim() });
  };

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  const small = { fontFamily: fonts.body400, fontSize: 12, color: colors.mut };

  /** The request as both lists show it: title, status, details, its day and item, photos, the answer. */
  const requestBody = (r: MarketingRequest, from: string | null) => (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
        <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>{r.title}</Text>
        <Tag tone={STATUS_TONE[r.status]} label={t(`work.marketingRequest.status.${r.status}`)} />
      </View>
      {from ? <Text style={small}>{from}</Text> : null}
      <Text style={body}>{r.body}</Text>
      {r.want_by ? (
        <Text style={small}>{t('staff.marketing.requests.wantByDay', { day: dayLabel(r.want_by, locale) })}</Text>
      ) : null}
      {r.menu_item_id ? (
        <Text style={small}>
          {t('staff.marketing.requests.about', { item: isolate(localName(r.item_name_en, r.item_name_ar, locale)) })}
        </Text>
      ) : null}
      <StoredPhotos paths={r.photos} />
      <Text style={small}>{formatDateTime(new Date(r.created_at), locale)}</Text>
      {r.answer ? (
        <Text style={{ ...body, color: colors.ink }}>
          {t('staff.marketing.requests.answerBy', {
            name: isolate(r.answered_by_name ?? ''),
            answer: isolate(r.answer),
          })}
        </Text>
      ) : null}
    </>
  );

  const mineRows = namedFirst(mine.data?.requests ?? [], params.id);
  const pageRows = namedFirst(page.data?.requests ?? [], params.id);

  const loadError = (testID: string, query: { error: unknown; refetch: () => unknown }) => (
    <ErrorState
      testID={testID}
      title={t('errors.loadFailedTitle')}
      message={t(mapStaffError(query.error))}
      retryLabel={t('common.retry')}
      onRetry={() => void query.refetch()}
    />
  );

  const namedStyle = (id: string) => (id === params.id ? { borderColor: colors.blue, borderWidth: 1.5 } : null);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.marketing.requests.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t(view.answers ? 'staff.marketing.requests.inboxLead' : 'staff.marketing.requests.lead')}</Lead>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}

        {view.asks ? (
          <>
            <Card style={{ padding: space.m, gap: space.s }}>
              <MicroLabel>{t('staff.marketing.requests.newTitle')}</MicroLabel>
              <Field
                testID="staff-marketing-requests.title"
                label={t('staff.marketing.requests.titleField')}
                value={draft.title}
                onChangeText={(title) => edit({ title })}
                error={fieldError('title')}
              />
              <Field
                testID="staff-marketing-requests.body"
                label={t('staff.marketing.requests.body')}
                value={draft.body}
                onChangeText={(text) => edit({ body: text })}
                multiline
                boxStyle={MULTILINE_BOX}
                style={MULTILINE_TEXT}
                error={fieldError('body')}
              />
              <Field
                testID="staff-marketing-requests.want-by"
                label={t('staff.marketing.requests.wantBy')}
                value={draft.wantBy}
                onChangeText={(wantBy) => edit({ wantBy })}
                keyboardType="numbers-and-punctuation"
                latin
                error={fieldError('wantBy')}
              />
              {parseTypedDate(draft.wantBy) ? (
                <Hint style={{ marginTop: 0 }}>{dayLabel(parseTypedDate(draft.wantBy)!, locale)}</Hint>
              ) : (
                <Hint style={{ marginTop: 0 }}>{t('staff.marketing.dateHint', { example: isolate(today) })}</Hint>
              )}
              {pickingItem || draft.menuItemId ? (
                <View style={{ gap: space.xs }}>
                  <GroupLabel>{t('staff.marketing.requests.item')}</GroupLabel>
                  <PickList
                    testID="staff-marketing-requests.menu-item"
                    options={itemOptions}
                    loading={items.isPending}
                    value={draft.menuItemId}
                    onChange={(menuItemId) => edit({ menuItemId })}
                  />
                </View>
              ) : (
                <LinkText
                  testID="staff-marketing-requests.menu-item.open"
                  label={t('staff.marketing.requests.item')}
                  onPress={() => setPickingItem(true)}
                />
              )}
              <GroupLabel>{t('staff.marketing.requests.photos')}</GroupLabel>
              <PhotoButton
                testID="staff-marketing-requests.photo"
                venueId={venue}
                folder="requests"
                photos={photos}
                onChange={setPhotos}
                max={CAPS.requestPhotos}
                disabled={ask.isPending}
              />
              <ErrorText>{error}</ErrorText>
              <Button
                testID="staff-marketing-requests.submit"
                label={t('staff.marketing.requests.submit')}
                variant="primary"
                busy={ask.isPending}
                onPress={onAsk}
              />
            </Card>

            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.marketing.requests.mine')}</MicroLabel>
            {mine.isPending && venue !== '' ? (
              <SkeletonList rows={2} height={80} />
            ) : mine.isError ? (
              loadError('staff-marketing-requests.error', mine)
            ) : mineRows.length === 0 ? (
              <Hint>{t('staff.marketing.requests.empty')}</Hint>
            ) : (
              mineRows.map((r) => (
                <Card key={r.id} style={{ padding: space.m, gap: 4, ...namedStyle(r.id) }}>
                  <View testID={`staff-marketing-requests.item.${r.id}`} style={{ gap: 4 }}>
                    {requestBody(r, null)}
                  </View>
                  {canWithdraw(r) ? (
                    <Button
                      testID={`staff-marketing-requests.withdraw.${r.id}`}
                      label={t('staff.marketing.requests.withdraw')}
                      variant="ghost"
                      busy={withdraw.isPending && withdraw.variables === r.id}
                      onPress={() => confirmWithdraw(r.id)}
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    />
                  ) : null}
                </Card>
              ))
            )}
          </>
        ) : null}

        {view.readsAll ? (
          <>
            {/* Marketing's inbox is this whole page, so it takes no heading that
                restates the title; the manager's read of everyone's sits under
                their own requests and is named. */}
            {view.answers ? null : (
              <MicroLabel style={{ paddingStart: 4, marginTop: view.asks ? space.s : 0 }}>
                {t('staff.marketing.requests.everyone')}
              </MicroLabel>
            )}
            <SegmentedControl<RequestsFilter>
              testID="staff-marketing-requests.filter"
              options={REQUEST_FILTERS.map((f) => ({ value: f, label: t(`staff.marketing.requests.filters.${f}`) }))}
              value={filter}
              onChange={setFilter}
            />
            {page.isPending && venue !== '' ? (
              <SkeletonList rows={2} height={96} />
            ) : page.isError ? (
              loadError('staff-marketing-requests.inbox-error', page)
            ) : pageRows.length === 0 ? (
              <Hint>{t('staff.marketing.requests.inboxEmpty')}</Hint>
            ) : (
              pageRows.map((r) => {
                // A request whose asker has no role on record reads as the name
                // alone, not "Yusuf · ".
                const from = r.requested_by_role
                  ? t('staff.marketing.requests.from', {
                      name: isolate(r.requested_by_name ?? ''),
                      role: t(`op.roles.${r.requested_by_role as StaffRole}`),
                    })
                  : isolate(r.requested_by_name ?? '');
                const open = answering === r.id && canAnswer(view, r);
                return (
                  <Card key={r.id} style={{ padding: space.m, gap: 4, ...namedStyle(r.id) }}>
                    {canAnswer(view, r) ? (
                      <Pressable
                        testID={`staff-marketing-requests.item.${r.id}`}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        onPress={() => {
                          setAnswering(open ? null : r.id);
                          setAnswer('');
                          setAnswerError(null);
                        }}
                        style={({ pressed }) => ({ gap: 4, opacity: pressed ? 0.8 : 1 })}
                      >
                        {requestBody(r, from)}
                        {!open ? (
                          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue, marginTop: 4 }}>
                            {t('staff.marketing.requests.reply')}
                          </Text>
                        ) : null}
                      </Pressable>
                    ) : (
                      <View testID={`staff-marketing-requests.item.${r.id}`} style={{ gap: 4 }}>
                        {requestBody(r, from)}
                      </View>
                    )}
                    {open ? (
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
                          testID="staff-marketing-requests.answer"
                          label={t('staff.marketing.requests.answerTitle')}
                          value={answer}
                          onChangeText={(text) => {
                            setAnswer(text);
                            setAnswerError(null);
                          }}
                          multiline
                          boxStyle={MULTILINE_BOX}
                          style={MULTILINE_TEXT}
                          error={answerError}
                        />
                        <Hint style={{ marginTop: 0 }}>{t('staff.marketing.requests.answerHint')}</Hint>
                        <View style={{ flexDirection: 'row', gap: space.s }}>
                          <Button
                            testID="staff-marketing-requests.answer.done"
                            label={t('staff.marketing.requests.done')}
                            variant="primary"
                            size="compact"
                            busy={reply.isPending && reply.variables?.outcome === 'done'}
                            disabled={reply.isPending}
                            onPress={() => onAnswer(r.id, 'done')}
                            style={{ flex: 1 }}
                          />
                          <Button
                            testID="staff-marketing-requests.answer.declined"
                            label={t('staff.marketing.requests.decline')}
                            variant="dangerOutline"
                            size="compact"
                            busy={reply.isPending && reply.variables?.outcome === 'declined'}
                            disabled={reply.isPending}
                            onPress={() => onAnswer(r.id, 'declined')}
                            style={{ flex: 1 }}
                          />
                        </View>
                      </View>
                    ) : null}
                  </Card>
                );
              })
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffMarketingRequestsRoute() {
  return (
    <RequireStaff>
      <RequestsScreen />
    </RequireStaff>
  );
}
