import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  countPhrase,
  formatDate,
  isolateLtr,
  type Locale,
  type MessageKey,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Screen, SegmentedControl } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { Tag } from '../../src/features/staff/checklists/parts';
import {
  BOARD_REFRESH_MS,
  activityKeys,
  fetchActivityBoard,
} from '../../src/features/staff/activity/api';
import {
  actionWords,
  filterRows,
  onlineCounts,
  partStatus,
  sinceOf,
  type ActivityFilter,
  type ActivityPart,
  type ActivityRow,
  type PartStatus,
  type Since,
} from '../../src/features/staff/activity/logic';
import { usePullRefresh } from '../../src/lib/usePullRefresh';

/**
 * The owner's activity monitor (0341): for every person at the branch, their
 * status, last seen and last action on the operator (the desktop app) and on
 * the staff phone, each app apart. Listed by name as the server sends them;
 * nothing here ranks anyone (PRODUCT.md). Statuses are the server's, worked
 * out on its own clock; "3 min ago" counts from the board's server time.
 */

const T = 'staff-activity';
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A clock for the "ago" words, ticking while the screen is up. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function sinceWords(since: Since, t: Translate, locale: Locale): string {
  switch (since.kind) {
    case 'now':
      return t('staff.activity.ago.now');
    case 'minutes':
      return countPhrase('staff.activity.ago.minutes', since.n, locale);
    case 'hours':
      return countPhrase('staff.activity.ago.hours', since.n, locale);
    case 'days':
      return countPhrase('staff.activity.ago.days', since.n, locale);
    case 'date':
      return t('staff.activity.ago.date', { date: formatDate(since.at, locale) });
  }
}

function StatusMark({ status, testID }: { status: PartStatus; testID: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const dot = {
    online: colors.gstrong,
    away: colors.ambstrong,
    offline: colors.fnt2,
    never: 'transparent',
  }[status];
  const ink = status === 'online' ? colors.gtext : status === 'away' ? colors.ambtext : colors.mut;
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dot,
          borderWidth: status === 'never' ? 1 : 0,
          borderColor: colors.fnt2,
        }}
      />
      <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: ink }}>
        {t(`staff.activity.status.${status}`)}
      </Text>
    </View>
  );
}

function PartSection({
  label,
  part,
  ago,
  testID,
}: {
  label: string;
  part: ActivityPart | null;
  ago: (at: string) => string;
  testID: string;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const meta = part
    ? [
        part.screen ? t('staff.activity.screen', { screen: isolateLtr(part.screen) }) : null,
        part.appVersion
          ? t('staff.activity.version', { version: isolateLtr(part.appVersion) })
          : null,
      ].filter((s): s is string => s !== null)
    : [];
  return (
    <View
      testID={testID}
      style={{
        gap: 3,
        paddingVertical: space.sm,
        paddingHorizontal: space.l,
        borderTopWidth: 1,
        borderTopColor: colors.sub,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
          {label}
        </Text>
        <StatusMark status={partStatus(part)} testID={`${testID}.status`} />
      </View>
      {part ? (
        <>
          <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
            {t('staff.activity.lastSeen', { when: ago(part.lastSeenAt) })}
          </Text>
          <Text
            testID={`${testID}.action`}
            numberOfLines={2}
            style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}
          >
            {part.lastAction && part.lastActionAt
              ? t('staff.activity.lastAction', {
                  action: actionWords(part.lastAction, t),
                  when: ago(part.lastActionAt),
                })
              : t('staff.activity.noAction')}
          </Text>
          {meta.length > 0 ? (
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.fnt }}
            >
              {meta.join(' · ')}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function PersonCard({ row, ago }: { row: ActivityRow; ago: (at: string) => string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const id = `${T}.row.${row.staffId}`;
  return (
    <View
      testID={id}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingTop: space.m,
          paddingBottom: space.sm,
          paddingHorizontal: space.l,
        }}
      >
        <View style={{ flex: 1, gap: 1 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.display800, fontSize: 15.5, color: colors.ink }}
          >
            {row.name}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {t(`op.roles.${row.role}` as MessageKey)}
          </Text>
        </View>
        {row.onBreak ? (
          <View testID={`${id}.break`}>
            <Tag label={t('staff.activity.onBreak')} tone="warn" />
          </View>
        ) : null}
      </View>
      <PartSection
        label={t('staff.activity.surface.operator')}
        part={row.operator}
        ago={ago}
        testID={`${id}.operator`}
      />
      <PartSection
        label={t('staff.activity.surface.mobile')}
        part={row.mobile}
        ago={ago}
        testID={`${id}.mobile`}
      />
    </View>
  );
}

function ActivityScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const board = useQuery({
    queryKey: activityKeys.board,
    queryFn: fetchActivityBoard,
    refetchInterval: focused ? BOARD_REFRESH_MS : false,
  });
  const pull = usePullRefresh(async () => {
    await board.refetch();
  });
  const now = useNow(15_000);

  const all = board.data?.rows ?? [];
  const rows = filterRows(all, filter);
  const counts = onlineCounts(all);
  const serverTime = board.data?.serverTime ?? new Date(now).toISOString();
  // dataUpdatedAt is when this phone received the board: the server's clock
  // read then, plus what this phone has counted since.
  const fetchedAt = board.dataUpdatedAt || now;
  const ago = (at: string) => sinceWords(sinceOf(at, serverTime, fetchedAt, now), t, locale);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.activity.title') }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
      >
        <SegmentedControl
          testID={`${T}.filter`}
          options={[
            { value: 'all', label: t('staff.activity.filter.all') },
            { value: 'online', label: t('staff.activity.filter.online') },
          ]}
          value={filter}
          onChange={setFilter}
        />

        {board.isSuccess ? (
          <Text
            testID={`${T}.summary`}
            style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.mut }}
          >
            {t('staff.activity.summary', { operator: counts.operator, mobile: counts.mobile })}
          </Text>
        ) : null}

        {board.isPending ? <SkeletonList rows={4} height={132} /> : null}
        {board.isError ? (
          <ErrorState
            testID={`${T}.error`}
            title={t('errors.loadFailedTitle')}
            message={t('staff.activity.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void board.refetch()}
          />
        ) : null}
        {board.isSuccess && rows.length === 0 ? (
          <EmptyState
            testID={`${T}.empty`}
            title={t(filter === 'online' ? 'staff.activity.emptyOnline' : 'staff.activity.empty')}
          />
        ) : null}

        {rows.map((row) => (
          <PersonCard key={row.staffId} row={row} ago={ago} />
        ))}
      </ScrollView>
    </Screen>
  );
}

export default function StaffActivityRoute() {
  return (
    <RequireStaff roles={['owner']}>
      <ActivityScreen />
    </RequireStaff>
  );
}
