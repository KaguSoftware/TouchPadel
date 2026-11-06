import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space, useTheme } from '../../src/theme';
import { Button, Card, Hint, Screen } from '../../src/components/ui';
import { EmptyState } from '../../src/components/states';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { pageBlocked } from '../../src/features/staff/access';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../../src/features/staff/keys';
import { fetchChecklistsToday } from '../../src/features/staff/checklists/api';
import { checklistTodos } from '../../src/features/staff/checklists/logic';
import { TodayChecklists } from '../../src/features/staff/checklists/TodayChecklists';
import { useRecipeWork } from '../../src/features/staff/recipes/work';
import { fetchMyWork } from '../../src/features/staff/protocols/api';
import { WorkList } from '../../src/features/staff/protocols/WorkList';
import { useWorkAlerts } from '../../src/features/staff/workAlerts';
import { ProtocolUpdates } from '../../src/features/staff/ProtocolUpdates';
import { usePullRefresh } from '../../src/lib/usePullRefresh';

/**
 * Work alerts (owner, 2026-10-10): what used to sit on Today above the tiles,
 * opened from Today's "Work alerts" button, whose badge counts what waits
 * here (src/features/staff/workAlerts.ts). Top to bottom: turning the alerts
 * on while they are off, the owner's "Follow every step" switch (0363),
 * today's checklists still to finish, then the work list (my_protocol_work),
 * at the venue Today has chosen.
 */

const T = 'staff-work';

function WorkScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, venueId } = useStaffStatus();
  const owner = status.kind === 'staff' && status.staff.role === 'owner' ? status.staff : null;
  // The owner's blocked pages (0345, F-16): a part that only opens a blocked
  // page is not shown here either (checklists, and the protocol work list).
  const showLists = status.kind === 'staff' && !pageBlocked('staff-checklist', status.staff);
  const showWork = status.kind === 'staff' && !pageBlocked('staff-step', status.staff);
  const alerts = useWorkAlerts();
  // The same reads the two blocks make, for the pull and the empty state.
  const lists = useQuery({
    queryKey: staffKeys.checklists(venueId ?? ''),
    queryFn: () => fetchChecklistsToday(venueId!),
    enabled: !!venueId && showLists,
  });
  const work = useQuery({
    queryKey: staffKeys.work(venueId ?? ''),
    queryFn: () => fetchMyWork(venueId!),
    enabled: !!venueId && showWork,
  });
  const recipes = useRecipeWork(
    venueId,
    status.kind === 'staff' ? status.staff.role : null,
    status.kind === 'staff' && !pageBlocked('staff-recipe-change', status.staff),
  );
  const queryClient = useQueryClient();
  const pull = usePullRefresh(() =>
    Promise.all([
      showLists ? lists.refetch() : null,
      showWork ? work.refetch() : null,
      queryClient.invalidateQueries({ queryKey: ['staff', 'myRecipeChanges'] }),
      queryClient.invalidateQueries({ queryKey: ['staff', 'recipeChanges'] }),
    ]),
  );
  const noRecipes = recipes.toDecide.length + recipes.waiting.length + recipes.decided.length === 0;

  const w = work.data;
  const noLists = !showLists || (lists.isSuccess && checklistTodos(lists.data).length === 0);
  const noWork =
    !showWork ||
    (!!w && w.to_decide.length + w.todo.length + w.waiting.length + w.decided.length === 0);
  const empty = noLists && noWork && noRecipes;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.shell.account.alerts') }} />
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
        {/* Until push is allowed the page asks for it (the only prompting call
            in the staff area), and once refused it opens the system settings,
            the one place it can be turned back on. */}
        {alerts.state === 'undetermined' || alerts.state === 'denied' ? (
          <Card style={{ padding: space.l, gap: space.sm }}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink }}>
                {t('staff.shell.alerts.title')}
              </Text>
              <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
                {t(
                  alerts.state === 'denied'
                    ? 'staff.shell.alerts.deniedBody'
                    : 'staff.shell.alerts.body',
                )}
              </Text>
            </View>
            {alerts.state === 'undetermined' ? (
              <Button
                testID={`${T}.alerts.enable`}
                label={t('staff.shell.alerts.enable')}
                size="compact"
                busy={alerts.busy}
                onPress={() => void alerts.enable()}
              />
            ) : (
              <Button
                testID={`${T}.alerts.open-settings`}
                label={t('staff.shell.alerts.openSettings')}
                variant="secondary"
                size="compact"
                onPress={() => void Linking.openSettings().catch(() => {})}
              />
            )}
          </Card>
        ) : null}

        {/* The owner's protocol status pushes (0363). */}
        {owner ? <ProtocolUpdates uid={owner.id} testID={`${T}.follow`} /> : null}

        {!venueId ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {venueId && showLists ? <TodayChecklists venueId={venueId} /> : null}
        {venueId && showWork ? <WorkList venueId={venueId} /> : null}
        {empty ? <EmptyState testID={`${T}.empty`} title={t('staff.shell.work.empty')} /> : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffWorkRoute() {
  return (
    <RequireStaff page="staff-work">
      <WorkScreen />
    </RequireStaff>
  );
}
