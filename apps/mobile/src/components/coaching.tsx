/**
 * The guest's lesson building blocks (docs/design/coaching/guest.md §4.8): a
 * coach's card, an offer row, a class row, a lesson row, the lesson poster,
 * the payment choice, the party stepper and the "Is this you?" card (C-21).
 *
 * PRESENTATION ONLY. Every string arrives formatted or is a catalog key; the
 * server decided the prices, the places, the states and what may be done, and
 * the screens pass those answers in. Nothing here prices, permits or refuses.
 *
 * TEST IDS. Each wrapper that renders a Pressable (`CoachCard`, `OfferRow`,
 * `ClassRow`, `LessonTimePill`, `LessonRow`, `PaymentModeChoice`,
 * `PartyStepper`, `LinkConfirmCard`) takes a REQUIRED `testID` from its call
 * site and forwards it, or `${testID}.<child>`, explicitly; all eight are in
 * `testIdElements` (packages/config/src/eslint.js). `LessonPoster`, `KindPill`,
 * `CoachAvatar` and `CoachHero` render no Pressable.
 */
import { memo, type ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Text } from '../i18n/text';
import { brand, radius, space, useTheme } from '../theme';
import { coachInitial, coachPhotoUrl, type PaymentChoice } from '../features/coaching/logic';
import type { MergedCell } from '../features/availability/assemble';
import { Button, Card, SegmentedControl } from './ui';
import { ChevronIcon } from './icons';

// ── Small pieces ────────────────────────────────────────────────────────────

/** A lesson kind ("Private", "Group", "Course") as a quiet pill. */
export function KindPill({ label }: { label: string }) {
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
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.blue }}>{label}</Text>
    </View>
  );
}

/** A coach's photo (a `coaches/<uuid>/<file>` path only, R43), or their initial on a disc. */
export function CoachAvatar({
  photoPath,
  name,
  size = 48,
}: {
  photoPath: string | null;
  name: string;
  size?: number;
}) {
  const { colors, fonts } = useTheme();
  const uri = coachPhotoUrl(photoPath);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.sub }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.gtint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.display900, fontSize: size * 0.42, color: colors.gstrong }}>
        {coachInitial(name)}
      </Text>
    </View>
  );
}

const rowStyle = (colors: ReturnType<typeof useTheme>['colors'], pressed: boolean) => ({
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: space.sm,
  backgroundColor: pressed ? colors.sub : colors.card,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.button,
  paddingStart: space.m,
  paddingEnd: space.sm,
  paddingTop: 12,
  paddingBottom: 12,
});

// ── CoachCard (§4.8.2) ──────────────────────────────────────────────────────

/** One coach in the list: photo, name, the kinds taught, "From {price}". The card opens the coach. */
export function CoachCard({
  testID,
  name,
  photoPath,
  kinds,
  from,
  onPress,
}: {
  testID: string;
  name: string;
  photoPath: string | null;
  /** "Private · Group · Courses". */
  kinds: string;
  /** "From 30,000 IQD", or null when no offer has a price. */
  from: string | null;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[name, kinds, from].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => rowStyle(colors, pressed)}
    >
      <CoachAvatar photoPath={photoPath} name={name} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.display900, fontSize: 16, color: colors.ink }}
        >
          {name}
        </Text>
        {kinds ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}
          >
            {kinds}
          </Text>
        ) : null}
        {from ? (
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
            {from}
          </Text>
        ) : null}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

// ── OfferRow (§4.8.3 item 2) ────────────────────────────────────────────────

/** One lesson a coach offers: name, kind, the meta line ("60 min · Up to 4 people"), the price. */
export function OfferRow({
  testID,
  name,
  kind,
  meta,
  price,
  selected,
  onPress,
}: {
  testID: string;
  name: string;
  kind: string;
  meta: string;
  price: string | null;
  /** The private offer the grid below shows. */
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={[name, kind, meta, price].filter(Boolean).join(', ')}
      onPress={onPress}
      // Figma "D · Profile": a borderless white row at the card radius; the
      // selected private offer takes a 2 pt accent ring. The border is always
      // 2 pt (card-coloured when not selected) so selecting never shifts the row.
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 44,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 2,
        borderColor: selected ? colors.blue : colors.card,
        borderRadius: radius.card,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: space.m,
        paddingBottom: space.m,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}
        >
          <Text style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}>
            {name}
          </Text>
        </View>
        <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>{meta}</Text>
      </View>
      {price ? (
        <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.gstrong }}>
          {price}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Coach page hero and time pill (§4.8.3, Figma "D · Profile") ─────────────

/**
 * The band at the top of a coach's page: their photo full width, or, without
 * one, their initial on the brand blue. The brand blue is theme-invariant on
 * purpose: in blue mode it is the ramp's own step (`line2`), so the band still
 * reads as the brand against the darker ground. The coach page makes its
 * native header transparent, so the system back and share items float over
 * the band; the band itself draws no buttons.
 */
export function CoachHero({
  photoPath,
  name,
  height = 200,
  testID,
}: {
  photoPath: string | null;
  name: string;
  height?: number;
  testID?: string;
}) {
  const uri = coachPhotoUrl(photoPath);
  return (
    <View
      testID={testID}
      style={{
        height,
        backgroundColor: brand.blue,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
        />
      ) : (
        <View style={{ marginBottom: space.xxl }}>
          <CoachAvatar photoPath={null} name={name} size={88} />
        </View>
      )}
    </View>
  );
}

/**
 * One free start on the coach's page, as the Figma frame's round pill: 44 tall,
 * time only (the lesson's price is in the book bar once a time is picked, C-1).
 * Only the server's free starts are ever passed in, so there is no disabled or
 * greyed state to draw; the picked one fills with the ink. Memoised with a
 * `(cell) => void` handler, as `SlotCell` is.
 */
export const LessonTimePill = memo(function LessonTimePill({
  cell,
  time,
  selected,
  onPress,
  testID,
}: {
  cell: MergedCell;
  time: string;
  selected?: boolean;
  onPress: (cell: MergedCell) => void;
  /** `coach-detail.slot.<courtId>-<startMin>` (`slotTestID`). */
  testID: string;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={time}
      accessibilityState={{ selected: !!selected }}
      onPress={() => onPress(cell)}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingStart: space.l,
        paddingEnd: space.l,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.ink : pressed ? colors.seg : colors.tint,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 14.5,
          color: selected ? colors.card : colors.ink,
        }}
      >
        {time}
      </Text>
    </Pressable>
  );
});

// ── ClassRow (§4.8.4) ───────────────────────────────────────────────────────

/** A group session or a course with places: kind, title, coach, when, places, price. */
export function ClassRow({
  testID,
  kind,
  title,
  coach,
  when,
  places,
  price,
  onPress,
}: {
  testID: string;
  kind: string;
  title: string;
  coach: string;
  when: string;
  /** The counted "3 places left". */
  places: string;
  price: string | null;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, coach, when, places, price].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => rowStyle(colors, pressed)}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <KindPill label={kind} />
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}
          >
            {title}
          </Text>
        </View>
        {coach ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}
          >
            {coach}
          </Text>
        ) : null}
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>{when}</Text>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
            {places}
          </Text>
          {price ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 }}>
              {price}
            </Text>
          ) : null}
        </View>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

// ── LessonRow (§4.8.8, the Bookings section) ────────────────────────────────

/** One of the guest's lessons: the coach's photo, the type, day and time, the state line, the money line. */
export function LessonRow({
  testID,
  title,
  coachName,
  photoPath,
  when,
  state,
  money,
  action,
  onPress,
}: {
  testID: string;
  title: string;
  coachName: string;
  photoPath: string | null;
  when: string;
  /** The §4.8.9 line. */
  state: string;
  money?: string | null;
  /** A call to act ("Finish payment", "Confirm it's you"), shown as a tag. */
  action?: string | null;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, coachName, when, state, money, action].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => rowStyle(colors, pressed)}
    >
      <CoachAvatar photoPath={photoPath} name={coachName} size={40} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}
        >
          {title}
        </Text>
        {coachName ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}
          >
            {coachName}
          </Text>
        ) : null}
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>{when}</Text>
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.gtext }}>
          {state}
        </Text>
        {money ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut2 }}>
            {money}
          </Text>
        ) : null}
      </View>
      {action ? (
        <View
          style={{
            backgroundColor: colors.amb,
            borderRadius: radius.pill,
            paddingStart: 8,
            paddingEnd: 8,
            paddingTop: 3,
            paddingBottom: 3,
          }}
        >
          <Text style={{ fontFamily: fonts.body800, fontSize: 10.5, color: colors.ambtext }}>
            {action}
          </Text>
        </View>
      ) : null}
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

// ── LessonPoster (§4.8.5, §4.8.7) ───────────────────────────────────────────

/** The head of a class or a lesson: kind, title, then its lines (state, when, duration, branch, court). Not pressable. */
export function LessonPoster({
  kind,
  title,
  lines,
  children,
}: {
  kind: string;
  title: string;
  lines: readonly (string | null | false | undefined)[];
  children?: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Card>
      <View style={{ gap: 6 }}>
        <KindPill label={kind} />
        <Text style={{ fontFamily: fonts.display900, fontSize: 20, color: colors.ink }}>
          {title}
        </Text>
        {lines
          .filter((l): l is string => typeof l === 'string' && l.length > 0)
          .map((line, i) => (
            <Text
              key={i}
              style={{
                fontFamily: i === 0 ? fonts.body700 : fonts.body600,
                fontSize: 13,
                color: i === 0 ? colors.gtext : colors.mut,
              }}
            >
              {line}
            </Text>
          ))}
        {children}
      </View>
    </Card>
  );
}

// ── PaymentModeChoice (§4.9.1 step 3) ───────────────────────────────────────

/**
 * The branch's payment choice: a segmented control when it offers both the
 * desk and Qi (`online_optional`), else the one mode as a line. The track is
 * `testID`; each segment `${testID}.desk` / `${testID}.online`.
 */
export function PaymentModeChoice({
  testID,
  choices,
  value,
  onChange,
  labels,
}: {
  testID: string;
  choices: readonly PaymentChoice[];
  value: PaymentChoice;
  onChange: (next: PaymentChoice) => void;
  labels: Record<PaymentChoice, string>;
}) {
  const { colors, fonts } = useTheme();
  if (choices.length > 1) {
    return (
      <SegmentedControl<PaymentChoice>
        testID={testID}
        options={choices.map((c) => ({ value: c, label: labels[c] }))}
        value={value}
        onChange={onChange}
        activeColor={colors.gstrong}
      />
    );
  }
  return (
    <View testID={testID}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
        {labels[value]}
      </Text>
    </View>
  );
}

// ── PartyStepper (§4.8.6 item 2) ────────────────────────────────────────────

/** − value +, 1..max: "Just me", "Me + 1", … The buttons are `${testID}.minus` and `${testID}.plus`. */
export function PartyStepper({
  testID,
  value,
  max,
  label,
  onChange,
}: {
  testID: string;
  value: number;
  max: number;
  /** "Just me" / "Me + 2". */
  label: string;
  onChange: (next: number) => void;
}) {
  const { colors, fonts } = useTheme();
  const step = (delta: number) => onChange(Math.max(1, Math.min(max, value + delta)));
  const button = (id: string, glyph: string, disabled: boolean, delta: number) => (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? '+1' : '-1'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => step(delta)}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.sub : colors.card,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      {button(`${testID}.minus`, '−', value <= 1, -1)}
      <Text
        style={{
          flex: 1,
          textAlign: 'center',
          fontFamily: fonts.display800,
          fontSize: 15,
          color: colors.ink,
        }}
      >
        {label}
      </Text>
      {button(`${testID}.plus`, '+', value >= max, 1)}
    </View>
  );
}

// ── LinkConfirmCard (§4.8.10, C-21, R44) ────────────────────────────────────

/**
 * "A coach added you to a lesson. Is this you?": the coach's display name,
 * the lesson, the day and time and the branch under it; never the name the
 * coach typed, and no money. "Yes, it's me" is `${testID}.yes`, "Not me"
 * `${testID}.no`.
 */
export function LinkConfirmCard({
  testID,
  body,
  details,
  yesLabel,
  noLabel,
  busy,
  onYes,
  onNo,
}: {
  testID: string;
  body: string;
  details: readonly (string | null | undefined)[];
  yesLabel: string;
  noLabel: string;
  busy?: 'yes' | 'no' | null;
  onYes: () => void;
  onNo: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.amb,
        borderWidth: 1,
        borderColor: colors.ambline,
        borderRadius: radius.button,
        padding: space.m,
        gap: 8,
      }}
    >
      <Text
        style={{ fontFamily: fonts.body700, fontSize: 13.5, lineHeight: 19, color: colors.ambtext }}
      >
        {body}
      </Text>
      {details
        .filter((d): d is string => typeof d === 'string' && d.length > 0)
        .map((d, i) => (
          <Text key={i} style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.ink }}>
            {d}
          </Text>
        ))}
      <View style={{ flexDirection: 'row', gap: space.s, marginTop: 4 }}>
        <Button
          testID={`${testID}.yes`}
          label={yesLabel}
          variant="cta"
          size="compact"
          busy={busy === 'yes'}
          disabled={busy === 'no'}
          onPress={onYes}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.no`}
          label={noLabel}
          variant="secondary"
          size="compact"
          busy={busy === 'no'}
          disabled={busy === 'yes'}
          onPress={onNo}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}
