import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space, useTheme } from '../../../theme';
import { Hint, LinkText, MicroLabel } from '../../../components/ui';
import { ChevronIcon } from '../../../components/icons';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { ListCard } from '../protocols/parts';
import { fetchChecklistsToday } from './api';
import { useChecklistsLive } from './live';
import { checklistTodos, dueText, localName } from './logic';
import { Tag } from './parts';

/**
 * Today's checklists still to finish, at the top of the work alerts page
 * (app/(staff)/staff-work.tsx) for every role (§6.1): one row per list
 * (`staff.checklist.<runId>`) that opens it. A finished list leaves the page;
 * the checklist page writes the same cache entry, so a tick there moves the
 * count here. Nothing shows while the read is in flight: the work list below
 * carries the loading state.
 *
 * Scheduled lists (0323): overdue lists first, then by due time. Each row's
 * second line is the count and when it is due; an overdue row carries the
 * danger tag "Overdue since …" instead of the due time.
 *
 * Always a way in (Ameen, 2026-10-31; 0375): with nothing left to fill, one
 * row opens the person's lists for today (finished ones included) and, from
 * there, the past ones; with lists to fill, a last row opens the past ones.
 * Live over the branch's checklists topic (./live.ts): a line the owner adds
 * to a finished list brings it back here as soon as it is saved.
 */
export function TodayChecklists({ venueId }: { venueId: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  useChecklistsLive(venueId);
  const lists = useQuery({
    queryKey: staffKeys.checklists(venueId),
    queryFn: () => fetchChecklistsToday(venueId),
  });

  if (lists.isPending) return null;
  const now = new Date();
  const todos = lists.isError ? [] : checklistTodos(lists.data, now);

  const row = (key: string, testID: string, href: Href, title: string, sub: string | null, last: boolean, extra?: ReactNode) => (
    <Pressable
      key={key}
      testID={testID}
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: 12,
        paddingBottom: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
        backgroundColor: pressed ? colors.sub : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
          {title}
        </Text>
        {sub ? <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>{sub}</Text> : null}
        {extra}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );

  return (
    <View style={{ gap: space.xs }}>
      <MicroLabel style={{ paddingStart: 4 }}>
        {lists.isError || todos.length === 0
          ? t('staff.checklists.title')
          : `${t('staff.checklists.title')} · ${todos.length}`}
      </MicroLabel>
      {lists.isError ? (
        // The same failed-read line as the work list below: why, then the retry.
        <View style={{ gap: space.xs }}>
          <Hint>{t(mapStaffError(lists.error))}</Hint>
          <LinkText
            testID="staff.checklists.retry"
            label={t('common.retry')}
            onPress={() => void lists.refetch()}
          />
        </View>
      ) : todos.length === 0 ? (
        <ListCard>
          {row(
            'all',
            'staff.checklists.open-all',
            '/staff-checklist',
            t('staff.checklists.openAll'),
            t('staff.checklists.nothingToFill'),
            true,
          )}
        </ListCard>
      ) : (
        <ListCard>
          {todos.map((list) => {
            const due = dueText(list, now, locale, lists.data?.business_date);
            const progress = t('staff.checklists.progress', { done: list.done, total: list.total });
            return row(
              list.runId,
              `staff.checklist.${list.runId}`,
              { pathname: '/staff-checklist', params: { id: list.runId } },
              localName(list, locale),
              due && !list.overdue ? `${progress} · ${due}` : progress,
              false,
              due && list.overdue ? <Tag tone="bad" label={due} /> : null,
            );
          })}
          {row('history', 'staff.checklists.history', '/staff-checklist-history', t('staff.checklists.pastRow'), null, true)}
        </ListCard>
      )}
    </View>
  );
}
