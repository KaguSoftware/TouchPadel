import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { localIsoDate, parseTypedDate } from '@touch/core';
import { formatDate, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space } from '../../src/theme';
import { Button, Card, Field, Hint, LinkText, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { DetailsFold } from '../../src/components/DetailsFold';
import { useToast } from '../../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../../src/components/PhotoButton';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import { useBackToItem } from '../../src/navigation/back';
import {
  GroupLabel,
  MULTILINE_BOX,
  MULTILINE_TEXT,
} from '../../src/features/staff/checklists/parts';
import { intentFor } from '../../src/features/staff/supplies/logic';
import { PickList, type PickOption } from '../../src/features/staff/marketing/PickList';
import { addMarketingRequest, fetchMenuItemOptions } from '../../src/features/staff/marketing/api';
import {
  CAPS,
  REQUEST_FILTERS,
  emptyRequestDraft,
  localName,
  requestArgs,
  MARKETING_REQUEST_ROLES,
  requestsView,
  validateRequest,
  type Issue,
  type RequestDraft,
  type RequestField,
} from '../../src/features/staff/marketing/logic';

/**
 * Ask marketing (build-contracts-2026-09-23 §6.1, §2.24.11; plan #73): a
 * title, the details, an optional day and menu item, up to four photos.
 * Opened by the + in the requests page's top bar, shown only to a role that
 * asks (marketing answers and never asks itself); a sent request goes back to
 * that page, which lists it.
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function AskMarketingScreen() {
  const { t, locale } = useLocale();
  const toast = useToast();
  // Back to the list, the new request first and marked.
  const showInList = useBackToItem('/staff-marketing-requests');
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();

  const role = status.kind === 'staff' ? status.staff.role : 'cashier';
  const view = requestsView(role);
  const venue = venueId ?? '';
  const today = localIsoDate(new Date());

  const [pickingItem, setPickingItem] = useState(false);
  const [draft, setDraft] = useState<RequestDraft>(emptyRequestDraft);
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [issues, setIssues] = useState<Issue<RequestField>[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const edit = (patch: Partial<RequestDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const ask = useMutation({
    mutationKey: staffKeys.mutation('marketing_request'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof requestArgs>; intent: string }) =>
      addMarketingRequest(args, staffIntentKey(intent, 'marketing_request')),
    onSuccess: (data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.marketing.requests.sent'), 'success');
      void queryClient.invalidateQueries({ queryKey: staffKeys.myMarketingRequests(venue) });
      for (const f of REQUEST_FILTERS) {
        void queryClient.invalidateQueries({ queryKey: staffKeys.marketingRequests(venue, f) });
      }
      showInList(data.id);
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
      title:
        issue.code === 'tooLong'
          ? 'staff.marketing.requests.errors.titleTooLong'
          : 'staff.marketing.requests.errors.title',
      body:
        issue.code === 'tooLong'
          ? 'staff.marketing.requests.errors.bodyTooLong'
          : 'staff.marketing.requests.errors.body',
      wantBy:
        issue.code === 'past'
          ? 'staff.marketing.requests.errors.past'
          : 'staff.marketing.requests.errors.date',
    };
    return t(keys[field], { example: isolate(today) });
  };

  // Marketing reaches this page only by a typed link; it answers, never asks.
  if (status.kind !== 'staff' || !view.asks) return null;

  const wantByDay = parseTypedDate(draft.wantBy);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.marketing.requests.newTitle') }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        error={error}
        bar={
          <Button
            testID="staff-marketing-request-new.submit"
            label={t('staff.marketing.requests.submit')}
            variant="primary"
            busy={ask.isPending}
            onPress={onAsk}
          />
        }
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        <Card style={{ padding: space.m, gap: space.s }}>
          <Field
            testID="staff-marketing-request-new.title"
            label={t('staff.marketing.requests.titleField')}
            value={draft.title}
            onChangeText={(title) => edit({ title })}
            error={fieldError('title')}
          />
          <Field
            testID="staff-marketing-request-new.body"
            label={t('staff.marketing.requests.body')}
            value={draft.body}
            onChangeText={(text) => edit({ body: text })}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            error={fieldError('body')}
          />
          {/* A title and what is needed are enough to ask; the date, the item
              and photos wait under Add details (Sait, 2026-10-17). */}
          <DetailsFold
            testID="staff-marketing-request-new.details"
            summary={t('staff.marketing.requests.detailsSummary')}
            keepOpen={
              draft.wantBy !== '' ||
              !!fieldError('wantBy') ||
              !!draft.menuItemId ||
              pickingItem ||
              photos.length > 0
            }
          >
            <Field
              testID="staff-marketing-request-new.want-by"
              label={t('staff.marketing.requests.wantBy')}
              value={draft.wantBy}
              onChangeText={(wantBy) => edit({ wantBy })}
              keyboardType="numbers-and-punctuation"
              latin
              error={fieldError('wantBy')}
            />
            <Hint style={{ marginTop: 0 }}>
              {wantByDay
                ? dayLabel(wantByDay, locale)
                : t('staff.marketing.dateHint', { example: isolate(today) })}
            </Hint>
            {pickingItem || draft.menuItemId ? (
              <View style={{ gap: space.xs }}>
                <GroupLabel>{t('staff.marketing.requests.item')}</GroupLabel>
                <PickList
                  testID="staff-marketing-request-new.menu-item"
                  options={itemOptions}
                  loading={items.isPending}
                  value={draft.menuItemId}
                  onChange={(menuItemId) => edit({ menuItemId })}
                />
              </View>
            ) : (
              <LinkText
                testID="staff-marketing-request-new.menu-item.open"
                label={t('staff.marketing.requests.item')}
                onPress={() => setPickingItem(true)}
              />
            )}
            <GroupLabel>{t('staff.marketing.requests.photos')}</GroupLabel>
            <PhotoButton
              testID="staff-marketing-request-new.photo"
              venueId={venue}
              folder="requests"
              photos={photos}
              onChange={setPhotos}
              max={CAPS.requestPhotos}
              disabled={ask.isPending || venue === ''}
            />
          </DetailsFold>
        </Card>
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffMarketingRequestNewRoute() {
  return (
    <RequireStaff roles={MARKETING_REQUEST_ROLES}>
      <AskMarketingScreen />
    </RequireStaff>
  );
}
