import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, MinFontSize, STAFF_MIN_FONT } from '../src/i18n/text';
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
        // clear the native grabber. No home-indicator inset here: the formSheet
        // adds its own below the content, and ours on top of it left a band of
        // bare page under the last row (Sait, 2026-11-02)
        paddingTop: space.xxl,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingBottom: space.s,
        // More room between the title and the first row (Sait, 2026-11-02).
        gap: space.xl + 10,
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
    <RequireStaff page="staff-group">
      {/* Bigger text on the staff pages (Sait, 2026-10-17). */}
      <MinFontSize value={STAFF_MIN_FONT}>
        <GroupSheet />
      </MinFontSize>
    </RequireStaff>
  );
}
