import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Alert, AppState, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Hint, LinkText, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { MenuRow } from '../src/components/booking';
import {
  BellIcon,
  CalendarIcon,
  CardIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  EnvelopeIcon,
  GlobeIcon,
  LockIcon,
  PencilIcon,
  RoofIcon,
  SearchIcon,
  SlidersIcon,
  StopwatchIcon,
  SunIcon,
  TagIcon,
  type IconProps,
} from '../src/components/icons';
import {
  getPushPermissionState,
  permissionStateAfter,
  registerPushToken,
  type PushPermissionState,
} from '../src/features/profile/push';
import { RequireStaff, useStaffSignOut } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { staffRows, type StaffRowDef } from '../src/features/staff/rows';
import { showsVenuePicker } from '../src/features/staff/venue';
import { mapStaffError } from '../src/features/staff/edge';
import { fetchChecklistsToday } from '../src/features/staff/checklists/api';
import { checklistTodos, localName } from '../src/features/staff/checklists/logic';
import { WorkList } from '../src/features/staff/protocols/WorkList';
import { ListCard } from '../src/features/staff/protocols/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { addBreadcrumb } from '../src/lib/telemetry';
import { useToast } from '../src/components/overlays';

/**
 * Today: the staff phone's home (build-contracts-2026-09-23 §6.1).
 *
 * Top to bottom: who and where, the venue picker (only with more than one
 * venue), the "Turn on work alerts" row until push is allowed, the work list,
 * the pages this role has (rows.ts), and the account. Reached by replacing,
 * after a staff sign-in or from the tabs' gate, so there is nothing to go back
 * to and the back item is hidden.
 */

/**
 * The icon of each Today row; a page lane adds its row's icon with the row.
 * No two rows one role sees share an icon, and none is the Settings sliders.
 */
const ROW_ICONS: Record<string, ComponentType<IconProps>> = {
  protocols: ClockIcon,
  start: PencilIcon,
  production: StopwatchIcon,
  shopping: TagIcon,
  run: TagIcon,
  purchases: CardIcon,
  marketing: GlobeIcon,
  requests: EnvelopeIcon,
  notes: CalendarIcon,
  ideas: SunIcon,
  teachings: CheckIcon,
  recipes: SearchIcon,
  'recipe-changes': LockIcon,
  stock: RoofIcon,
  suggestions: BellIcon,
  'ask-marketing': GlobeIcon,
  'marketing-inbox': CheckIcon,
};

/**
 * Today's pages in three short lists rather than one of up to fourteen rows:
 * the protocols and what feeds them, the day's work, and what the person asks
 * of others. A row this table does not name (a page lane's new row) joins the
 * day's work, so it is never lost. Order inside a group is rows.ts's.
 */
const ROW_GROUPS = [
  { key: 'protocols', titleKey: 'staff.shell.today.groups.protocols', ids: ['protocols', 'start', 'ideas', 'notes'] },
  { key: 'daily', titleKey: 'staff.shell.today.groups.daily', ids: null },
  { key: 'team', titleKey: 'staff.shell.today.groups.team', ids: ['requests', 'suggestions', 'ask-marketing'] },
] as const;

function groupRows(rows: readonly StaffRowDef[]): { key: string; titleKey: (typeof ROW_GROUPS)[number]['titleKey']; rows: StaffRowDef[] }[] {
  const named = new Set<string>(ROW_GROUPS.flatMap((g) => (g.ids ? [...g.ids] : [])));
  return ROW_GROUPS.map((g) => ({
    key: g.key,
    titleKey: g.titleKey,
    rows: rows.filter((r) => (g.ids ? (g.ids as readonly string[]).includes(r.id) : !named.has(r.id))),
  })).filter((g) => g.rows.length > 0);
}

/**
 * Today's checklists still to finish, at the top of To do for every role
 * (§6.1): one row per list (`staff.checklist.<runId>`) that opens it. A
 * finished list leaves Today; the checklist page writes the same cache entry,
 * so a tick there moves the count here. Nothing shows while the read is in
 * flight: the work list below carries the loading state.
 */
function TodayChecklists({ venueId }: { venueId: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const lists = useQuery({
    queryKey: staffKeys.checklists(venueId),
    queryFn: () => fetchChecklistsToday(venueId),
  });

  if (lists.isPending) return null;
  const todos = lists.isError ? [] : checklistTodos(lists.data);
  if (!lists.isError && todos.length === 0) return null;

  return (
    <View style={{ gap: space.xs }}>
      <MicroLabel style={{ paddingStart: 4 }}>
        {lists.isError ? t('staff.checklists.title') : `${t('staff.checklists.title')} · ${todos.length}`}
      </MicroLabel>
      {lists.isError ? (
        // The same failed-read line as the work list below: why, then the retry.
        <View style={{ gap: space.xs }}>
          <Hint>{t(mapStaffError(lists.error))}</Hint>
          <LinkText testID="staff.checklists.retry" label={t('common.retry')} onPress={() => void lists.refetch()} />
        </View>
      ) : (
        <ListCard>
          {todos.map((list, i) => (
            <Pressable
              key={list.runId}
              testID={`staff.checklist.${list.runId}`}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/staff-checklist', params: { id: list.runId } })}
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
                <Text numberOfLines={2} style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
                  {localName(list, locale)}
                </Text>
                <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
                  {t('staff.checklists.progress', { done: list.done, total: list.total })}
                </Text>
              </View>
              <ChevronIcon size={16} color={colors.fnt2} />
            </Pressable>
          ))}
        </ListCard>
      )}
    </View>
  );
}

function useWorkAlerts() {
  const { t } = useLocale();
  const toast = useToast();
  const [state, setState] = useState<PushPermissionState>('undetermined');
  const [busy, setBusy] = useState(false);

  // Re-probed on every foreground, as Settings does: coming back from the
  // system settings with alerts turned on must show it, and must register the
  // token that makes the alerts arrive at all.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      void getPushPermissionState().then((next) => {
        if (cancelled) return;
        setState(next);
        if (next === 'granted') {
          void registerPushToken({ prompt: false }).then((result) =>
            addBreadcrumb('push.register', { result, reason: 'staff-foreground' }),
          );
        }
      });
    };
    probe();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') probe();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // The only prompting call in the staff area: the lifecycle never asks, so an
  // account that never turned alerts on has no token and every work push
  // would end as NO_PUSH_TOKEN (plan §6.6).
  const enable = useCallback(async () => {
    setBusy(true);
    const result = await registerPushToken({ prompt: true });
    addBreadcrumb('push.register', { result, reason: 'staff-alerts-row' });
    const observed = result === 'failed' ? await getPushPermissionState() : 'unavailable';
    const next = permissionStateAfter(result, observed);
    setState(next.state);
    if (next.errored) toast(t('errors.generic'), 'error');
    setBusy(false);
  }, [t, toast]);

  return { state, busy, enable };
}

function TodayScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId, venues, setVenueId } = useStaffStatus();
  const alerts = useWorkAlerts();
  const out = useStaffSignOut();
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: staffKeys.all }), [queryClient]);
  const pull = usePullRefresh(refresh);

  // RequireStaff renders this only for a staff status.
  if (status.kind !== 'staff') return null;
  const { staff } = status;

  const venueName = (id: string | null) => {
    const venue = venues.find((v) => v.id === id);
    return venue ? (locale === 'ar' ? venue.name_ar : venue.name_en) : null;
  };
  const role = t(`op.roles.${staff.role}`);
  const here = venueName(venueId);

  const confirmSignOut = () => {
    if (out.busy) return;
    Alert.alert(t('auth.signOut'), t('staff.shell.account.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void out.signOut() },
    ]);
  };

  const rows = staffRows(staff.role);
  const bodyText = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{ title: t('staff.shell.today.title'), headerBackVisible: false, gestureEnabled: false }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <View style={{ gap: 2, marginBottom: space.xs }}>
          <Text style={{ fontFamily: fonts.display800, fontSize: 22, lineHeight: 28, color: colors.ink }}>
            {t('staff.shell.today.greeting', { name: staff.displayName })}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>
            {here ? t('staff.shell.today.roleAtVenue', { role, venue: here }) : role}
          </Text>
        </View>

        {showsVenuePicker(status.venues) ? (
          <Card style={{ padding: space.m }}>
            <MicroLabel>{t('staff.shell.venue.label')}</MicroLabel>
            <View style={{ marginTop: 8 }}>
              <SegmentedControl<string>
                testID="staff.venue"
                options={status.venues.map((id) => ({ value: id, label: venueName(id) ?? '…' }))}
                value={venueId ?? status.venues[0]!}
                onChange={setVenueId}
              />
            </View>
          </Card>
        ) : null}
        {status.venues.length === 0 ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}

        {alerts.state === 'undetermined' || alerts.state === 'denied' ? (
          <Card style={{ padding: space.m, backgroundColor: colors.amb, borderColor: colors.ambline }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <BellIcon size={13} color={colors.ambstrong} />
              <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ambtext }}>
                {t('staff.shell.alerts.title')}
              </Text>
            </View>
            <Text style={{ ...bodyText, color: colors.ambtext, marginTop: 6 }}>
              {t(alerts.state === 'denied' ? 'staff.shell.alerts.deniedBody' : 'staff.shell.alerts.body')}
            </Text>
            {alerts.state === 'denied' ? (
              <Button
                testID="staff.alerts.open-settings"
                label={t('staff.shell.alerts.openSettings')}
                variant="secondary"
                size="compact"
                onPress={() => void Linking.openSettings().catch(() => {})}
                style={{ marginTop: 10, alignSelf: 'flex-start' }}
              />
            ) : (
              <Button
                testID="staff.alerts.enable"
                label={t('staff.shell.alerts.enable')}
                variant="cta"
                size="compact"
                busy={alerts.busy}
                onPress={() => void alerts.enable()}
                style={{ marginTop: 10, alignSelf: 'flex-start' }}
              />
            )}
          </Card>
        ) : null}

        {/* The work list: today's checklists first, then what waits on the
            person to decide, their open steps, what they sent and what was
            decided (my_checklists_today, my_protocol_work), at `venueId`. */}
        {venueId ? <TodayChecklists venueId={venueId} /> : null}
        {venueId ? <WorkList venueId={venueId} /> : null}

        {groupRows(rows).map((group) => (
          <View key={group.key} style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t(group.titleKey)}</MicroLabel>
            <ListCard>
              {group.rows.map((row, i) => {
                const Icon = ROW_ICONS[row.id] ?? SlidersIcon;
                return (
                  <MenuRow
                    key={row.id}
                    testID={row.testID}
                    icon={<Icon size={15} color={colors.gstrong} />}
                    label={t(row.labelKey)}
                    onPress={() => router.push(row.href)}
                    last={i === group.rows.length - 1}
                  />
                );
              })}
            </ListCard>
          </View>
        ))}

        {/* The account is one group like the lists above it: its caption
            outside, what the phone is set to, then Settings. */}
        <View style={{ gap: space.xs }}>
          <MicroLabel style={{ paddingStart: 4 }}>{t('staff.shell.account.title')}</MicroLabel>
          <ListCard>
            <View style={{ padding: space.l, gap: space.s, borderBottomWidth: 1, borderBottomColor: colors.sub }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
                {t(alerts.state === 'granted' ? 'staff.shell.account.alertsOn' : 'staff.shell.account.alertsOff')}
              </Text>
              <Text style={bodyText}>{t('staff.shell.account.onePhone')}</Text>
              <Text style={bodyText}>{t('staff.shell.account.passwordNote')}</Text>
            </View>
            <MenuRow
              testID="staff.settings"
              icon={<SlidersIcon size={15} color={colors.gstrong} />}
              label={t('settings.title')}
              onPress={() => router.push('/settings')}
              last
            />
          </ListCard>
        </View>
        <ErrorText>{out.error}</ErrorText>
        <Button
          testID="staff.sign-out"
          label={t('auth.signOut')}
          variant="secondary"
          size="medium"
          busy={out.busy}
          onPress={confirmSignOut}
          style={{ backgroundColor: 'transparent' }}
        />
      </ScrollView>
    </Screen>
  );
}

export default function StaffTodayRoute() {
  return (
    <RequireStaff>
      <TodayScreen />
    </RequireStaff>
  );
}
