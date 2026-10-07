import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { fetchScreenshotEvents, screenshotKeys } from '../src/features/staff/screenGuard/api';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * The owner's list of staff screenshots: who, on which page, when. The rows
 * are the audit log's `staff.screenshot` entries, written by the staff phone
 * when it hears of a screenshot (StaffScreenGuard).
 */

const T = 'staff-screenshots';

function ScreenshotsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const list = useQuery({ queryKey: screenshotKeys.list, queryFn: fetchScreenshotEvents });
  const pull = usePullRefresh(async () => {
    await list.refetch();
  });
  const rows = list.data ?? [];

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.screenshots.title') }} />
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
        <Text
          testID={`${T}.intro`}
          style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}
        >
          {t('staff.screenshots.intro')}
        </Text>

        {list.isPending ? <SkeletonList rows={4} height={64} /> : null}
        {list.isError ? (
          <ErrorState
            testID={`${T}.error`}
            title={t('errors.loadFailedTitle')}
            message={t('staff.screenshots.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        {list.isSuccess && rows.length === 0 ? (
          <EmptyState testID={`${T}.empty`} title={t('staff.screenshots.empty')} />
        ) : null}

        {rows.length > 0 ? (
          <View
            testID={`${T}.list`}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card,
              overflow: 'hidden',
            }}
          >
            {rows.map((e, i) => (
              <View
                key={e.id}
                testID={`${T}.row.${e.id}`}
                style={{
                  gap: 2,
                  paddingVertical: 12,
                  paddingHorizontal: space.l,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: colors.sub,
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink }}
                >
                  {t('staff.screenshots.row', {
                    name: e.staffName ?? t('staff.screenshots.unknownStaff'),
                    page: e.page,
                  })}
                </Text>
                <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
                  {formatDateTime(new Date(e.at), locale)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffScreenshotsRoute() {
  return (
    <RequireStaff roles={['owner']}>
      <ScreenshotsScreen />
    </RequireStaff>
  );
}
