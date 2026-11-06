import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Text, MinFontSize, STAFF_MIN_FONT } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { mirror } from '../src/i18n/direction';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandPattern } from '../src/components/BrandPattern';
import { brand, radius, space, useTheme, withAlpha } from '../src/theme';
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
  ClockIcon,
  EyeIcon,
  SlidersIcon,
  StopwatchIcon,
  TitleSquiggle,
  TrophyIcon,
  type IconProps,
} from '../src/components/icons';
import { RequireStaff, useStaffSignOut } from '../src/features/staff/RequireStaff';
import { setGuestPreview } from '../src/features/staff/guestPreview';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { coachModeEntry, useCoachStatus } from '../src/features/coach/useCoachStatus';
import { greetingName } from '../src/features/staff/greetingName';
import { showsVenuePicker } from '../src/features/staff/venue';
import { useWaitingCount, useWorkAlerts } from '../src/features/staff/workAlerts';
import { GroupRows, useTodayGroups, type TodayGroup } from '../src/features/staff/todayGroups';
import type { StaffRowDef } from '../src/features/staff/rows';
import { fetchMyRewards } from '../src/features/staff/rewards/api';
import { RewardTrack } from '../src/features/staff/rewards/RewardTrack';
import { staffKeys } from '../src/features/staff/keys';
import { useReduceMotion } from '../src/lib/useReduceMotion';
import { useToast } from '../src/components/overlays';
import { AssistantButton } from '../src/features/assistant/AssistantFab';
import { useResetTo } from '../src/navigation/back';

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
 * app/(staff)/staff-work.tsx). Reached by
 * replacing, after a staff sign-in or from the tabs' gate, so there is nothing
 * to go back to: no header at all, since the page has no date to change.
 */

/**
 * Today's glass look (Sait, 2026-11-02): a gradient under the brand lines, the
 * tiles and the footer panel as solid cards, green rings on the icons. Every
 * colour is a palette token or the brand's, only the alpha is new.
 */
function useGlass() {
  const { colors, appearance } = useTheme();
  const dark = appearance === 'dark';
  return dark
    ? {
        dark,
        gradient: [colors.bg, colors.page, colors.seg] as const,
        ringFill: withAlpha(brand.green, 0.12),
        ringLine: withAlpha(brand.green, 0.4),
        ringFg: brand.green,
        dotOff: withAlpha(brand.white, 0.28),
        dotOn: brand.green,
      }
    : {
        dark,
        gradient: [colors.tint, colors.bg, colors.page] as const,
        ringFill: colors.gtint,
        ringLine: colors.gline,
        ringFg: colors.gstrong,
        dotOff: colors.fnt3,
        dotOn: brand.blue,
      };
}

/**
 * One group as a tile (or one page, as coach mode): its icon (with a red dot when a row in it is
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
  const { dir } = useLocale();
  const glass = useGlass();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        // Tight, so four rows of tiles, the dots and the foot panel fit a phone
        // that does not scroll.
        padding: 10,
        gap: 8,
        justifyContent: 'space-between',
        // The hero's card (Sait, 2026-11-02): a solid card with a soft shadow,
        // in both modes, over the glass page.
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOpacity: glass.dark ? 0.28 : 0.07,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      })}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View
          style={{
            // The chip's proportions at 30 (icon 15, corner 9), scaled to 34.
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: glass.ringFill,
            borderWidth: 1,
            borderColor: glass.ringLine,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={17} color={glass.ringFg} />
          {/* No page count (owner, 2026-10-01); a red dot on the icon's corner
              says something in the group is waiting on the person (red like
              the work alerts badge, owner, 2026-10-16). */}
          {waiting ? (
            <View
              testID={`${testID}.waiting`}
              style={{
                position: 'absolute',
                top: -5,
                end: -5,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: colors.danger,
                borderWidth: 2,
                borderColor: colors.card,
              }}
            />
          ) : null}
        </View>
        {/* The way in: a round arrow chip, mirrored under Arabic. */}
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: colors.tint,
            alignItems: 'center',
            justifyContent: 'center',
            ...mirror(dir),
          }}
        >
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <Path
              d="M7 17L17 7M8 7h9v9"
              stroke={glass.dark ? colors.ink : brand.blue}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </View>
      <View style={{ gap: 5 }}>
        {/* Always two lines tall, so a one-line title ("Daily work") makes the
            same tile as a two-line one: every tile is one size. The title sits
            at the foot of that box, so a short one stays next to its line
            instead of floating above a gap (Sait, 2026-11-02). */}
        <View style={{ minHeight: compact ? 36 : 38, justifyContent: 'flex-end' }}>
          <Text
            numberOfLines={2}
            style={{
              fontFamily: fonts.display800,
              fontSize: compact ? 14 : 14.5,
              lineHeight: compact ? 18 : 19,
              color: colors.ink,
            }}
          >
            {title}
          </Text>
        </View>
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
/** First page while the reward card shows: two rows (Saeed, 2026-11-06). */
const TILES_FIRST_PAGE_WITH_REWARD = 4;
/** Room round a swipe page for the tiles' shadows, which its ScrollView would clip. */
const SHADOW_ROOM = 24;

/**
 * Today's tiles, two a row, each a fixed share of the width: a lone last tile
 * keeps the same size as the rest instead of stretching. Up to eight fit one
 * page; more and the grid becomes pages swiped sideways, with a dot per page
 * under it (owner, 2026-10-08).
 */
function TilePages({
  tiles,
  firstPageSize = TILES_PER_PAGE,
  header,
}: {
  tiles: ReactElement[];
  /** The reward card: the top of the first page, so a swipe takes it along. */
  header?: ReactElement | null;
  /** Tiles on the first page: 4 (2x2) while the reward card takes the room above. */
  firstPageSize?: number;
}) {
  // Brand blue in light, brand green in dark (owner, 2026-10-11).
  const { colors } = useTheme();
  const glass = useGlass();
  const [width, setWidth] = useState(0);
  // The swipe's offset, followed live so the dots grow and fade with the finger
  // instead of jumping when the page settles.
  const [scrollX] = useState(() => new Animated.Value(0));

  const pages: ReactElement[][] = [];
  pages.push(tiles.slice(0, firstPageSize));
  for (let i = firstPageSize; i < tiles.length; i += TILES_PER_PAGE) {
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
        // A column, so the tile is stretched to exactly this width: in a row a
        // long preview line sized the tile instead and it ran over its neighbour.
        <View key={tile.key} style={{ width: '48.5%' }}>
          {tile}
        </View>
      ))}
    </View>
  );

  const withHeader = (pageIndex: number, pageTiles: ReactElement[]) =>
    pageIndex === 0 && header ? (
      <View style={{ gap: space.s }}>
        {header}
        {grid(pageTiles)}
      </View>
    ) : (
      grid(pageTiles)
    );

  if (pages.length <= 1) return withHeader(0, tiles);

  // A page is the grid plus the screen's gutter on each side, and the swipe
  // runs edge to edge: the tiles keep their size, slide out to the screen's
  // edge, and two pages pass with two gutters between them instead of touching.
  const pageWidth = width + 2 * space.l;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollX.setValue(e.nativeEvent.contentOffset.x);
  };

  return (
    <View testID="staff.tiles" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: space.s, flexGrow: 1 }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Pages are drawn once the width is known, so each is exactly one screen wide.
        // The pages carry SHADOW_ROOM above and below, taken back in the margin:
        // a ScrollView clips what it holds, and the tiles' soft shadows were cut
        // into a hard line at its edge.
        style={{
          marginHorizontal: -space.l,
          marginVertical: -SHADOW_ROOM,
          opacity: width > 0 ? 1 : 0,
        }}
      >
        {pages.map((pageTiles, i) => (
          <View
            key={i}
            testID={`staff.tiles.page.${i}`}
            style={{
              width: width ? pageWidth : undefined,
              paddingHorizontal: space.l,
              paddingVertical: SHADOW_ROOM,
            }}
          >
            {withHeader(i, pageTiles)}
          </View>
        ))}
      </ScrollView>
      <View
        testID="staff.tiles.dots"
        // Decoration: the pages themselves are what a screen reader walks.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        // The dots sit in a pill drawn like the tiles, so it reads on the page
        // and the background's lines never run through them.
        style={{
          alignSelf: 'center',
          // Pushed down to the foot of the grid's room, just above the account section.
          marginTop: 'auto',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: radius.pill,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        {pages.map((_, i) => {
          // One dot per page: the bar's width, colour and glow follow how far
          // the swipe is from that page, a whole page away being a plain dot.
          const at = [(i - 1) * pageWidth, i * pageWidth, (i + 1) * pageWidth];
          const along = (out: [number | string, number | string, number | string]) =>
            scrollX.interpolate({ inputRange: at, outputRange: out as never, extrapolate: 'clamp' });
          return (
            <Animated.View
              key={i}
              style={{
                width: along([6, 20, 6]),
                height: 6,
                borderRadius: 3,
                backgroundColor: along([glass.dotOff, glass.dotOn, glass.dotOff]),
                shadowColor: glass.dotOn,
                shadowOpacity: along([0, glass.dark ? 0.6 : 0, 0]),
                shadowRadius: 5,
                shadowOffset: { width: 0, height: 0 },
              }}
            />
          );
        })}
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
  const glass = useGlass();
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
        paddingVertical: 9,
        paddingHorizontal: 6,
        // The tiles' card: solid, thin border, soft shadow.
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOpacity: glass.dark ? 0.28 : 0.07,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        opacity: busy ? 0.6 : 1,
      })}
    >
      {/* The tiles' icon chip: a rounded square in a green ring (amber while
          the alerts are off). */}
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: warn ? colors.ambline : glass.ringLine,
          backgroundColor: warn ? colors.amb : glass.ringFill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={17} color={warn ? colors.ambtext : glass.ringFg} />
        {/* The count on the icon's corner, like the red dot on a tile's icon. */}
        {count > 0 ? (
          <View
            testID={`${testID}.badge`}
            style={{
              position: 'absolute',
              top: -11,
              end: -12,
              minWidth: 24,
              height: 24,
              paddingHorizontal: 3,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.danger,
              borderWidth: 2,
              borderColor: colors.card,
            }}
          >
            {/* Staff pages raise text to 12.5 pt (STAFF_MIN_FONT), more than the
                11 first set here, so the badge is sized for 12.5 with its own
                line height, centred both ways, and no font padding (Android). */}
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 12.5,
                lineHeight: 16,
                textAlign: 'center',
                textAlignVertical: 'center',
                includeFontPadding: false,
                color: brand.white,
              }}
            >
              {count > 99 ? '99+' : formatNumber(count, locale)}
            </Text>
          </View>
        ) : null}
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

/**
 * The person's reward track (0332), under the greeting: only when the owner
 * has set them a reward, so a page without one is unchanged. A read that fails
 * shows nothing; the rewards page says why.
 */
function TodayRewards({ venueId, staffId }: { venueId: string; staffId: string }) {
  const router = useRouter();
  const rewards = useQuery({
    queryKey: staffKeys.myRewards(venueId),
    queryFn: () => fetchMyRewards(venueId),
  });
  const data = rewards.data;
  if (!data || data.rewards.length === 0) return null;
  return (
    <RewardTrack
      testID="staff.rewards"
      data={data}
      staffId={staffId}
      venueId={venueId}
      onPress={() => router.push('/staff-rewards')}
    />
  );
}

function TodayScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const glass = useGlass();
  const router = useRouter();
  const resetTo = useResetTo();
  const insets = useSafeAreaInsets();
  const { status, venueId, venues, setVenueId } = useStaffStatus();
  // Same key as TodayRewards, so one fetch: the grid needs to know whether the
  // reward card is on the page to size its first page.
  const myRewards = useQuery({
    queryKey: staffKeys.myRewards(venueId ?? ''),
    queryFn: () => fetchMyRewards(venueId!),
    enabled: !!venueId,
  });
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
  // Android's group sheet (GroupModal); iOS routes to the native one.
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const sheetGroup = groups.find((g) => g.key === sheetKey) ?? null;

  // RequireStaff renders this only for a staff status.
  if (status.kind !== 'staff') return null;
  const { staff } = status;
  const hasReward =
    !!venueId && staff.role !== 'owner' && (myRewards.data?.rewards.length ?? 0) > 0;
  // Every role's page is drawn at the owner's size, a little tighter so the
  // grid fits a phone without scrolling (owner 2026-10-07: "bigger a bit";
  // one size for all roles, Sait 2026-11-02).
  const compact = true;

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
      {/* The glass page's ground: a gradient under the brand lines, full bleed
          behind everything. First child so every sibling paints over it;
          absolute children resolve against the padding box, so it runs under
          the safe-area inset and the side gutters too. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient colors={glass.gradient} style={StyleSheet.absoluteFill} />
        {/* The brand lines, thin as on the other pages, in translucent green. */}
        <BrandPattern />
      </View>
      <ScrollView
        // Full width, the gutter moved inside: a ScrollView clips what it holds,
        // so in the Screen's gutter the account card could not reach the edges.
        style={{ marginHorizontal: -space.l }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: space.l,
          paddingTop: compact ? space.sm : space.l,
          // The account card runs to the screen's foot and carries the inset itself.
          paddingBottom: 0,
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
        {/* On a card, so the brand lines do not run under the words: "Hello"
            and the short name, from the left edge, the role, the green stroke under them, and the
            assistant. The name is one line, cut with "…": a second line pushes
            the grid off the page. */}
        <Card
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.m,
            padding: space.sm,
            // The room under the greeting, the same for every role (Sait, 2026-11-02).
            marginBottom: space.s,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                fontFamily: fonts.display800,
                fontSize: 23,
                lineHeight: 28,
                color: colors.ink,
              }}
            >
              {t('staff.shell.today.greeting', { name: greetingName(staff.displayName) })}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}
            >
              {here ? t('staff.shell.today.roleAtVenue', { role, venue: here }) : role}
            </Text>
            {/* The green stroke under the whole header, as under a tab's title. */}
            <View style={{ alignItems: 'flex-start' }}>
              <TitleSquiggle />
            </View>
          </View>
          {/* The owner's assistant, here rather than floating over Sign out. */}
          <AssistantButton testID="staff.assistant.header" size={46} glass />
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
          firstPageSize={hasReward ? TILES_FIRST_PAGE_WITH_REWARD : TILES_PER_PAGE}
          // Rewards for orders placed: the owner sets them, so the owner has none.
          header={
            venueId && staff.role !== 'owner' ? (
              <TodayRewards venueId={venueId} staffId={staff.id} />
            ) : null
          }
          tiles={[
            ...groups.map((group) => (
              <GroupTile
                key={group.key}
                testID={`staff.group.${group.key}`}
                icon={group.icon}
                title={t(group.titleKey)}
                waiting={waiting(group)}
                preview={t(group.infoKey)}
                compact={compact}
                // A group of one page opens that page; a sheet of one row is a
                // wasted tap (owner, 2026-10-11).
                onPress={() =>
                  group.rows.length === 1
                    ? router.push(group.rows[0]!.href)
                    : Platform.OS === 'ios'
                      ? router.push({ pathname: '/staff-group', params: { group: group.key } })
                      : setSheetKey(group.key)
                }
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
            // The owner sets each person's rewards for orders placed (0332).
            ...(staff.role === 'owner'
              ? [
                  <GroupTile
                    key="rewards"
                    testID="staff.rewards-admin"
                    icon={TrophyIcon}
                    title={t('staff.rewards.admin.entry')}
                    waiting={false}
                    preview={t('staff.rewards.admin.entryPreview')}
                    compact={compact}
                    onPress={() => router.push('/staff-rewards-admin')}
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
            // The owner's activity monitor: who is on the operator and the phone (0341).
            ...(staff.role === 'owner'
              ? [
                  <GroupTile
                    key="activity"
                    testID="staff.activity"
                    icon={ClockIcon}
                    title={t('staff.activity.entry')}
                    waiting={false}
                    preview={t('staff.activity.entryPreview')}
                    compact={compact}
                    onPress={() => router.push('/staff-activity')}
                  />,
                ]
              : []),
          ]}
        />

        {/* The account and sign-out sit at the foot of the page: pushed to the
            bottom of the screen when the page is short, after the tiles when it
            scrolls. */}
        {/* A floating glass panel at the foot of the screen, clear of the home
            indicator: the account buttons and Sign out. */}
        <View
          style={{
            marginTop: 'auto',
            marginBottom: Math.max(insets.bottom - 8, space.sm),
            padding: 10,
            gap: space.s,
            borderRadius: 28,
            borderWidth: 1,
            borderColor: colors.line,
            // The tiles' card colour, so the panel matches them in both modes.
            backgroundColor: colors.card,
            shadowColor: '#000',
            shadowOpacity: glass.dark ? 0.3 : 0.08,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
          }}
        >
          {/* No "Account" heading: the three buttons say what they are, and the
              heading cost the page the room the cards needed. */}
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
                resetTo('/(tabs)');
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

          <ErrorText>{out.error}</ErrorText>
          <Button
            testID="staff.sign-out"
            label={t('auth.signOut')}
            variant="secondary"
            size={compact ? 'compact' : 'medium'}
            busy={out.busy}
            onPress={confirmSignOut}
            labelColor={colors.redtext}
            style={{ backgroundColor: 'transparent', borderColor: colors.line }}
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
    <RequireStaff page="staff">
      {/* Bigger text on the staff pages (Sait, 2026-10-17). */}
      <MinFontSize value={STAFF_MIN_FONT}>
        <TodayScreen />
      </MinFontSize>
    </RequireStaff>
  );
}
