import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatTime, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ChecklistRow } from '../src/components/ChecklistRow';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { fetchChecklistsToday, markChecklistItem } from '../src/features/staff/checklists/api';
import {
  applyMark,
  isTicked,
  localName,
  localText,
  markArgs,
  orderLists,
  type ChecklistItem,
  type ChecklistsToday,
  type MarkArgs,
} from '../src/features/staff/checklists/logic';
import { StaffPhotoThumb, Tag } from '../src/features/staff/checklists/parts';
import { useBack } from '../src/navigation/back';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Today's checklists (build-contracts-2026-09-23 §2.14, §2.24.8, §6.1): the
 * opening and closing lists of the caller's role, one shared list per role,
 * each tick showing who ticked it. Every role has this page; a role with no
 * list yet is told so.
 *
 * A line marked "Needs a photo" (#69) is ticked by its photo: the photo field
 * takes or picks one, uploads it to a checklists slot, and the tick goes with
 * its path. A bare tick of such a line is never sent. A photo whose tick failed
 * stays on the line, so pressing the line again retries with the same photo.
 *
 * `?id=` is a list a push or Today named; it is shown first.
 */

type ByItem<T> = Record<string, T>;

function omit<T>(map: ByItem<T>, id: string): ByItem<T> {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

function ChecklistScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const back = useBack('/staff');
  const venue = venueId ?? '';
  const key = staffKeys.checklists(venue);

  const today = useQuery({
    queryKey: key,
    queryFn: () => fetchChecklistsToday(venue),
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => today.refetch());

  // A photo taken for a line whose tick has not gone through, by line id.
  const [pending, setPending] = useState<ByItem<AttachedPhoto>>({});
  // The just-taken file of each uploaded path, shown until the signed URL would be.
  const [localUris, setLocalUris] = useState<ByItem<string>>({});
  const [errors, setErrors] = useState<ByItem<string>>({});

  const mark = useMutation({
    mutationKey: staffKeys.mutation('checklist.mark'),
    mutationFn: (args: MarkArgs) => markChecklistItem(args),
    onSuccess: (item) => {
      queryClient.setQueryData<ChecklistsToday>(key, (data) => (data ? applyMark(data, item) : data));
      setPending((p) => omit(p, item.id));
      setErrors((e) => omit(e, item.id));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err, args) => setErrors((e) => ({ ...e, [args.p_item_id]: t(mapStaffError(err)) })),
  });

  const send = (item: ChecklistItem, done: boolean, photoPath?: string | null) => {
    const args = markArgs(item, done, photoPath);
    if (!args) {
      setErrors((e) => ({ ...e, [item.id]: t('staff.checklists.photoFirst') }));
      return;
    }
    setErrors((e) => omit(e, item.id));
    mark.mutate(args);
  };

  const toggle = (item: ChecklistItem) => {
    if (!isTicked(item)) {
      send(item, true, pending[item.id]?.path);
      return;
    }
    if (!item.photo_path) {
      send(item, false);
      return;
    }
    Alert.alert(t('staff.checklists.untickTitle'), t('staff.checklists.untickPhoto'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staff.checklists.untick'), style: 'destructive', onPress: () => send(item, false) },
    ]);
  };

  // The photo is the tick: once it is up, the tick goes with it.
  const onPhotos = (item: ChecklistItem, photos: AttachedPhoto[]) => {
    const photo = photos[0];
    if (!photo) {
      setPending((p) => omit(p, item.id));
      return;
    }
    setPending((p) => ({ ...p, [item.id]: photo }));
    setLocalUris((u) => ({ ...u, [photo.path]: photo.uri }));
    send(item, true, photo.path);
  };

  const busyItem = mark.isPending ? mark.variables?.p_item_id : undefined;
  const data = today.data;
  const lists = data ? orderLists(data.lists, params.id) : [];

  const body = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (today.isPending) return <SkeletonList rows={2} height={160} />;
    if (today.isError) {
      return (
        <ErrorState
          testID="staff-checklist.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(today.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void today.refetch()}
        />
      );
    }
    if (lists.length === 0) {
      return (
        <EmptyState
          testID="staff-checklist.empty"
          title={t('staff.checklists.emptyTitle')}
          message={t('staff.checklists.emptyBody')}
        />
      );
    }
    return lists.map((list) => {
      const complete = list.total > 0 && list.done >= list.total;
      return (
        <Card
          key={list.run_id}
          style={{
            padding: space.m,
            paddingBottom: space.xs,
            ...(list.run_id === params.id ? { borderColor: colors.blue, borderWidth: 1.5 } : null),
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
            <View style={{ flex: 1, gap: 2 }}>
              <MicroLabel>{t(`work.checklist.slot.${list.slot}`)}</MicroLabel>
              <Text style={{ fontFamily: fonts.body800, fontSize: 15, lineHeight: 21, color: colors.ink }}>
                {localName(list, locale)}
              </Text>
            </View>
            <Tag
              tone={complete ? 'good' : 'plain'}
              label={
                complete
                  ? t('staff.checklists.allDone')
                  : t('staff.checklists.progress', { done: list.done, total: list.total })
              }
            />
          </View>
          <View style={{ marginTop: space.xs }}>
            {list.items.map((item, i) => {
              const ticked = isTicked(item);
              const label = localText(item, locale);
              const photo = pending[item.id];
              return (
                <ChecklistRow
                  key={item.id}
                  testID={`staff-checklist.item.${item.id}`}
                  label={label}
                  checked={ticked}
                  busy={busyItem === item.id}
                  onToggle={() => toggle(item)}
                  flag={item.photo_required && !ticked ? t('staff.checklists.needsPhoto') : null}
                  meta={
                    ticked && item.done_at
                      ? t('staff.checklists.doneBy', {
                          name: isolate(item.done_by_name ?? ''),
                          time: formatTime(new Date(item.done_at), locale),
                        })
                      : null
                  }
                  last={i === list.items.length - 1}
                >
                  {item.photo_required && !ticked ? (
                    <PhotoButton
                      testID={`staff-checklist.photo.${item.id}`}
                      venueId={venue}
                      folder="checklists"
                      photos={photo ? [photo] : []}
                      onChange={(photos) => onPhotos(item, photos)}
                      max={1}
                      disabled={busyItem === item.id}
                    />
                  ) : null}
                  {ticked && item.photo_path ? (
                    <StaffPhotoThumb
                      path={item.photo_path}
                      localUri={localUris[item.photo_path] ?? null}
                      label={t('staff.checklists.photoOf', { item: label })}
                    />
                  ) : null}
                  {item.note ? (
                    <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 }}>
                      {t('staff.checklists.note', { note: isolate(item.note) })}
                    </Text>
                  ) : null}
                  {errors[item.id] ? <ErrorText>{errors[item.id]}</ErrorText> : null}
                </ChecklistRow>
              );
            })}
          </View>
        </Card>
      );
    });
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>
          {t('staff.checklists.lead')}
        </Text>
        {data ? (
          <MicroLabel style={{ paddingStart: 4 }}>
            {t('staff.checklists.businessDay', {
              date: formatDate(new Date(`${data.business_date}T12:00:00Z`), locale),
            })}
          </MicroLabel>
        ) : null}
        {body()}
        <Button
          testID="staff-checklist.done"
          label={t('staff.checklists.done')}
          variant="secondary"
          size="medium"
          onPress={back}
          style={{ marginTop: space.s }}
        />
      </ScrollView>
    </Screen>
  );
}

export default function StaffChecklistRoute() {
  return (
    <RequireStaff>
      <ChecklistScreen />
    </RequireStaff>
  );
}
