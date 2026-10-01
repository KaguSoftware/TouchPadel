import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Card, Hint, LinkText, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { Lead } from '../src/features/staff/checklists/parts';
import { SLIP_ROLES } from '../src/features/staff/scan/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { FLOOR_ROLES, type FloorTable } from '../src/features/staff/floor/logic';
import { useDraftTables } from '../src/features/staff/floor/drafts';
import { useFloor } from '../src/features/staff/floor/parts';

/** Three tiles a row: a table number stays big enough to read at arm's length. */
const PER_ROW = 3;

function rowsOf<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * Place an order, step 1 (owner, 2026-09-28; 0251): the tables. Each tile
 * says at a glance whether the table has a tab running and whether this phone
 * has an order for it not yet sent; a tap opens that table's menu
 * (app/staff-order-menu.tsx). Nothing can be ordered while the day is not
 * open, and the tiles say so rather than fail on the send. Grouped by zone
 * when the branch names zones.
 */
function TablesScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const floor = useFloor(venue);
  const drafts = useDraftTables();
  const pull = usePullRefresh(() => floor.refetch());
  const role = status.kind === 'staff' ? status.staff.role : null;

  const tile = (table: FloorTable, closed: boolean) => {
    const tabs = table.tabs.length;
    const waiting = drafts.has(table.id);
    const number = isolate(table.table_number);
    return (
      <Pressable
        key={table.id}
        testID={`staff-order.table.${table.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('staff.floor.tables.table', { number })}
        accessibilityState={{ disabled: closed }}
        disabled={closed}
        onPress={() => router.push({ pathname: '/staff-order-menu', params: { table: table.id } })}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 88,
          padding: space.sm,
          borderRadius: radius.card,
          borderWidth: tabs > 0 ? 2 : 1,
          borderColor: tabs > 0 ? colors.gline : colors.line,
          backgroundColor: pressed ? colors.sub : tabs > 0 ? colors.gtint : colors.card,
          justifyContent: 'space-between',
          opacity: closed ? 0.5 : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.display800, fontSize: 22, lineHeight: 28, color: colors.ink }}
        >
          {number}
        </Text>
        <View style={{ gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body600, fontSize: 12, color: tabs > 0 ? colors.gtext : colors.mut }}
          >
            {tabs > 0
              ? t('staff.floor.tables.tabsOpen', { count: formatNumber(tabs, locale) })
              : t('staff.floor.tables.free')}
          </Text>
          {waiting ? (
            <Text numberOfLines={1} style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ambtext }}>
              {t('staff.floor.tables.notSent')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const body = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (floor.isPending) return <SkeletonList rows={3} height={88} />;
    if (floor.isError) {
      return (
        <ErrorState
          testID="staff-order.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(floor.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void floor.refetch()}
        />
      );
    }
    const { tables, day_open } = floor.data;
    if (tables.length === 0) return <Hint>{t('staff.floor.tables.empty')}</Hint>;
    // By zone, in the server's number order within each; one unnamed group
    // when the branch names none.
    const zones = [...new Set(tables.map((tb) => tb.zone ?? ''))];
    return (
      <View style={{ gap: space.m }}>
        {!day_open ? (
          <Card style={{ padding: space.m, backgroundColor: colors.amb, borderColor: colors.ambline }}>
            <Text style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ambtext }}>
              {t('staff.floor.tables.dayClosed')}
            </Text>
          </Card>
        ) : null}
        {zones.map((zone) => (
          <View key={zone || '-'} style={{ gap: space.s }}>
            {zones.length > 1 && zone ? (
              <MicroLabel style={{ paddingStart: 4 }}>{isolate(zone)}</MicroLabel>
            ) : null}
            {rowsOf(tables.filter((tb) => (tb.zone ?? '') === zone), PER_ROW).map((row) => (
              <View key={row[0]!.id} style={{ flexDirection: 'row', gap: space.s }}>
                {row.map((tb) => tile(tb, !day_open))}
                {/* A short last row keeps its tiles the width of the others. */}
                {Array.from({ length: PER_ROW - row.length }, (_, i) => (
                  <View key={`gap-${i}`} style={{ flex: 1 }} />
                ))}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.floor.tables.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.floor.tables.lead')}</Lead>
        <View testID="staff-order.tables">{body()}</View>
        {/* The paper slip stays for when the phone is not enough (a big table
            written on a pad): it goes to the till as before. */}
        {role && SLIP_ROLES.includes(role) ? (
          <View style={{ alignItems: 'flex-start', marginTop: space.m }}>
            <LinkText
              testID="staff-order.slip"
              label={t('staff.floor.tables.slip')}
              onPress={() => router.push('/staff-order-slip')}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffOrderRoute() {
  return (
    <RequireStaff roles={FLOOR_ROLES}>
      <TablesScreen />
    </RequireStaff>
  );
}
