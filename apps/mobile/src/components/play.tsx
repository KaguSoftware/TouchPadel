/**
 * The Play tab's building blocks (docs/design/play-coaches/contracts-2026-10-11.md
 * §7): the pitched-court hero, the "Start a match" pill, a night's heading, the
 * time rail every entry hangs from, the open-match card, the tournament card and
 * the inline "could not load" row.
 *
 * THE BOOK PAGE'S VOCABULARY, CARRIED OVER. The hero is the Book tab's own 3D
 * court (`CourtStage`, mounted by the screen behind its list), which pitches
 * back as the list rises over it, the way it does under the booking card; every card
 * leans into the finger (`TiltPress`) and every row arrives on `Rise`
 * (components/motion.tsx). Display-face uppercase headings, the brand's green
 * for seats and the blue for actions, as the open-match and tournament screens
 * already use them.
 *
 * PRESENTATION ONLY. Every string arrives formatted or is a catalog key; the
 * server decided the seats, the places and the states, and the screen passes
 * those answers in.
 *
 * TEST IDS. `StartMatchButton`, `CourtCaption`, `PlayMatchCard`,
 * `PlayTournamentCard` and `PlayInlineNotice` render a Pressable (through
 * `TiltPress`, or directly), take a REQUIRED `testID` from the call site and
 * forward it explicitly; `CourtCaption` is in `testIdElements`
 * (packages/config/src/eslint.js). `NightHeader`
 * and `TimeRail` render none.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { SEATS_TOTAL, type MatchCategory } from '../features/matches/logic';
import type { TourTone } from '../features/tournaments/logic';
import { LiveDot } from './booking';
import { CategoryPill } from './match';
import { CheckIcon, ChevronIcon, PlusIcon, TrophyIcon } from './icons';
import { TiltPress } from './motion';

// ── Hero ────────────────────────────────────────────────────────────────────

/** How far the list's sheet rides up over the court's near end, as the Book card sits over its court. */
export const PLAY_SHEET_OVERLAP = 30;

// ── Start a match ───────────────────────────────────────────────────────────

/** The page's one action, the Book page's green: a pill with a plus, beside the title. */
export function StartMatchButton({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  const { fonts, tracking } = useTheme();
  const { dir } = useLocale();
  return (
    <TiltPress
      testID={testID}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        paddingStart: 12,
        paddingEnd: 15,
        borderRadius: radius.pill,
        backgroundColor: brand.green,
      }}
    >
      <PlusIcon size={14} color={brand.greenInk} strokeWidth={2.8} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.display800,
          fontSize: 12,
          letterSpacing: dir === 'rtl' ? 0 : tracking(0.48),
          textTransform: dir === 'rtl' ? 'none' : 'uppercase',
          color: brand.greenInk,
        }}
      >
        {label}
      </Text>
    </TiltPress>
  );
}

// ── The court's caption ─────────────────────────────────────────────────────

/** The caption pill's height: it hangs half over the sheet's top edge. */
export const COURT_CAPTION_H = 34;

/**
 * What the court under the title is showing (packages/court3d join.ts), and the
 * way to it: "Tonight · 9:00 PM" in ink, then the part to act on in blue ("2
 * seats left", or "Start a match" when no match has a seat), with a chevron.
 * It hangs across the top edge of the list's sheet, between the court it
 * describes and the card it leads to. The court's open spots do the same thing
 * when tapped; this is the one screen readers reach (the court is a picture).
 */
export function CourtCaption({
  testID,
  lead,
  action,
  hint,
  green = false,
  onPress,
}: {
  testID: string;
  lead: string;
  action: string;
  hint?: string;
  /** No match has a seat ("No open seats right now · Start a match"): brand green with black ink, in both themes. */
  green?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const ink = green ? brand.greenInk : colors.ink;
  const accent = green ? brand.greenInk : colors.blue;
  return (
    <TiltPress
      testID={testID}
      accessibilityLabel={`${lead}, ${action}`}
      accessibilityHint={hint}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: COURT_CAPTION_H,
        maxWidth: '100%',
        paddingStart: 14,
        paddingEnd: 10,
        borderRadius: radius.pill,
        backgroundColor: green ? brand.green : colors.card,
        borderWidth: 1,
        borderColor: green ? brand.green : colors.line,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13, color: ink }}
      >
        {lead}
      </Text>
      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: green ? ink : colors.fnt }}>
        ·
      </Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.body800, fontSize: 13, color: accent }}>
        {action}
      </Text>
      <ChevronIcon size={13} color={accent} strokeWidth={2.6} />
    </TiltPress>
  );
}

// ── A night ─────────────────────────────────────────────────────────────────

/**
 * A trading night's heading: "TONIGHT", then a hairline, then what the night
 * holds when the caller passes it ("2 open matches · 1 tournament"). `highlight` is the night the route
 * asked for (`date`): its name turns blue.
 */
export function NightHeader({
  title,
  line,
  highlight,
}: {
  title: string;
  /** What the night holds; the Join tab leaves it out (Sait, 2026-10-20). */
  line?: string;
  highlight?: boolean;
}) {
  const { colors, fonts, tracking } = useTheme();
  const { dir } = useLocale();
  const rtl = dir === 'rtl';
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingTop: 22,
        paddingBottom: 10,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display900,
          fontSize: 17,
          letterSpacing: rtl ? 0 : tracking(-0.1),
          textTransform: rtl ? 'none' : 'uppercase',
          color: highlight ? colors.blue : colors.ink,
        }}
      >
        {title}
      </Text>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line2 }} />
      {line ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>{line}</Text>
      ) : null}
    </View>
  );
}

// ── The time rail ───────────────────────────────────────────────────────────

const RAIL_W = 54;

/**
 * One entry on the night's timeline: its start time down the leading rail, a
 * spine joining it to the next entry, and the card beside it. A tournament's
 * rail carries the trophy under its time where a match's carries its length,
 * so the two kinds read apart at a glance before the cards do. The rail repeats
 * what the card reads out, so it is hidden from screen readers.
 */
export function TimeRail({
  time,
  sub,
  last,
  children,
}: {
  time: string;
  /** A match's length ("90 min"). */
  sub?: string | null;
  /** The night's last entry: no spine under it. */
  last: boolean;
  children: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: RAIL_W, alignItems: 'center', paddingTop: 10 }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{ fontFamily: fonts.display900, fontSize: 16, color: colors.ink }}
        >
          {time}
        </Text>
        {sub ? (
          <Text
            style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.mut, marginTop: 2 }}
          >
            {sub}
          </Text>
        ) : null}
        {last ? null : (
          <View
            style={{
              flex: 1,
              width: 2,
              borderRadius: 1,
              marginTop: 8,
              backgroundColor: colors.line2,
            }}
          />
        )}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : space.sm }}>{children}</View>
    </View>
  );
}

// ── The open-match card ─────────────────────────────────────────────────────

const COURT_W = 92;
const COURT_H = 50;
const SPOT = 15;
/** Where the four players stand, two a side on the service lines (match.tsx's MatchCourt, at card size). */
const SPOTS = [
  { start: '24%', top: '28%' },
  { start: '24%', top: '72%' },
  { start: '76%', top: '28%' },
  { start: '76%', top: '72%' },
] as const;

/**
 * The card's court, at a padel court's 2:1 seen from above: the turf, the
 * walls, the service lines and the green net, and a marker per seat (taken a
 * filled green disc, open a dashed blue ring). No names (GD-5): a marker is a
 * seat, never a person. Decoration: the card reads the seats out in words.
 */
function MiniCourt({ taken }: { taken: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: COURT_W,
        height: COURT_H,
        borderRadius: 8,
        backgroundColor: colors.crtTurf,
        borderWidth: 1,
        borderColor: colors.crtTurfLine,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          start: 4,
          end: 4,
          borderWidth: 1,
          borderColor: colors.crtLine,
          opacity: 0.85,
        }}
      />
      {(['24%', '76%'] as const).map((at) => (
        <View
          key={at}
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            start: at,
            width: 1,
            backgroundColor: colors.crtLine,
            opacity: 0.6,
          }}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          top: '50%',
          start: '24%',
          end: '24%',
          height: 1,
          backgroundColor: colors.crtLine,
          opacity: 0.6,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 2,
          bottom: 2,
          start: '50%',
          width: 2,
          marginStart: -1,
          backgroundColor: brand.green,
        }}
      />
      {SPOTS.map((spot, i) => {
        const filled = i < taken;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              start: spot.start,
              top: spot.top,
              width: SPOT,
              height: SPOT,
              marginStart: -SPOT / 2,
              marginTop: -SPOT / 2,
              borderRadius: SPOT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: filled ? colors.gstrong : colors.card,
              borderWidth: 1.5,
              borderStyle: filled ? 'solid' : 'dashed',
              borderColor: filled ? colors.crtLine : colors.blue,
            }}
          >
            {filled ? null : <PlusIcon size={8} color={colors.blue} strokeWidth={3.4} />}
          </View>
        );
      })}
    </View>
  );
}

/** The card's action, drawn but not a second target: the whole card is the button. */
function ActionPill({ label, quiet }: { label: string; quiet?: boolean }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingStart: 11,
        paddingEnd: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: radius.pill,
        backgroundColor: quiet ? colors.tint : brand.blue,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.body800,
          fontSize: 12,
          color: quiet ? colors.blue : brand.white,
        }}
      >
        {label}
      </Text>
      <ChevronIcon size={12} color={quiet ? colors.blue : brand.white} strokeWidth={2.6} />
    </View>
  );
}

/**
 * One open match on the timeline: the little court with its seats, the
 * category, the approve mark and the guest's own tag, the seats left (amber on
 * the last one), the share at the desk or a refill line, and the action
 * ("Join", "Ask to join", "View", or signed out "Sign in to join").
 */
export function PlayMatchCard({
  testID,
  a11yLabel,
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
  /** Everything the card says, the time first: the rail is hidden from screen readers. */
  a11yLabel: string;
  category: MatchCategory;
  seatsTaken: number;
  /** The counted "1 seat left". */
  seatsLeft: string;
  line?: string | null;
  /** The organiser approves each player: the short label beside the pill. */
  approve?: string | null;
  refill?: string | null;
  tag?: string | null;
  action: string;
  /** The `at` param: this is the time the guest came for. */
  highlight?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const lastSeat = SEATS_TOTAL - seatsTaken === 1;
  return (
    <TiltPress
      testID={testID}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: radius.card,
        backgroundColor: colors.card,
        borderWidth: highlight || tag ? 1.5 : 1,
        borderColor: highlight ? colors.blue : tag ? colors.gstrong : colors.line,
      }}
    >
      <MiniCourt taken={seatsTaken} />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <CategoryPill category={category} />
          {approve ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <CheckIcon size={11} color={colors.blue} strokeWidth={3} />
              <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: colors.blue }}>
                {approve}
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
              <Text style={{ fontFamily: fonts.body800, fontSize: 11, color: colors.gtext }}>
                {tag}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
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
              <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
                {line}
              </Text>
            ) : null}
            {refill ? (
              <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.ambtext }}>
                {refill}
              </Text>
            ) : null}
          </View>
          <ActionPill label={action} quiet={!!tag} />
        </View>
      </View>
    </TiltPress>
  );
}

// ── The tournament card ─────────────────────────────────────────────────────

/**
 * One tournament on the timeline, so it reads as a different thing from the
 * matches around it: a band in the state's colour (blue before it starts, green
 * in play, grey once over) with the trophy, the format and the status; then
 * the name in the display face, the day and times (and the branch when there
 * are several) with the places on the same line, over the bar of how full it is;
 * then, under a line, an "Open to all" / "Women only" / "Men only" pill,
 * the guest's own state and the fee by the chevron.
 */
export function PlayTournamentCard({
  testID,
  tone,
  status,
  registration,
  category,
  format,
  title,
  when,
  places,
  fee,
  mine,
  fill,
  onPress,
}: {
  testID: string;
  tone: TourTone;
  status: string | null;
  /** While registration is open or closed, the status is a green or red pill with a pulsing dot. */
  registration: 'open' | 'closed' | null;
  category: MatchCategory;
  format: string | null;
  title: string;
  when: string;
  places: string | null;
  fee: string;
  mine: string | null;
  /** 0–100 of the entries taken, or null when the tournament names no maximum. */
  fill: number | null;
  onPress: () => void;
}) {
  const { colors, fonts, appearance } = useTheme();
  // An upcoming band is the brand navy with brand-green words and trophy in
  // light (owner, 2026-10-13), and the brand green with its own ink in dark,
  // where `colors.blue` is white; its fill bar is the brand green in both.
  const band =
    tone === 'running'
      ? { bg: colors.gtint, fg: colors.gtext }
      : tone === 'over'
        ? { bg: colors.sub, fg: colors.mut }
        : appearance === 'dark'
          ? { bg: brand.green, fg: brand.greenInk }
          : { bg: brand.navy, fg: brand.green };
  const bar = tone === 'running' ? colors.gstrong : tone === 'over' ? colors.fnt3 : brand.green;
  return (
    <TiltPress
      testID={testID}
      accessibilityLabel={[title, status, when, places, fee, mine].filter(Boolean).join(', ')}
      onPress={onPress}
      style={{
        borderRadius: radius.card,
        backgroundColor: colors.card,
        borderWidth: mine ? 1.5 : 1,
        borderColor: mine ? colors.gstrong : colors.line,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingStart: 16,
          paddingEnd: 16,
          paddingTop: 11,
          paddingBottom: 11,
          backgroundColor: band.bg,
        }}
      >
        <TrophyIcon size={18} color={band.fg} />
        {format ? (
          <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: band.fg }}>
            {format}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {status && registration ? (
          // Green while open, red once closed, each with the Book tab's pulsing dot (Sait, 2026-10-21).
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingStart: 10,
              paddingEnd: 10,
              paddingTop: 3,
              paddingBottom: 3,
              borderRadius: radius.pill,
              borderWidth: 1,
              backgroundColor: registration === 'open' ? colors.gtint : colors.redtint,
              borderColor: registration === 'open' ? colors.gline : colors.redline,
            }}
          >
            <LiveDot color={registration === 'open' ? colors.gstrong : colors.redtext} />
            <Text
              numberOfLines={1}
              style={{
                fontFamily: fonts.body800,
                fontSize: 13,
                color: registration === 'open' ? colors.gtext : colors.redtext,
              }}
            >
              {status}
            </Text>
          </View>
        ) : status ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body700, fontSize: 13, color: band.fg }}
          >
            {status}
          </Text>
        ) : null}
      </View>
      <View style={{ padding: 16, gap: 9 }}>
        <Text
          numberOfLines={2}
          // A little more room under the name than between the other lines (Sait, 2026-10-21).
          style={{
            fontFamily: fonts.display800,
            fontSize: 21,
            color: colors.ink,
            marginBottom: 14,
          }}
        >
          {title}
        </Text>
        {/* The time at the start and the places at the end, on one line over the
            bar (Sait, 2026-10-21); the gap under the name stays as it was. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 14, color: colors.mut }}
          >
            {when}
          </Text>
          <View style={{ flex: 1 }} />
          {places ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.gtext }}>
              {places}
            </Text>
          ) : null}
        </View>
        {fill !== null ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              height: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.sub,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${fill}%`,
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: bar,
              }}
            />
          </View>
        ) : null}
      </View>
      {/* Under a line: the category pill at the start ("Open to all", "Men only",
          "Women only"), the fee by the chevron at the end (Sait, 2026-10-21). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingStart: 16,
          paddingEnd: 16,
          paddingTop: 11,
          paddingBottom: 11,
        }}
      >
        {/* Its own box, so the pill (which aligns itself to the top) centres on the row. */}
        <View>
          <CategoryPill category={category} />
        </View>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          {mine ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.blue }}>
              {mine}
            </Text>
          ) : null}
          <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: colors.ink }}>
            {fee}
          </Text>
          <ChevronIcon size={18} color={colors.fnt2} />
        </View>
      </View>
    </TiltPress>
  );
}

// ── One side failed ─────────────────────────────────────────────────────────

/**
 * One source failed while the other is on the page: its line and a Retry,
 * inline, so what did load stays where it is (the full ErrorState is for both
 * failing). `${testID}.retry` is the button.
 */
export function PlayInlineNotice({
  testID,
  text,
  retryLabel,
  onRetry,
}: {
  testID: string;
  text: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        padding: space.sm,
        paddingStart: space.m,
        borderRadius: radius.button,
        backgroundColor: colors.redtint,
        borderWidth: 1,
        borderColor: colors.redline,
      }}
    >
      <Text
        style={{
          flex: 1,
          fontFamily: fonts.body600,
          fontSize: 13,
          lineHeight: 18,
          color: colors.redtext,
        }}
      >
        {text}
      </Text>
      <Pressable
        testID={`${testID}.retry`}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingStart: 6, paddingEnd: 6 })}
      >
        <Text style={{ fontFamily: fonts.body800, fontSize: 13, color: colors.blue }}>
          {retryLabel}
        </Text>
      </Pressable>
    </View>
  );
}
