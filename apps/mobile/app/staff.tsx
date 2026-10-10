import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Hint,
  MicroLabel,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import {
  BellIcon,
  CameraIcon,
  EyeIcon,
  SlidersIcon,
  StopwatchIcon,
  TitleSquiggle,
  type IconProps,
} from '../src/components/icons';
import { RequireStaff, useStaffSignOut } from '../src/features/staff/RequireStaff';
import { setGuestPreview } from '../src/features/staff/guestPreview';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { coachModeEntry, useCoachStatus } from '../src/features/coach/useCoachStatus';
import { showsVenuePicker } from '../src/features/staff/venue';
import { useWaitingCount, useWorkAlerts } from '../src/features/staff/workAlerts';
import { GroupRows, useTodayGroups, type TodayGroup } from '../src/features/staff/todayGroups';
import { GroupSheetIOS } from '../src/features/staff/GroupSheetIOS';
import type { StaffRowDef } from '../src/features/staff/rows';
import { useReduceMotion } from '../src/lib/useReduceMotion';
import { useToast } from '../src/components/overlays';
import { BrandPattern } from '../src/components/BrandPattern';
import { AssistantButton } from '../src/features/assistant/AssistantFab';

/**
 * Today: the staff phone's home (build-contracts-2026-09-23 §6.1; layout:
 * owner, 2026-10-01, design option A).
 *
 * Top to bottom: who and where, the venue picker (only with more than one
 * venue), the pages this role has as a grid of group tiles
 * (todayGroups.ts; a tile opens its rows in a sheet, GroupModal below) with
 * coach mode and the owner's screenshots as tiles that open their page, and
 * the account as three buttons: work alerts, guest view, Settings. Today's
 * checklists and the work list moved behind the work alerts button, which
 * badges how much of it waits on the person (owner, 2026-10-10;
 * app/staff-work.tsx). Reached by
 * replacing, after a staff sign-in or from the tabs' gate, so there is nothing
 * to go back to: no header at all, since the page has no date to change.
 */

/**
 * One group as a tile (or one page, as coach mode): its icon (with an amber dot when a row in it is
 * waiting on the person), the title and a one-line preview of its pages.
 */
function GroupTile({
  testID,
  icon: Icon,
  title,
  waiting,
  preview,
  compact,
  onPress,
}: {
  testID: string;
  icon: ComponentType<IconProps>;
  title: string;
  waiting: boolean;
  preview: string;
  /** The owner's Today: a little tighter than the others, so the page fits without scrolling. */
  compact?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: compact ? space.sm : space.m,
        gap: compact ? 10 : space.m,
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
            width: compact ? 30 : 32,
            height: compact ? 30 : 32,
            borderRadius: compact ? 9 : 10,
            backgroundColor: colors.gtint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={compact ? 15 : 16} color={colors.gstrong} />
        </View>
        {/* No page count (owner, 2026-10-01); an amber dot says something in
            the group is waiting on the person. */}
        {waiting ? (
          <View
            testID={`${testID}.waiting`}
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ambtext }}
          />
        ) : null}
      </View>
      <View style={{ gap: 2 }}>
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.display800,
            fontSize: compact ? 14 : 14.5,
            lineHeight: compact ? 18 : 19,
            // Always two lines tall, so a one-line title ("Daily work") makes
            // the same tile as a two-line one: every tile is one size.
            minHeight: compact ? 36 : 38,
            color: colors.ink,
          }}
        >
          {title}
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

/** Tiles on one page of the grid: two a row, four rows (owner, 2026-10-08). */
const TILES_PER_PAGE = 8;

/**
 * Today's tiles, two a row, each a fixed share of the width: a lone last tile
 * keeps the same size as the rest instead of stretching. Up to eight fit one
 * page; more and the grid becomes pages swiped sideways, with a dot per page
 * under it (owner, 2026-10-08).
 */
function TilePages({ tiles }: { tiles: ReactElement[] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);

  const pages: ReactElement[][] = [];
  for (let i = 0; i < tiles.length; i += TILES_PER_PAGE) {
    pages.push(tiles.slice(i, i + TILES_PER_PAGE));
  }

  const grid = (pageTiles: ReactElement[]) => (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: space.s,
      }}
    >
      {pageTiles.map((tile) => (
        <View key={tile.key} style={{ width: '48.5%', flexDirection: 'row' }}>
          {tile}
        </View>
      ))}
    </View>
  );

  if (pages.length <= 1) return grid(tiles);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View testID="staff.tiles" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: space.s }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        // Pages are drawn once the width is known, so each is exactly one screen wide.
        style={{ opacity: width > 0 ? 1 : 0 }}
      >
        {pages.map((pageTiles, i) => (
          <View key={i} testID={`staff.tiles.page.${i}`} style={{ width: width || undefined }}>
            {grid(pageTiles)}
          </View>
        ))}
      </ScrollView>
      <View
        testID="staff.tiles.dots"
        // Decoration: the pages themselves are what a screen reader walks.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}
      >
        {pages.map((_, i) => (
          <View
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: i === Math.min(page, pages.length - 1) ? colors.gstrong : colors.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** One of the account's buttons: an icon tile over a short name. */
function AccountButton({
  testID,
  icon: Icon,
  label,
  warn,
  busy,
  compact,
  badge,
  onPress,
}: {
  testID: string;
  icon: ComponentType<IconProps>;
  label: string;
  warn?: boolean;
  busy?: boolean;
  compact?: boolean;
  /** How much waits behind the button: a red count on its corner when above zero. */
  badge?: number;
  onPress: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const count = badge ?? 0;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0 ? `${label}, ${t('staff.shell.work.badge', { count })}` : label
      }
      accessibilityState={{ busy: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        position: 'relative',
        alignItems: 'center',
        gap: compact ? 6 : 7,
        paddingVertical: compact ? 11 : space.m,
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
          width: compact ? 32 : 34,
          height: compact ? 32 : 34,
          borderRadius: compact ? 10 : 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: warn ? colors.amb : colors.gtint,
        }}
      >
        <Icon size={compact ? 15 : 16} color={warn ? colors.ambtext : colors.gstrong} />
      </View>
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ink, textAlign: 'center' }}
      >
        {label}
      </Text>
      {count > 0 ? (
        <View
          testID={`${testID}.badge`}
          style={{
            position: 'absolute',
            top: -6,
            end: -6,
            minWidth: 22,
            height: 22,
            paddingHorizontal: 6,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.danger,
            borderWidth: 2,
            borderColor: colors.bg,
          }}
        >
          <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: brand.white }}>
            {count > 99 ? '99+' : formatNumber(count, locale)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * A group's pages in a bottom sheet of our own, on Android: the native
 * formSheet never opened there. iOS shows the same header and rows in a
 * native sheet (GroupSheetIOS) that closes with a swipe down. The pattern is the
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
          {/* The grabber and the title stay put; only the rows scroll. */}
          <View
            style={{
              paddingTop: space.m,
              paddingStart: space.l,
              paddingEnd: space.l,
              paddingBottom: space.m,
              gap: space.m,
            }}
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
              <Text style={{ fontFamily: fonts.display800, fontSize: 19, color: colors.ink }}>
                {t(group.titleKey)}
              </Text>
            ) : null}
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{
              paddingStart: space.l,
              paddingEnd: space.l,
              paddingBottom: space.xl + insets.bottom,
            }}
            showsVerticalScrollIndicator={false}
          >
            {group ? (
              <View testID="staff.sheet.list">
                <GroupRows group={group} label={label} onOpen={onOpen} />
              </View>
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
  // C-27, R45: the hub reads coach_me on mount, like Profile, whatever the
  // staff status and the coaching switches say.
  const coachEntry = coachModeEntry(useCoachStatus({ read: true }).status);
  // Kept here as well as on the work alerts page: Today's foreground probe is
  // what registers the push token once alerts are allowed.
  const alerts = useWorkAlerts();
  const waitingCount = useWaitingCount(venueId);
  const toast = useToast();
  const out = useStaffSignOut();
  const { groups, label, waiting } = useTodayGroups();
  // The group sheet: GroupSheetIOS on iOS, GroupModal on Android.
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const sheetGroup = groups.find((g) => g.key === sheetKey) ?? null;

  // RequireStaff renders this only for a staff status.
  if (status.kind !== 'staff') return null;
  const { staff } = status;
  // The owner's page carries one more control (the assistant) and the most
  // pages; it is drawn a little tighter so it fits a phone without scrolling
  // (first cut too small, owner 2026-10-07: "bigger a bit").
  const compact = staff.role === 'owner';

  const venueName = (id: string | null) => {
    const venue = venues.find((v) => v.id === id);
    if (!venue) return null;
    if (locale !== 'ar') return venue.name_en;
    // The venue row can carry the Latin brand in name_ar; the house spelling
    // in Arabic is تتش بادل.
    return venue.name_ar.replace(/touch\s*padel/i, 'تتش بادل');
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

  // Amber while push is off; the page it opens asks for it.
  const alertsOff = alerts.state === 'undetermined' || alerts.state === 'denied';

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {/* The brand line pattern the Book tab stands on, full bleed behind the
          page. First child so every sibling paints over it; absolute children
          resolve against the padding box, so it runs under the safe-area inset
          and the side gutters too. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <BrandPattern />
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: compact ? space.sm : space.l,
          paddingBottom: (compact ? 20 : 40) + insets.bottom,
          gap: compact ? 10 : space.sm,
        }}
        showsVerticalScrollIndicator={false}
        // The page does not scroll or bounce (owner, 2026-10-01; scrolling
        // turned off entirely, 2026-10-09): it fits the screen. No pull to
        // refresh, then; the queries refetch when the app comes back to the
        // foreground (src/lib/queryClient.ts).
        scrollEnabled={false}
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
      >
        {/* The room under the greeting is the room the old "Nothing is
            waiting on you" line took, kept now that the line is gone. On a
            card so the brand pattern does not run under the words. */}
        <Card
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.m,
            padding: compact ? space.m : space.l,
            marginBottom: compact ? space.sm : space.xxl + space.sm,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: compact ? 23 : 24,
                lineHeight: compact ? 28 : 30,
                color: colors.ink,
              }}
            >
              {t('staff.shell.today.greeting', { name: staff.displayName })}
            </Text>
            <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>
              {here ? t('staff.shell.today.roleAtVenue', { role, venue: here }) : role}
            </Text>
            {/* The green stroke under the whole header, as under a tab's title. */}
            <View style={{ alignItems: 'flex-start' }}>
              <TitleSquiggle />
            </View>
          </View>
          {/* The owner's assistant, here rather than floating over Sign out. */}
          <AssistantButton testID="staff.assistant.header" size={40} labelled />
        </Card>

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

        <TilePages
          tiles={[
            ...groups.map((group) => (
              <GroupTile
                key={group.key}
                testID={`staff.group.${group.key}`}
                icon={group.icon}
                title={t(group.titleKey)}
                waiting={waiting(group)}
                preview={group.rows.map(label).join(', ')}
                compact={compact}
                onPress={() => setSheetKey(group.key)}
              />
            )),
            // Staff who coach reach coach mode here (coaching C-27, R45): the
            // tabs, and Profile with them, are out of reach for a staff
            // session. A retired coach keeps the statements (C-25). A tile in
            // the grid, opening its page straight away (owner, 2026-10-08).
            ...(coachEntry
              ? [
                  <GroupTile
                    key="coach-mode"
                    testID="staff.coach-mode"
                    icon={StopwatchIcon}
                    title={t(
                      coachEntry === '/coach-mode'
                        ? 'staff.shell.coachMode'
                        : 'staff.shell.coachStatements',
                    )}
                    waiting={false}
                    preview={t(
                      coachEntry === '/coach-mode'
                        ? 'staff.shell.coachModePreview'
                        : 'staff.shell.coachStatementsPreview',
                    )}
                    compact={compact}
                    onPress={() => router.push(coachEntry)}
                  />,
                ]
              : []),
            // The owner's list of staff screenshots (StaffScreenGuard reports them).
            ...(staff.role === 'owner'
              ? [
                  <GroupTile
                    key="screenshots"
                    testID="staff.screenshots"
                    icon={CameraIcon}
                    title={t('staff.screenshots.entry')}
                    waiting={false}
                    preview={t('staff.screenshots.entryPreview')}
                    compact={compact}
                    onPress={() => router.push('/staff-screenshots')}
                  />,
                ]
              : []),
          ]}
        />

        {/* The account and sign-out sit at the foot of the page: pushed to the
            bottom of the screen when the page is short, after the tiles when it
            scrolls. */}
        <Card
          style={{
            marginTop: 'auto',
            padding: compact ? space.m : space.l,
            gap: compact ? 10 : space.sm,
          }}
        >
          <View style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.shell.account.title')}</MicroLabel>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <AccountButton
                testID="staff.alerts"
                icon={BellIcon}
                label={t('staff.shell.account.alerts')}
                warn={alertsOff}
                badge={waitingCount}
                compact={compact}
                onPress={() => router.push('/staff-work')}
              />
              {/* The guest app as a guest sees it (guestPreview.ts); a pill over
                the tabs comes back here. The toast says it is live, not a demo. */}
              <AccountButton
                testID="staff.guest-view"
                icon={EyeIcon}
                label={t('staff.shell.guestView.tile')}
                compact={compact}
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
                compact={compact}
                onPress={() => router.push('/settings')}
              />
            </View>
          </View>

          <ErrorText>{out.error}</ErrorText>
          <Button
            testID="staff.sign-out"
            label={t('auth.signOut')}
            variant="secondary"
            size={compact ? 'compact' : 'medium'}
            busy={out.busy}
            onPress={confirmSignOut}
            style={{ backgroundColor: 'transparent' }}
          />
        </Card>
      </ScrollView>
      {/* iOS takes the native sheet, which closes with a swipe down; Android
          the sheet below. Same header and rows on both. */}
      {Platform.OS === 'ios' ? (
        <GroupSheetIOS
          groups={groups}
          openKey={sheetKey}
          label={label}
          onClosed={() => setSheetKey(null)}
          onOpen={(row) => router.push(row.href)}
        />
      ) : (
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
