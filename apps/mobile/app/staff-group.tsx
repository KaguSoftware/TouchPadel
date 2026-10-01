import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Hint } from '../src/components/ui';
import { useBack } from '../src/navigation/back';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { GroupRows, useTodayGroups } from '../src/features/staff/todayGroups';

/**
 * One Today group's pages, as the platform's sheet over Today (owner,
 * 2026-10-01, design option A), on iOS: Today's tile opens it with
 * `?group=<key>`, and a row closes the sheet and pushes its page, so back from
 * the page lands on Today. The sheet fits its rows (`fitToContents`,
 * app/_layout.tsx). Android's native sheet never opened, so Today shows the
 * same rows in a modal there and never routes here.
 */
function GroupSheet() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  // Opened from Today; a sheet reached with nothing under it lands there.
  const back = useBack('/staff');
  const { group: key } = useLocalSearchParams<{ group?: string }>();
  const { groups, label } = useTodayGroups();
  const group = groups.find((g) => g.key === key);

  return (
    <View
      style={{
        backgroundColor: colors.bg,
        paddingTop: space.l,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingBottom: space.xl,
        gap: space.m,
      }}
    >
      {group ? (
        <>
          <Text style={{ fontFamily: fonts.display800, fontSize: 19, color: colors.ink }}>
            {t(group.titleKey)}
          </Text>
          <View testID="staff-group.list">
            <GroupRows
              group={group}
              label={label}
              onOpen={(row) => {
                back();
                router.push(row.href);
              }}
            />
          </View>
        </>
      ) : (
        <Hint>{t('errors.notFound')}</Hint>
      )}
    </View>
  );
}

export default function StaffGroupRoute() {
  return (
    <RequireStaff>
      <GroupSheet />
    </RequireStaff>
  );
}
