import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
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
import { checklistTodos, dueText, localName } from './logic';
import { Tag } from './parts';

/**
 * Today's checklists still to finish, at the top of the work alerts page
 * (app/staff-work.tsx) for every role (§6.1): one row per list
 * (`staff.checklist.<runId>`) that opens it. A finished list leaves the page;
 * the checklist page writes the same cache entry, so a tick there moves the
 * count here. Nothing shows while the read is in flight: the work list below
 * carries the loading state.
 *
 * Scheduled lists (0323): overdue lists first, then by due time. Each row's
 * second line is the count and when it is due; an overdue row carries the
 * danger tag "Overdue since …" instead of the due time.
 */
export function TodayChecklists({ venueId }: { venueId: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const lists = useQuery({
    queryKey: staffKeys.checklists(venueId),
    queryFn: () => fetchChecklistsToday(venueId),
  });

  if (lists.isPending) return null;
  const now = new Date();
  const todos = lists.isError ? [] : checklistTodos(lists.data, now);
  if (!lists.isError && todos.length === 0) return null;

  return (
    <View style={{ gap: space.xs }}>
      <MicroLabel style={{ paddingStart: 4 }}>
        {lists.isError
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
      ) : (
        <ListCard>
          {todos.map((list, i) => {
            const due = dueText(list, now, locale, lists.data?.business_date);
            const progress = t('staff.checklists.progress', { done: list.done, total: list.total });
            return (
              <Pressable
                key={list.runId}
                testID={`staff.checklist.${list.runId}`}
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: '/staff-checklist', params: { id: list.runId } })
                }
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  paddingStart: space.l,
                  paddingEnd: space.l,
                  paddingTop: 12,
                  paddingBottom: 12,
                  borderBottomWidth: i === todos.length - 1 ? 0 : 1,
                  borderBottomColor: colors.sub,
                  backgroundColor: pressed ? colors.sub : 'transparent',
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={2}
                    style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}
                  >
                    {localName(list, locale)}
                  </Text>
                  <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
                    {due && !list.overdue ? `${progress} · ${due}` : progress}
                  </Text>
                  {due && list.overdue ? <Tag tone="bad" label={due} /> : null}
                </View>
                <ChevronIcon size={16} color={colors.fnt2} />
              </Pressable>
            );
          })}
        </ListCard>
      )}
    </View>
  );
}
