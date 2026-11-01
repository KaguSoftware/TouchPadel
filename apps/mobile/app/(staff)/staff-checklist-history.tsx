import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Card, Hint, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { CheckIcon, ChevronIcon } from '../../src/components/icons';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../../src/features/staff/keys';
import { mapStaffError } from '../../src/features/staff/edge';
import { fetchChecklistHistory } from '../../src/features/staff/checklists/api';
import { useChecklistsLive } from '../../src/features/staff/checklists/live';
import {
  historyLists,
  isTicked,
  localName,
  localText,
  outcomeText,
  periodText,
  type ChecklistItem,
  type HistoryCursor,
  type HistoryList,
} from '../../src/features/staff/checklists/logic';
import { Lead, StaffPhotoThumb, Tag } from '../../src/features/staff/checklists/parts';
import { usePullRefresh } from '../../src/lib/usePullRefresh';

/**
 * Past checklists (Ameen, 2026-10-31; migration 0375): the lists that were the
 * person's (their own copies and their role's shared lists) or that they
 * ticked a line of, once each has ended, newest first, twenty at a time from
 * `my_checklist_history`. Each card says when the list ran and how it ended;
 * pressing it shows its lines as they were left, who ticked each and when,
 * with the photo or note a line carried. Read-only: an ended list takes no
 * tick (CHECKLIST_CLOSED).
 *
 * One person's own lists as they were: no counts across lists and no rates
 * (SOW:480, PRODUCT.md: nothing grades staff).
 */

const T = 'staff-checklist-history';

function HistoryLine({ item, last }: { item: ChecklistItem; last: boolean }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const ticked = isTicked(item);
  const label = localText(item, locale);
  return (
    <View
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: ticked, disabled: true }}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.sm,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          marginTop: 1,
          borderRadius: radius.cell / 2,
          borderWidth: ticked ? 0 : 2,
          borderColor: colors.line2,
          backgroundColor: ticked ? brand.green : colors.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {ticked ? <CheckIcon size={13} color={brand.greenInk} strokeWidth={2.8} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 19, color: ticked ? colors.mut : colors.ink }}>
          {label}
        </Text>
        {ticked && item.done_at ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 17, color: colors.mut }}>
            {t('staff.checklists.doneBy', {
              name: isolate(item.done_by_name ?? ''),
              time: formatTime(new Date(item.done_at), locale),
            })}
          </Text>
        ) : null}
        {item.note ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 17, color: colors.mut2 }}>
            {t('staff.checklists.note', { note: isolate(item.note) })}
          </Text>
        ) : null}
        {ticked && item.photo_path ? (
          <StaffPhotoThumb path={item.photo_path} localUri={null} label={t('staff.checklists.photoOf', { item: label })} />
        ) : null}
      </View>
    </View>
  );
}

function HistoryCard({ list }: { list: HistoryList }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const complete = list.total > 0 && list.done >= list.total;
  return (
    <Card style={{ padding: space.m, paddingBottom: open ? space.xs : space.m }}>
      <Pressable
        testID={`${T}.list.${list.run_id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={t(open ? 'staff.checklists.history.hide' : 'staff.checklists.history.show')}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({ gap: space.xs, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fonts.body800, fontSize: 15, lineHeight: 21, color: colors.ink }}>
              {localName(list, locale)}
            </Text>
            <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 }}>
              {`${periodText(list, locale)} · ${outcomeText(list, locale)}`}
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
          <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
            <ChevronIcon size={16} color={colors.fnt2} />
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={{ marginTop: space.xs }}>
          {list.items.map((item, i) => (
            <HistoryLine key={item.id} item={item} last={i === list.items.length - 1} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function HistoryScreen() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  useChecklistsLive(venueId);

  const history = useInfiniteQuery({
    queryKey: staffKeys.checklistHistory(venue),
    queryFn: ({ pageParam }) => fetchChecklistHistory(venue, pageParam),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: venue !== '',
  });
  const pull = usePullRefresh(() => history.refetch());
  const lists = historyLists(history.data?.pages);

  const body = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (history.isPending) return <SkeletonList rows={3} height={72} />;
    if (history.isError) {
      return (
        <ErrorState
          testID={`${T}.error`}
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(history.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void history.refetch()}
        />
      );
    }
    if (lists.length === 0) {
      return (
        <EmptyState
          testID={`${T}.empty`}
          title={t('staff.checklists.history.emptyTitle')}
          message={t('staff.checklists.history.emptyBody')}
        />
      );
    }
    return (
      <>
        {lists.map((list) => (
          <HistoryCard key={list.run_id} list={list} />
        ))}
        {history.hasNextPage ? (
          <Button
            testID={`${T}.more`}
            label={t('staff.checklists.history.more')}
            variant="secondary"
            size="medium"
            busy={history.isFetchingNextPage}
            onPress={() => void history.fetchNextPage()}
          />
        ) : null}
      </>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.history.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.checklists.history.lead')}</Lead>
        {body()}
      </ScrollView>
    </Screen>
  );
}

export default function StaffChecklistHistoryRoute() {
  return (
    <RequireStaff>
      <HistoryScreen />
    </RequireStaff>
  );
}
