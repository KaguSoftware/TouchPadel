import { useCallback, useEffect, useState, type ComponentType } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Hint,
  LinkText,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import {
  BellIcon,
  ChevronIcon,
  EyeIcon,
  SlidersIcon,
  type IconProps,
} from '../src/components/icons';
import {
  getPushPermissionState,
  permissionStateAfter,
  registerPushToken,
  type PushPermissionState,
} from '../src/features/profile/push';
import { RequireStaff, useStaffSignOut } from '../src/features/staff/RequireStaff';
import { setGuestPreview } from '../src/features/staff/guestPreview';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { showsVenuePicker } from '../src/features/staff/venue';
import { mapStaffError } from '../src/features/staff/edge';
import { fetchChecklistsToday } from '../src/features/staff/checklists/api';
import { checklistTodos, localName } from '../src/features/staff/checklists/logic';
import { WorkList } from '../src/features/staff/protocols/WorkList';
import { ListCard } from '../src/features/staff/protocols/parts';
import { GroupRows, useTodayGroups, type TodayGroup } from '../src/features/staff/todayGroups';
import type { StaffRowDef } from '../src/features/staff/rows';
import { useReduceMotion } from '../src/lib/useReduceMotion';
import { addBreadcrumb } from '../src/lib/telemetry';
import { useToast } from '../src/components/overlays';

/**
 * Today: the staff phone's home (build-contracts-2026-09-23 §6.1; layout:
 * owner, 2026-10-01, design option A).
 *
 * Top to bottom: who and where, the venue picker (only with more than one
 * venue), the work list, the pages this role has as a grid of group tiles
 * (todayGroups.ts; a tile opens its rows in a sheet, app/staff-group.tsx), and
 * the account as three buttons: work alerts, guest view, Settings. Reached by
 * replacing, after a staff sign-in or from the tabs' gate, so there is nothing
 * to go back to: no header at all, since the page has no date to change.
 */

/**
 * One group as a tile: its icon (with an amber dot when a row in it is
 * waiting on the person), the title and a one-line preview of its pages.
 */
function GroupTile({
  group,
  waiting,
  preview,
  onPress,
}: {
  group: TodayGroup;
  waiting: boolean;
  preview: string;
  onPress: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const Icon = group.icon;
  return (
    <Pressable
      testID={`staff.group.${group.key}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: space.m,
        gap: space.m,
        justifyContent: 'space-between',
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
      })}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: colors.gtint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={16} color={colors.gstrong} />
        </View>
        {/* No page count (owner, 2026-10-01); an amber dot says something in
            the group is waiting on the person. */}
        {waiting ? (
          <View
            testID={`staff.group.${group.key}.waiting`}
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ambtext }}
          />
        ) : null}
      </View>
      <View style={{ gap: 2 }}>
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.display800,
            fontSize: 14.5,
            lineHeight: 19,
            // Always two lines tall, so a one-line title ("Daily work") makes
            // the same tile as a two-line one: every tile is one size.
            minHeight: 38,
            color: colors.ink,
          }}
        >
          {t(group.titleKey)}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}
        >
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

/** One of the account's three buttons: an icon tile over a short name. */
function AccountButton({
  testID,
  icon: Icon,
  label,
  warn,
  busy,
  onPress,
}: {
  testID: string;
  icon: ComponentType<IconProps>;
  label: string;
  warn?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 7,
        paddingVertical: space.m,
        paddingHorizontal: 6,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 14,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: warn ? colors.amb : colors.gtint,
        }}
      >
        <Icon size={16} color={warn ? colors.ambtext : colors.gstrong} />
      </View>
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ink, textAlign: 'center' }}
      >
        {label}
      </Text>
    </Pressable>
  );
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
          {todos.map((list, i) => (
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

/**
 * A group's pages in a bottom sheet of our own, on Android only: the native
 * formSheet (app/staff-group.tsx, iOS) never opened there. The pattern is the
 * country picker's (src/components/phone.tsx): a scrim that fades in place
 * behind a sheet that slides up, both closed by the scrim, the back button or
 * a row. The modal sits outside the app's direction root, so it takes `dir`.
 */
function GroupModal({
  group,
  label,
  onClosed,
  onOpen,
}: {
  group: TodayGroup | null;
  label: (row: StaffRowDef) => string;
  onClosed: () => void;
  onOpen: (row: StaffRowDef) => void;
}) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [shown] = useState(() => new Animated.Value(0));
  const duration = reduceMotion ? 0 : 240;

  useEffect(() => {
    if (!group) return;
    shown.setValue(0);
    Animated.timing(shown, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [group, duration, shown]);

  const close = () =>
    Animated.timing(shown, {
      toValue: 0,
      duration: reduceMotion ? 0 : 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClosed());

  return (
    <Modal
      visible={group !== null}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View style={{ flex: 1, direction: dir, justifyContent: 'flex-end' }}>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            start: 0,
            end: 0,
            bottom: 0,
            backgroundColor: brand.scrim,
            opacity: shown,
          }}
        >
          <Pressable
            testID="staff.sheet.scrim"
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={close}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <Animated.View
          style={{
            maxHeight: '85%',
            backgroundColor: colors.bg,
            borderTopStartRadius: radius.sheet,
            borderTopEndRadius: radius.sheet,
            transform: [
              { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) },
            ],
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingTop: space.s,
              paddingStart: space.l,
              paddingEnd: space.l,
              paddingBottom: space.xl + insets.bottom,
              gap: space.m,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 36,
                height: 5,
                borderRadius: 3,
                backgroundColor: colors.line,
              }}
            />
            {group ? (
              <>
                <Text style={{ fontFamily: fonts.display800, fontSize: 19, color: colors.ink }}>
                  {t(group.titleKey)}
                </Text>
                <View testID="staff.sheet.list">
                  <GroupRows group={group} label={label} onOpen={onOpen} />
                </View>
              </>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function TodayScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, venueId, venues, setVenueId } = useStaffStatus();
  const alerts = useWorkAlerts();
  const toast = useToast();
  const out = useStaffSignOut();
  const { groups, label, waiting } = useTodayGroups();
  // Android's group sheet (GroupModal); iOS routes to the native one.
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const sheetGroup = groups.find((g) => g.key === sheetKey) ?? null;

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

  // Work alerts: until push is allowed the button asks for it (the only
  // prompting call in the staff area), and once refused it opens the system
  // settings, the one place it can be turned back on.
  const alertsOff = alerts.state === 'undetermined' || alerts.state === 'denied';
  const onAlerts = () => {
    if (alerts.state === 'undetermined') void alerts.enable();
    else void Linking.openSettings().catch(() => {});
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: space.l,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        showsVerticalScrollIndicator={false}
        // The page does not scroll or bounce (owner, 2026-10-01): it fits the
        // screen, and only a long work list on a small phone makes it move.
        // No pull to refresh, then; the queries refetch when the app comes
        // back to the foreground (src/lib/queryClient.ts).
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
      >
        {/* The room under the greeting is the room the old "Nothing is
            waiting on you" line took, kept now that the line is gone. */}
        <View style={{ gap: 2, marginBottom: space.xxl + space.sm }}>
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 24,
              lineHeight: 30,
              color: colors.ink,
            }}
          >
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

        {/* The work list: today's checklists first, then what waits on the
            person to decide, their open steps, what they sent and what was
            decided (my_checklists_today, my_protocol_work), at `venueId`. */}
        {venueId ? <TodayChecklists venueId={venueId} /> : null}
        {venueId ? <WorkList venueId={venueId} /> : null}

        {/* Two tiles a row, each a fixed share of the width: a lone last tile
            keeps the same size as the rest instead of stretching. */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            rowGap: space.s,
          }}
        >
          {groups.map((group) => (
            <View key={group.key} style={{ width: '48.5%', flexDirection: 'row' }}>
              <GroupTile
                group={group}
                waiting={waiting(group)}
                preview={group.rows.map(label).join(', ')}
                onPress={() =>
                  Platform.OS === 'ios'
                    ? router.push({ pathname: '/staff-group', params: { group: group.key } })
                    : setSheetKey(group.key)
                }
              />
            </View>
          ))}
        </View>

        {/* The account and sign-out sit at the foot of the page: pushed to the
            bottom of the screen when the page is short, after the tiles when it
            scrolls. */}
        <View style={{ marginTop: 'auto', paddingTop: space.m, gap: space.sm }}>
          <View style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.shell.account.title')}</MicroLabel>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <AccountButton
                testID={
                  alerts.state === 'undetermined'
                    ? 'staff.alerts.enable'
                    : alerts.state === 'denied'
                      ? 'staff.alerts.open-settings'
                      : 'staff.alerts.on'
                }
                icon={BellIcon}
                label={t('staff.shell.account.alerts')}
                warn={alertsOff}
                busy={alerts.busy}
                onPress={onAlerts}
              />
              {/* The guest app as a guest sees it (guestPreview.ts); a pill over
                the tabs comes back here. The toast says it is live, not a demo. */}
              <AccountButton
                testID="staff.guest-view"
                icon={EyeIcon}
                label={t('staff.shell.guestView.tile')}
                onPress={() => {
                  setGuestPreview(true);
                  toast(t('staff.shell.guestView.note'), 'info');
                  router.replace('/(tabs)');
                }}
              />
              <AccountButton
                testID="staff.settings"
                icon={SlidersIcon}
                label={t('settings.title')}
                onPress={() => router.push('/settings')}
              />
            </View>
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
        </View>
      </ScrollView>
      {Platform.OS === 'ios' ? null : (
        <GroupModal
          group={sheetGroup}
          label={label}
          onClosed={() => setSheetKey(null)}
          onOpen={(row) => {
            setSheetKey(null);
            router.push(row.href);
          }}
        />
      )}
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
