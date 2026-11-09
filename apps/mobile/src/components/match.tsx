/**
 * The open-match building blocks (docs/design/open-matches/guest.md §4.9,
 * §4.12–§4.18): the green hero with the flat court under the join court's rackets, the grouped list and the sheets, the list row, the
 * organiser's request row, the quick messages, the money card, the rules, the
 * restricted link card and the one-time gender ask.
 *
 * PRESENTATION ONLY. Every string arrives formatted or is a catalog key; the
 * server decided who may do what (`me.can`, `seats[].can`) and the screens
 * pass those answers in. Nothing here prices, permits or refuses.
 *
 * TEST IDS. Each wrapper that renders a Pressable (`SeatGrid`, `RequestRow`,
 * `QuickMessageBar`, `GenderAsk`, `MatchRow`, `MatchCourtCard`, `MatchRulesCard`,
 * `MatchRestrictedCard`) takes a REQUIRED `testID` from its call site and
 * forwards `${testID}.<child>` explicitly; all eight are in `testIdElements`
 * (packages/config/src/eslint.js). `MatchPoster`, `MatchMoneyCard` and
 * `MatchMessages` render no Pressable. The seat menu and the cancel reason
 * use the shared native sheet, `components/nativeChoice.ts`.
 */
import { Children, isValidElement, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { wallTimeToUtc } from '@touch/core';
import { projectTop, TOP_VIEW } from '@touch/court3d/camera';
import { seatSpot } from '@touch/court3d/join';
import {
  formatDayNumber,
  formatMonthShort,
  formatWeekdayShort,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { addDays, DEFAULT_TZ, type VenueSettingsPublic } from '../features/availability/assemble';
import {
  categoryKey,
  courtPlaces,
  displaySeat,
  MESSAGE_CODES,
  SEATS_TOTAL,
  tradingNightOf,
  type MatchCategory,
  type MatchSeat,
  type MessageCode,
} from '../features/matches/logic';
import { GENDER_SURVEY_HREF } from '../features/playProfile/links';
import { CourtStage, topStageFor } from './CourtStage';
import { Button } from './ui';
import { CheckIcon, ChevronIcon, PlusIcon } from './icons';

// ── Branch knobs and trading nights ─────────────────────────────────────────

/** What the match screens read from a branch's `venue_settings_public` row (0257 adds the two match knobs). */
export type MatchBranchRow = Pick<
  VenueSettingsPublic,
  'matches_enabled' | 'match_fill_deadline_minutes' | 'timezone' | 'opening_hours' | 'phone'
>;

/**
 * The trading night a match belongs to, as the lists and the poster name it
 * (§4.12): "Tonight", "Tomorrow", else "Thu 3 Oct". A 00:30 start belongs to
 * the night before (`tradingNightOf`), and so does "now" at 00:30.
 */
export function nightLabel(
  startAt: string,
  settings: MatchBranchRow | null,
  nowMs: number,
  t: (key: MessageKey, params?: TParams) => string,
  locale: Locale,
): string {
  const tz = settings?.timezone ?? DEFAULT_TZ;
  const knobs = settings ?? {};
  const night = tradingNightOf(startAt, knobs);
  const today = tradingNightOf(new Date(nowMs), knobs);
  if (night === today) return t('matches.list.tonight');
  if (night === addDays(today, 1)) return t('matches.list.tomorrow');
  const noon = wallTimeToUtc(night, 12 * 60, tz);
  return t('matches.list.day', {
    weekday: formatWeekdayShort(noon, locale, tz),
    day: formatDayNumber(noon, locale, tz),
    month: formatMonthShort(noon, locale, tz),
  });
}

// ── Small pieces ────────────────────────────────────────────────────────────

/** The category pill: "Open to all" / "Women only" / "Men only". */
export function CategoryPill({ category }: { category: MatchCategory }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: colors.tint,
        borderRadius: radius.pill,
        paddingStart: 9,
        paddingEnd: 9,
        paddingTop: 3,
        paddingBottom: 3,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.blue }}>
        {t(categoryKey(category))}
      </Text>
    </View>
  );
}

/** Four dots, the taken ones filled (the list row; no names, GD-5). */
export function SeatDots({ taken, total = SEATS_TOTAL }: { taken: number; total?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessible={false}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: i < taken ? colors.gstrong : 'transparent',
            borderWidth: 1.5,
            borderColor: i < taken ? colors.gstrong : colors.line2,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The header's share glyph (§4.14 Header); the screen owns the button and its
 * id. Each platform's own: iOS draws the system's `square.and.arrow.up` (the
 * SVG below is its fallback), Android Material's "share" node graph.
 */
export function ShareGlyph({ color, size = 20 }: { color: string; size?: number }) {
  const outline = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path
        d="M12 15V4M8 8l4-4 4 4M6 11.5v7.5h12v-7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name="square.and.arrow.up"
        size={size}
        weight="medium"
        tintColor={color}
        fallback={outline}
      />
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"
        fill={color}
      />
    </Svg>
  );
}

function MoreGlyph({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle cx={6} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={18} cy={12} r={1.8} fill={color} />
    </Svg>
  );
}

// ── MatchPoster (§4.14 item 1; the court-hero layout, 2026-10-10) ───────────

// ── The court drawing (the list card and the match screen) ──────────────────

/**
 * A padel court drawn to its 2:1: the walls, the service lines a quarter in
 * from each end, the centre line between them and the net with its posts.
 * Whatever stands on it is `children`, placed by fractions of the same box.
 *
 * `bare` is just the field (the match screen): no walls round it, no padding,
 * no posts at the ends of the net, and the turf's own corners rounded, so the
 * lines run out to the edge of the turf. Its service lines run through the
 * middle of the open-seat spots (`SERVICE_LINE_AT`), as the old court's did.
 */
function CourtLines({
  pad,
  bare = false,
  children,
}: {
  pad: number;
  bare?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const line = colors.crtLine;
  const net = colors.crtShadow;
  const service = bare ? SERVICE_LINE_AT : '24%';
  return (
    <View
      style={{
        backgroundColor: colors.crtTurf,
        borderRadius: bare ? radius.card : radius.cell,
        padding: bare ? 0 : pad,
        overflow: bare ? 'hidden' : 'visible',
      }}
    >
      <View style={{ aspectRatio: 2 }}>
        {bare ? null : (
          <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, borderWidth: 2, borderColor: line }} />
        )}
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: service, width: 2, marginStart: -1, backgroundColor: line }} />
        <View style={{ position: 'absolute', top: 0, bottom: 0, end: service, width: 2, marginEnd: -1, backgroundColor: line }} />
        <View style={{ position: 'absolute', top: '50%', start: service, end: service, height: 2, marginTop: -1, backgroundColor: line }} />
        <View
          style={{
            position: 'absolute',
            top: bare ? 0 : -5,
            bottom: bare ? 0 : -5,
            start: '50%',
            width: 3,
            marginStart: -1.5,
            backgroundColor: net,
          }}
        />
        {bare ? null : (
          <>
            <View style={{ position: 'absolute', top: -6, start: '50%', width: 7, height: 7, marginStart: -3.5, borderRadius: 2, backgroundColor: net }} />
            <View style={{ position: 'absolute', bottom: -6, start: '50%', width: 7, height: 7, marginStart: -3.5, borderRadius: 2, backgroundColor: net }} />
          </>
        )}
        {children}
      </View>
    </View>
  );
}

/** A taken seat's marker glyph on the list card's little court: a figure, never a name or a face. */
function SeatFigure({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} fill={color} />
      <Path d="M4 21c1-4.5 4.4-7 8-7s7 2.5 8 7" fill={color} />
    </Svg>
  );
}

/**
 * The app's own padel racket, rendered from the join court's scene
 * (scripts/render-racket.mjs), head to the left and handle toward the net. The
 * head sits `RACKET_HEAD_SHIFT` points off the picture's centre; a seat on the
 * court's right side shows it mirrored.
 */
const RACKET_IMAGE = require('../../assets/court/racket.png') as number;
const RACKET_SIZE = 64;
const RACKET_HEAD_SHIFT = 12.6;

/**
 * A taken seat's marker: that racket, its head on the seat, never a name or a
 * face. The viewer's own has a lime ring round its head.
 */
function SeatRacket({ size, mine, flip }: { size: number; mine: boolean; flip: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {mine ? (
        <View
          style={{
            position: 'absolute',
            width: size - 4,
            height: size - 4,
            borderRadius: (size - 4) / 2,
            borderWidth: 2.5,
            borderColor: brand.green,
          }}
        />
      ) : null}
      <Image
        source={RACKET_IMAGE}
        accessible={false}
        style={{
          position: 'absolute',
          width: RACKET_SIZE,
          height: RACKET_SIZE,
          transform: [{ translateX: flip ? -RACKET_HEAD_SHIFT : RACKET_HEAD_SHIFT }, { scaleX: flip ? -1 : 1 }],
        }}
      />
    </View>
  );
}

// ── The match's court (§4.14 item 1, §4.9) ──────────────────────────────────

const SEAT_SIZE = 44;
const SEAT_LABEL_WIDTH = 140;
/** The court's length in metres, which the join court's camera fits `TOP_VIEW.span` metres around. */
const COURT_METRES = 20;
/**
 * Where a bare court's service lines stand, in from each end: through the middle
 * of the open-seat spots, which the join court puts 6.05 m from the net.
 */
const SERVICE_LINE_AT = `${((0.5 - Math.abs(seatSpot(0, false).z) / COURT_METRES) * 100).toFixed(2)}%`;

/**
 * The match's court: the flat field (turf with round corners, the net, the
 * service lines), the join court's rackets over it, and the four seats' name
 * tags, menus and open spots in the page's own layer.
 *
 * The rackets are the Play tab's join court (packages/court3d, `join` scene) on
 * a TRANSPARENT surface with no field of its own (`overlay`): one racket per
 * taken seat, passing one ball between them as they do there. The court claims
 * a seat COUNT only, so the taken seats stand in seat order (`courtPlaces`).
 * The surface is framed so the scene's 20 m court lies exactly on the flat
 * one, and each seat's mark and menu target is laid where the scene's own
 * camera puts it (`projectTop`). A phone with no GL draws the same rackets as
 * a still picture (SeatRacket) on the same seats.
 *
 * Seat `n` is `${testID}.<n>`; a seat the viewer can act on (the server's
 * `seats[].can`, or the viewer's own friend seat) gets a menu button at
 * `${testID}.<n>.menu`, with a "•••" badge. Names are `displaySeat`'s ("Ahmed
 * K.", "Ahmed K. +1", "Former player", "Open seat · taking a player") or "Open
 * seat".
 */
export function MatchRallyCourt({
  testID,
  seats,
  category,
  hasMenu,
  onMenu,
}: {
  testID: string;
  seats: readonly MatchSeat[];
  category: MatchCategory;
  hasMenu?: (seat: MatchSeat) => boolean;
  onMenu?: (seat: MatchSeat, label: string) => void;
}) {
  const { t, dir } = useLocale();
  const mirror = dir === 'rtl';
  const { width: windowWidth } = useWindowDimensions();
  // Until the card is measured: the screen less the page's and the card's padding.
  const [laid, setLaid] = useState<number | null>(null);
  const width = laid ?? Math.max(0, windowWidth - 4 * space.m);
  const [glOff, setGlOff] = useState(false);
  const places = courtPlaces(seats);
  const taken = places.filter((p) => p !== null && !p.open).length;
  const frame = useMemo(() => {
    if (width <= 0) return null;
    // The stage is wider than the court by the camera's margin, centred on it.
    const stageWidth = (width * TOP_VIEW.span) / COURT_METRES;
    const stage = topStageFor(stageWidth, 6);
    const centre = (stage.height * (1 - TOP_VIEW.raise)) / 2;
    const points = [0, 1, 2, 3].map((place) => {
      const at = seatSpot(place, mirror);
      const px = projectTop({ x: at.x, y: 0, z: at.z }, stageWidth, stage.height);
      // `start` is the reading start: the right edge in Arabic. The court never flips.
      return { place, start: mirror ? stageWidth - px.x : px.x, top: px.y, onLeft: px.x < stageWidth / 2 };
    });
    return {
      stageWidth,
      height: stage.height,
      offset: (stageWidth - width) / 2,
      top: width / 4 - centre,
      points,
    };
  }, [width, mirror]);
  return (
    <View testID={testID} onLayout={(e) => setLaid(Math.round(e.nativeEvent.layout.width))}>
      <CourtLines pad={0} bare />
      {frame ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            start: -frame.offset,
            top: frame.top,
            width: frame.stageWidth,
            height: frame.height,
          }}
        >
          {glOff ? null : (
            <CourtStage
              overlay
              scene="join"
              join={{ taken, spots: false, mirror }}
              top={0}
              height={frame.height}
              onUnavailable={() => setGlOff(true)}
            />
          )}
          {frame.points.map((pt) => {
            const seat = places[pt.place] ?? null;
            const n = pt.place + 1;
            const label = seat ? displaySeat(seat, category, t, seats) : t('matches.common.openSeat');
            const menu = seat && onMenu && hasMenu?.(seat);
            return (
              <SeatSpot
                key={n}
                testID={`${testID}.${n}`}
                menuTestID={`${testID}.${n}.menu`}
                place={{ start: pt.start, top: pt.top }}
                label={label}
                seat={seat}
                flip={!pt.onLeft}
                racket={glOff}
                onMenu={menu ? () => onMenu(seat, label) : undefined}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A seat's name tag: navy with white type for a player (the viewer's own gets
 * "You" in front), white with blue type for an open seat. The flat grid and
 * the join court print the same tag.
 */
function SeatLabel({ label, taken, mine }: { label: string; taken: boolean; mine: boolean }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        maxWidth: SEAT_LABEL_WIDTH,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: taken ? colors.crtShadow : colors.card,
        borderRadius: radius.pill,
        paddingStart: 8,
        paddingEnd: 8,
        paddingTop: 2,
        paddingBottom: 2,
      }}
    >
      {mine ? (
        <Text style={{ fontFamily: fonts.body800, fontSize: 11, color: colors.gline }}>
          {t('matches.common.you')}
        </Text>
      ) : null}
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontFamily: fonts.body800,
          fontSize: 11,
          color: taken ? colors.crtLine : colors.blue,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function SeatSpot({
  testID,
  menuTestID,
  place,
  label,
  seat,
  flip,
  racket,
  onMenu,
}: {
  testID: string;
  menuTestID: string;
  place: { start: number; top: number };
  label: string;
  seat: MatchSeat | null;
  /** The still racket faces the net: mirrored on the court's right side. */
  flip: boolean;
  /** Draw the still racket on a taken seat (no GL court is drawing it). */
  racket: boolean;
  onMenu?: () => void;
}) {
  const { t } = useLocale();
  const { colors } = useTheme();
  const taken = seat !== null && !seat.open;
  const mine = seat?.isMe === true;
  const marker = (
    <View
      style={{
        width: SEAT_SIZE,
        height: SEAT_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        ...(taken
          ? null
          : {
              borderRadius: SEAT_SIZE / 2,
              backgroundColor: colors.card,
              borderWidth: 2.5,
              borderStyle: 'dashed' as const,
              borderColor: colors.blue,
            }),
      }}
    >
      {taken ? racket ? <SeatRacket size={SEAT_SIZE} mine={mine} flip={flip} /> : null : <PlusIcon size={18} color={colors.blue} strokeWidth={3} />}
      {onMenu ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            end: -6,
            width: 20,
            height: 20,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <MoreGlyph color={colors.mut} size={12} />
        </View>
      ) : null}
    </View>
  );
  return (
    <View
      testID={testID}
      style={{
        position: 'absolute',
        start: place.start,
        top: place.top,
        width: SEAT_LABEL_WIDTH,
        marginStart: -SEAT_LABEL_WIDTH / 2,
        marginTop: -SEAT_SIZE / 2,
        alignItems: 'center',
        gap: 4,
      }}
    >
      {onMenu ? (
        <Pressable
          testID={menuTestID}
          accessibilityRole="button"
          accessibilityLabel={t('matches.detail.seatMenu', { name: label })}
          hitSlop={6}
          onPress={onMenu}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {marker}
        </Pressable>
      ) : (
        marker
      )}
      <SeatLabel label={label} taken={taken} mine={mine} />
    </View>
  );
}

// ── MatchRow (§4.12, §4.16) ─────────────────────────────────────────────────

/**
 * One match in a list: time (and day), the category pill, four seat dots,
 * the seats-left phrase, a line (the share at the desk, or the guest's §4.15
 * state), the approve glyph when the organiser approves, "Court booked · a
 * seat opened" on a refill, and a "Your match" / "Asked" tag. No names
 * (GD-5). The whole row opens the match.
 */
export function MatchRow({
  testID,
  time,
  day,
  category,
  seatsTaken,
  seatsLeft,
  line,
  approve,
  refill,
  tag,
  highlight,
  onPress,
}: {
  testID: string;
  time: string;
  day?: string | null;
  category: MatchCategory;
  seatsTaken: number;
  /** The counted "1 seat left". */
  seatsLeft: string;
  line?: string | null;
  /** The organiser approves each player: the glyph, with its words for screen readers. */
  approve?: string | null;
  refill?: string | null;
  tag?: string | null;
  /** The `at` param of the list: this row is the time the guest came for. */
  highlight?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const label = [day, time, seatsLeft, line, approve, refill, tag].filter(Boolean).join(', ');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: highlight ? 1.5 : 1,
        borderColor: highlight ? colors.blue : colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.sm,
        paddingTop: 12,
        paddingBottom: 12,
      })}
    >
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: fonts.display900, fontSize: 17, color: colors.ink }}>
            {time}
          </Text>
          {day ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
              {day}
            </Text>
          ) : null}
          <CategoryPill category={category} />
          {approve ? (
            <View accessible accessibilityLabel={approve}>
              <CheckIcon size={14} color={colors.blue} strokeWidth={2.4} />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SeatDots taken={seatsTaken} />
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
            {seatsLeft}
          </Text>
        </View>
        {line ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut2 }}>
            {line}
          </Text>
        ) : null}
        {refill ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.ambtext }}>
            {refill}
          </Text>
        ) : null}
      </View>
      {tag ? (
        <View
          style={{
            backgroundColor: colors.gtint,
            borderRadius: radius.pill,
            paddingStart: 8,
            paddingEnd: 8,
            paddingTop: 3,
            paddingBottom: 3,
          }}
        >
          <Text style={{ fontFamily: fonts.body800, fontSize: 10.5, color: colors.gtext }}>
            {tag}
          </Text>
        </View>
      ) : null}
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

// ── MatchCourtCard (the open-matches list, 2026-10-10) ──────────────────────

/** Where the four players stand, as fractions of the court: two a side, on the service lines. */
const COURT_SPOTS = [
  { start: '24%', top: '25%' },
  { start: '24%', top: '75%' },
  { start: '76%', top: '25%' },
  { start: '76%', top: '75%' },
] as const;
const COURT_SPOT_SIZE = 36;

/**
 * One match in the open-matches list as a card around a top-down court: the
 * time, duration and category on top, the four players on the court (taken
 * seats a filled marker, open ones a dashed "+"), and the seats left, the
 * share at the desk and one action under it. No names (GD-5): a marker is a
 * seat, never a person. The whole card and its action both open the match;
 * the detail screen runs the join, its gate and the ticket continuation.
 */
export function MatchCourtCard({
  testID,
  time,
  duration,
  category,
  seatsTaken,
  seatsLeft,
  line,
  approve,
  refill,
  tag,
  action,
  highlight,
  onPress,
}: {
  testID: string;
  time: string;
  duration: string;
  category: MatchCategory;
  seatsTaken: number;
  /** The counted "1 seat left". */
  seatsLeft: string;
  line?: string | null;
  /** The organiser approves each player: a short `label`, and `a11y`, the words read out. */
  approve?: { label: string; a11y: string } | null;
  refill?: string | null;
  tag?: string | null;
  /** The action's label: Join, Ask to join, View. */
  action: string;
  /** The `at` param of the list: this card is the time the guest came for. */
  highlight?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const lastSeat = SEATS_TOTAL - seatsTaken === 1;
  const label = [time, duration, seatsLeft, line, approve?.a11y, refill, tag]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: highlight || tag ? 1.5 : 1,
        borderColor: highlight ? colors.blue : tag ? colors.gstrong : colors.line,
        borderRadius: radius.sheet,
        padding: 14,
        gap: 12,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontFamily: fonts.display900, fontSize: 22, color: colors.ink }}>{time}</Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>{duration}</Text>
        </View>
        {approve ? (
          <View
            accessible
            accessibilityLabel={approve.a11y}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
          >
            <CheckIcon size={12} color={colors.blue} strokeWidth={3} />
            <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.blue }}>
              {approve.label}
            </Text>
          </View>
        ) : null}
        {tag ? (
          <View
            style={{
              backgroundColor: colors.gtint,
              borderRadius: radius.pill,
              paddingStart: 8,
              paddingEnd: 8,
              paddingTop: 3,
              paddingBottom: 3,
            }}
          >
            <Text style={{ fontFamily: fonts.body800, fontSize: 11, color: colors.gtext }}>{tag}</Text>
          </View>
        ) : null}
        <CategoryPill category={category} />
      </View>

      <MatchCourt taken={seatsTaken} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontFamily: fonts.body800,
              fontSize: 14,
              color: lastSeat ? colors.ambstrong : colors.gtext,
            }}
          >
            {seatsLeft}
          </Text>
          {line ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>{line}</Text>
          ) : null}
          {refill ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.ambtext }}>{refill}</Text>
          ) : null}
        </View>
        <Button
          testID={`${testID}.action`}
          label={action}
          size="compact"
          variant={tag ? 'secondary' : 'primary'}
          onPress={onPress}
          style={{ paddingStart: 18, paddingEnd: 18 }}
        />
      </View>
    </Pressable>
  );
}

/**
 * The card's court, drawn to a padel court's 2:1: the walls, the service
 * lines, the centre line between them and the net with its posts, then a
 * marker per seat standing on its side's service line. Decoration: the card
 * reads the seats out in words.
 */
function MatchCourt({ taken }: { taken: number }) {
  const { colors } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      <CourtLines pad={8}>
        {COURT_SPOTS.map((spot, i) => {
          const filled = i < taken;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                start: spot.start,
                top: spot.top,
                width: COURT_SPOT_SIZE,
                height: COURT_SPOT_SIZE,
                marginStart: -COURT_SPOT_SIZE / 2,
                marginTop: -COURT_SPOT_SIZE / 2,
                borderRadius: COURT_SPOT_SIZE / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: filled ? colors.gstrong : colors.card,
                borderWidth: 2,
                borderStyle: filled ? 'solid' : 'dashed',
                borderColor: filled ? colors.crtLine : colors.blue,
              }}
            >
              {filled ? (
                <SeatFigure size={18} color={colors.crtLine} />
              ) : (
                <PlusIcon size={16} color={colors.blue} strokeWidth={3} />
              )}
            </View>
          );
        })}
      </CourtLines>
    </View>
  );
}

// ── RequestRow (§4.14 item 4, OM-41) ────────────────────────────────────────

/**
 * A pending request, for the organiser: "{name} · {games} at Touch ·
 * {noShows} · {seats}", Approve and Decline, and a menu (Report, Block).
 * A REQUESTER_INELIGIBLE answer keeps the row and shows its line under it;
 * Decline stays enabled.
 */
export function RequestRow({
  testID,
  name,
  line,
  error,
  busy,
  onApprove,
  onDecline,
  onMenu,
}: {
  testID: string;
  name: string;
  line: string;
  error?: string | null;
  busy?: 'approve' | 'decline' | null;
  onApprove: () => void;
  onDecline: () => void;
  onMenu?: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        padding: space.m,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>{name}</Text>
          <Text
            style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut2, marginTop: 2 }}
          >
            {line}
          </Text>
        </View>
        {onMenu ? (
          <Pressable
            testID={`${testID}.menu`}
            accessibilityRole="button"
            accessibilityLabel={t('matches.detail.seatMenu', { name })}
            hitSlop={8}
            onPress={onMenu}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <MoreGlyph color={colors.mut} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.redtext }}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={`${testID}.decline`}
          label={t('matches.detail.decline')}
          variant="secondary"
          size="compact"
          busy={busy === 'decline'}
          disabled={!!busy}
          onPress={onDecline}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.approve`}
          label={t('matches.detail.approve')}
          variant="cta"
          size="compact"
          busy={busy === 'approve'}
          disabled={!!busy || !!error}
          onPress={onApprove}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

// ── Quick messages (§4.17, OM-17) ───────────────────────────────────────────

const MESSAGE_LABEL: Record<MessageCode, MessageKey> = {
  on_my_way: 'matches.messages.onMyWay',
  running_late: 'matches.messages.runningLate',
  cant_make_it: 'matches.messages.cantMakeIt',
  bring_balls: 'matches.messages.bringBalls',
};

/** The words of a preset message. */
export function messageLabelKey(code: MessageCode): MessageKey {
  return MESSAGE_LABEL[code];
}

/**
 * The four preset chips, `${testID}.<code>`. No free text (OM-17). A chip
 * rests after a send (`resting`, GD-7); the server's `duplicate` and
 * RATE_LIMITED decide.
 */
export function QuickMessageBar({
  testID,
  codes = MESSAGE_CODES,
  resting,
  busy,
  onSend,
}: {
  testID: string;
  /** The presets to offer, in this order (the screen holds one back for now). */
  codes?: readonly MessageCode[];
  resting: ReadonlySet<MessageCode>;
  busy: MessageCode | null;
  onSend: (code: MessageCode) => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {codes.map((code) => {
        const disabled = resting.has(code) || busy !== null;
        return (
          <Pressable
            key={code}
            testID={`${testID}.${code}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, busy: busy === code }}
            disabled={disabled}
            onPress={() => onSend(code)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.sub : colors.card,
              borderRadius: radius.pill,
              paddingStart: 12,
              paddingEnd: 12,
              paddingTop: 8,
              paddingBottom: 8,
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
              {t(MESSAGE_LABEL[code])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The last 20 messages, oldest first: "{name} · {label} · {time}". */
export function MatchMessages({ lines }: { lines: readonly { key: string; text: string }[] }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  if (lines.length === 0) {
    return (
      <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
        {t('matches.messages.empty')}
      </Text>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {lines.map((l) => (
        <Text
          key={l.key}
          style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 }}
        >
          {l.text}
        </Text>
      ))}
    </View>
  );
}

// ── Money (§4.14 item 3, OM-45) ─────────────────────────────────────────────

/**
 * What a member owes and what their tickets do: "You pay {share} at the desk,
 * and your ticket comes back after you play", the tickets in this match, and
 * the reminder that a ticket is not the share. A linked desk seat holds no
 * ticket and shows the share line only.
 */
export function MatchMoneyCard({
  share,
  tickets,
  desk,
}: {
  /** The formatted share, or null when the server sent none. */
  share: string | null;
  /** The formatted count of the guest's tickets in this match. */
  tickets: string | null;
  desk: boolean;
}) {
  const { t } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  if (!share && (desk || !tickets)) return null;
  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.gtext2 };
  return (
    <View
      style={{
        backgroundColor: colors.gtint,
        borderWidth: 1,
        borderColor: colors.gline,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 4,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 12,
          letterSpacing: tracking(0.6),
          textTransform: 'uppercase',
          color: colors.gtext,
        }}
      >
        {t('matches.detail.moneyTitle')}
      </Text>
      {share ? (
        <Text style={body}>
          {desk
            ? t('matches.detail.moneyShareDesk', { share })
            : t('matches.detail.moneyShare', { share })}
        </Text>
      ) : null}
      {!desk && tickets ? (
        <>
          <Text style={body}>{t('matches.detail.moneyTickets', { count: tickets })}</Text>
          <Text style={body}>{t('matches.detail.moneyNote')}</Text>
        </>
      ) : null}
    </View>
  );
}

// ── MatchRulesCard (§4.10.1 rules + the court rule) ─────────────────────────

/** The wallet's seven rules (one copy, `matches.tickets.*`), then the court rule. */
const RULES: readonly MessageKey[] = [
  'matches.tickets.rule1',
  'matches.tickets.rule2',
  'matches.tickets.rule3',
  'matches.tickets.rule4',
  'matches.tickets.rule5',
  'matches.tickets.rule6',
  'matches.tickets.rule7',
  'matches.detail.courtRule',
];

/**
 * The numbered rules: the wallet's seven, then the court rule, with any `extra`
 * lines the caller puts first (the explanations that used to sit on the match
 * screen as hints).
 */
export function MatchRulesList({ extra = [] }: { extra?: readonly string[] }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const lines = [...extra, ...RULES.map((key) => t(key))];
  return (
    <View style={{ gap: 8 }}>
      {lines.map((line, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 13, color: colors.gtext }}>{i + 1}</Text>
          <Text
            style={{
              flex: 1,
              fontFamily: fonts.body400,
              fontSize: 13,
              lineHeight: 20,
              color: colors.mut2,
            }}
          >
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** "How open matches work", folded until the guest opens it (`${testID}.toggle`). */
export function MatchRulesCard({ testID }: { testID: string }) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID={`${testID}.toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: space.m,
          backgroundColor: pressed ? colors.sub : 'transparent',
        })}
      >
        <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: colors.ink }}>
          {t('matches.detail.rulesTitle')}
        </Text>
        {/* The chevron is mirrored in Arabic, so "open" turns it the other way to point down. */}
        <View
          testID={`${testID}.chevron`}
          style={{ transform: [{ rotate: open ? (dir === 'rtl' ? '-90deg' : '90deg') : '0deg' }] }}
        >
          <ChevronIcon size={16} color={colors.fnt2} />
        </View>
      </Pressable>
      {open ? (
        <View
          style={{ paddingStart: space.m, paddingEnd: space.m, paddingBottom: space.m, gap: 8 }}
        >
          <MatchRulesList />
        </View>
      ) : null}
    </View>
  );
}

// ── MatchRestrictedCard (§4.18, R32) ────────────────────────────────────────

/**
 * A link viewer who may not join (banned, the other gender, a block either
 * way): the day, time, branch and category from `match_invite` (no names),
 * the refusal's copy, and "Find another match" (`${testID}.find`). The card
 * itself is `${testID}.restricted`.
 */
export function MatchRestrictedCard({
  testID,
  when,
  branch,
  category,
  message,
  onFind,
}: {
  testID: string;
  when: string | null;
  branch: string | null;
  category: MatchCategory | null;
  message: string;
  onFind: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={`${testID}.restricted`}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: space.l,
        gap: 8,
      }}
    >
      <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>
        {t('matches.common.title')}
      </Text>
      {when ? (
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{when}</Text>
      ) : null}
      {branch ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut2 }}>
          {branch}
        </Text>
      ) : null}
      {category ? <CategoryPill category={category} /> : null}
      <View
        style={{
          backgroundColor: colors.amb,
          borderWidth: 1,
          borderColor: colors.ambline,
          borderRadius: radius.cell,
          padding: space.sm,
          marginTop: 4,
        }}
      >
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ambtext }}
        >
          {message}
        </Text>
      </View>
      <Button
        testID={`${testID}.find`}
        label={t('matches.link.findAnother')}
        variant="cta"
        onPress={onFind}
        style={{ marginTop: 4 }}
      />
    </View>
  );
}

// ── GenderAsk (§4.9, OM-28, DF-10) ──────────────────────────────────────────

/**
 * A women's or men's game needs the guest's gender, and the profile has none.
 * The question itself lives in the player questionnaire (app/play-survey.tsx,
 * 2026-10-12), so this only says why and opens it at the gender question
 * (`${testID}.answer`). The answer is `set_my_gender`, set once; the screen
 * behind re-reads the profile when the sheet saves.
 */
export function GenderAsk({ testID, error }: { testID: string; error?: string | null }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.tint,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        padding: space.m,
        gap: space.sm,
      }}
    >
      <Text
        style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 20, color: colors.ink }}
      >
        {t('matches.gender.ask')}
      </Text>
      {error ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.redtext }}>
          {error}
        </Text>
      ) : null}
      <Button
        testID={`${testID}.answer`}
        label={t('matches.gender.answer')}
        variant="secondary"
        size="compact"
        onPress={() => router.push(GENDER_SURVEY_HREF)}
      />
    </View>
  );
}

/** A notice block (refusal, banned, switched off): amber, not pressable. */
export function MatchNotice({ text, tone = 'amber' }: { text: string; tone?: 'amber' | 'red' }) {
  const { colors, fonts } = useTheme();
  const red = tone === 'red';
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: red ? colors.redtint : colors.amb,
        borderWidth: 1,
        borderColor: red ? colors.redline : colors.ambline,
        borderRadius: radius.button,
        padding: space.m,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body600,
          fontSize: 13,
          lineHeight: 19,
          color: red ? colors.redtext : colors.ambtext,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/** A group title inside a match screen: sentence case, large and bold. */
export function MatchSectionTitle({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontFamily: fonts.display800,
        fontSize: 17,
        lineHeight: 24,
        color: colors.ink,
        marginTop: space.xl,
        marginBottom: space.s,
        marginStart: 2,
      }}
    >
      {children}
    </Text>
  );
}

// ── The match screen's tidy-up (2026-11-07) ─────────────────────────────────

/** A grouped list, the iOS way: one card, a hairline between its rows. */
export function ListGroup({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, i) => (
        <View
          key={isValidElement(row) && row.key !== null ? row.key : i}
          style={{
            borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: colors.line,
          }}
        >
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * One row of a `ListGroup`: a bold label, then the value (or a control in
 * `accessory`) at the end. With `onPress` the whole row is a button, and
 * `chevron` says it opens something. `${testID}` is the row.
 */
export function ListRow({
  testID,
  label,
  value,
  accessory,
  onPress,
  chevron = false,
}: {
  testID: string;
  label: string;
  value?: string | null;
  accessory?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 52,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: 12,
        paddingBottom: 12,
      }}
    >
      <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        {accessory ??
          (value ? (
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.body600, fontSize: 14, color: colors.mut }}
            >
              {value}
            </Text>
          ) : null)}
      </View>
      {chevron ? <ChevronIcon size={16} color={colors.fnt2} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.sub : 'transparent' })}
    >
      {body}
    </Pressable>
  );
}

/**
 * A native sheet over the match: a page sheet on iOS, the whole screen on
 * Android. A title, Done (`${testID}.done`) and the body.
 */
export function MatchSheet({
  testID,
  visible,
  title,
  onClose,
  children,
}: {
  testID: string;
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <View testID={testID} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingStart: space.l,
            paddingEnd: space.l,
            paddingTop: Platform.OS === 'ios' ? space.l : insets.top + space.s,
            paddingBottom: space.sm,
          }}
        >
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display800, fontSize: 20, color: colors.ink }}>
            {title}
          </Text>
          <Pressable testID={`${testID}.done`} accessibilityRole="button" hitSlop={12} onPress={onClose}>
            <Text style={{ fontFamily: fonts.body800, fontSize: 16, color: colors.blue }}>{t('common.done')}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>{children}</View>
      </View>
    </Modal>
  );
}

/** One message in the chat: who, what and when, already formatted. */
export interface ChatBubble {
  key: string;
  name: string;
  mine: boolean;
  label: string;
  time: string;
}

/**
 * The match chat's body: the last messages as bubbles, a name above every one
 * (the viewer's own says "You"), and, when the viewer may speak, the presets
 * under them. No free text (OM-17).
 */
export function MatchChat({
  testID,
  bubbles,
  canSend,
  codes,
  resting,
  busy,
  onSend,
}: {
  testID: string;
  bubbles: readonly ChatBubble[];
  canSend: boolean;
  codes: readonly MessageCode[];
  resting: ReadonlySet<MessageCode>;
  busy: MessageCode | null;
  onSend: (code: MessageCode) => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroller}
        testID={`${testID}.list`}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.l, gap: space.sm, flexGrow: 1 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        {bubbles.length === 0 ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 14, color: colors.mut }}>
            {t('matches.messages.empty')}
          </Text>
        ) : null}
        {bubbles.map((b) => (
          <View
            key={b.key}
            // Your own messages sit at the end (an auto start margin, logical in both
            // directions); everyone else's at the start.
            style={{ maxWidth: '82%', alignSelf: 'flex-start', gap: 3, marginStart: b.mine ? 'auto' : 0 }}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut, marginStart: 6 }}>
              {b.name}
            </Text>
            <View
              style={{
                backgroundColor: b.mine ? brand.blue : colors.card,
                borderWidth: b.mine ? 0 : 1,
                borderColor: colors.line,
                borderRadius: 18,
                paddingStart: 14,
                paddingEnd: 14,
                paddingTop: 9,
                paddingBottom: 9,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body600,
                  fontSize: 15,
                  color: b.mine ? brand.white : colors.ink,
                }}
              >
                {b.label}
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.fnt, marginStart: 6 }}>
              {b.time}
            </Text>
          </View>
        ))}
      </ScrollView>
      {canSend ? (
        <View
          style={{
            gap: space.s,
            padding: space.l,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.line,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {t('matches.messages.sendHint')}
          </Text>
          <QuickMessageBar
            testID={`${testID}.send`}
            codes={codes}
            resting={resting}
            busy={busy}
            onSend={onSend}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The match's green card: the start time, the day and branch, the court, then
 * the seats left and the fill deadline. Black type on the brand green, in both
 * themes. An ended match's §4.15 line (`stateLine`) and the booked court
 * (`courtLine`) close it.
 */
export function MatchHero({
  time,
  endTime,
  when,
  seatsLine,
  fillLine,
  courtLine,
  stateLine,
  children,
}: {
  time: string;
  /** "to 19:30". */
  endTime?: string | null;
  /** "Tomorrow · Erbil · Men only". */
  when: string;
  seatsLine: string;
  fillLine?: { text: string; urgent: boolean } | null;
  courtLine?: string | null;
  stateLine?: string | null;
  children: ReactNode;
}) {
  const { dir } = useLocale();
  const { fonts } = useTheme();
  const rtl = dir === 'rtl';
  const ink = brand.greenInk;
  return (
    <View style={{ backgroundColor: brand.green, borderRadius: radius.card, padding: space.m, gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Text style={{ fontFamily: fonts.display900, fontSize: 40, lineHeight: rtl ? 56 : 46, color: ink }}>
            {time}
          </Text>
          {endTime ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 16, color: ink, opacity: 0.75 }}>{endTime}</Text>
          ) : null}
        </View>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: ink, opacity: 0.8 }}>{when}</Text>
      </View>
      {children}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: ink }}>{seatsLine}</Text>
        {fillLine ? (
          <Text
            style={{
              flexShrink: 1,
              fontFamily: fillLine.urgent ? fonts.body800 : fonts.body700,
              fontSize: 13,
              color: ink,
            }}
          >
            {fillLine.text}
          </Text>
        ) : null}
      </View>
      {courtLine ? <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: ink }}>{courtLine}</Text> : null}
      {stateLine ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: ink, opacity: 0.75 }}>{stateLine}</Text>
      ) : null}
    </View>
  );
}
