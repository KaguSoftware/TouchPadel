import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Animated, Linking, Pressable, View, type AccessibilityActionEvent } from 'react-native';
import { formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { EASE_OUT_EXPO, Rise } from '../../components/motion';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { brand, radius, space, useTheme } from '../../theme';
import { SUPPORT_EMAIL } from '../../lib/legal';
import { levelName, rowValue, splitPodium, type BoardRow, type BoardView, type RankClass } from './logic';
import { canReportRow, rankReportMailto } from './report';

/**
 * The board (Majed, 2026-10-22: public, the top ten only, "everybody fighting over it").
 *
 * The first three stand on a podium, second, first and third as a podium is set out, drawn as
 * the tab's own glyph: three steps, the ball over first place. The numbers are Lama Sans Thin,
 * large and light, so the steps read before the names do. The rest of the board follows as plain
 * rows on hairlines: rank, name, tier and class, then the board's number (Race points, the
 * Touch Level with one decimal, or the gain on Most improved; 0444). The guest's own row, when
 * they are on it, is tinted and says so. Nothing ranks on the phone: the server sent these rows in this order.
 *
 * A long press on someone else's row (or the screen reader's "Report this name" action) reports the
 * name to the venue (App Review 1.2; `report.ts`). That is the only thing a row does.
 *
 * Light on the device: plain views, one native-driver rise per step on mount, no SVG, no blur.
 */

/** Long press → confirm → the email app, addressed to the venue with the name filled in. */
function useReportName(): (row: BoardRow) => void {
  const { t } = useLocale();
  return (row) => {
    if (!canReportRow(row)) return;
    const name = row.name!.trim();
    Alert.alert(t('ranks.reportName.title', { name }), t('ranks.reportName.message'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('ranks.reportName.send'),
        style: 'destructive',
        onPress: () => {
          const subject = t('ranks.reportName.subject', { name });
          const url = rankReportMailto(SUPPORT_EMAIL, subject, t('ranks.reportName.body', { name }));
          Linking.openURL(url).catch(() => Alert.alert(t('ranks.reportName.noMail', { email: SUPPORT_EMAIL })));
        },
      },
    ]);
  };
}

/** A row's press surface: a long press and the accessibility action report it; nothing else. */
function Reportable({ row, testID, children }: { row: BoardRow; testID: string; children: ReactNode }) {
  const { t } = useLocale();
  const report = useReportName();
  if (!canReportRow(row)) return <>{children}</>;
  return (
    <Pressable
      testID={testID}
      onLongPress={() => report(row)}
      delayLongPress={450}
      accessibilityActions={[{ name: 'report', label: t('ranks.reportName.action') }]}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === 'report') report(row);
      }}
    >
      {children}
    </Pressable>
  );
}

/** Step heights, second, first, third: the first stands a head above the others. */
const STEP_H = [64, 92, 48] as const;
/** The order the steps rise in: third, second, then first, last and highest. */
const RISE_ORDER = [1, 2, 0] as const;
const STEP_MS = 640;
const STEP_GAP_MS = 110;

function Step({
  height,
  index,
  rank,
  lead,
  empty,
}: {
  height: number;
  /** Position in the rise (0 first). */
  index: number;
  rank: number | null;
  /** First place: the brand colour, the numeral reversed out of it. */
  lead: boolean;
  empty: boolean;
}) {
  const { colors, fonts, appearance } = useTheme();
  const reduce = useReduceMotion();
  const [p] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) {
      p.setValue(1);
      return;
    }
    const anim = Animated.timing(p, {
      toValue: 1,
      duration: STEP_MS,
      delay: index * STEP_GAP_MS,
      easing: EASE_OUT_EXPO,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [p, index, reduce]);

  // Blue mode paints its primary white, so first place takes the green there, as the tab bar does.
  const leadBg = appearance === 'dark' ? brand.green : brand.blue;
  const leadInk = appearance === 'dark' ? brand.navy : colors.card;
  const bg = empty ? colors.sub : lead ? leadBg : colors.tint;
  return (
    // The step rises out of its own slot: the slot clips, the step slides up into it.
    <View style={{ height, overflow: 'hidden', borderTopStartRadius: 14, borderTopEndRadius: 14 }}>
      <Animated.View
        style={{
          height,
          backgroundColor: bg,
          opacity: empty ? 0.6 : 1,
          alignItems: 'center',
          paddingTop: 6,
          transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
        }}
      >
        {rank !== null ? (
          <Text
            style={{
              fontFamily: fonts.display100,
              fontSize: lead ? 44 : 34,
              lineHeight: lead ? 50 : 40,
              fontVariant: ['tabular-nums'],
              color: lead ? leadInk : colors.blue,
            }}
          >
            {isolateLtr(String(rank))}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Standing({ row, lead, view }: { row: BoardRow | null; lead: boolean; view: BoardView }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  if (!row) return <View style={{ minHeight: 58 }} />;
  const level = levelName(row.tier, locale);
  return (
    <Reportable row={row} testID={`ranks.board.row.${row.rank}`}>
      <View style={{ alignItems: 'center', gap: 2, paddingBottom: space.s, minHeight: 58 }}>
        {lead ? (
          // The ball over first place, the tab glyph's own.
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: radius.pill,
              backgroundColor: brand.green,
              marginBottom: 4,
            }}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.body800,
            fontSize: 13.5,
            color: row.mine ? colors.blue : colors.ink,
            maxWidth: '100%',
          }}
        >
          {row.mine ? t('ranks.you') : (row.name ?? t('ranks.player'))}
        </Text>
        <RowValue row={row} view={view} size={15} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
          {level ? (
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 11, color: colors.fnt }}>
              {level}
            </Text>
          ) : null}
          {row.klass ? <ClassBadge klass={row.klass} /> : null}
        </View>
      </View>
    </Reportable>
  );
}

export function Podium({ rows, view, testID }: { rows: readonly BoardRow[]; view: BoardView; testID?: string }) {
  const { colors } = useTheme();
  const { podium } = splitPodium(rows);
  return (
    <View testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
        {podium.map((row, i) => (
          <View key={i} style={{ flex: 1 }}>
            <Standing row={row} lead={i === 1} view={view} />
            <Step
              height={STEP_H[i] ?? 48}
              index={RISE_ORDER[i] ?? 0}
              rank={row?.rank ?? null}
              lead={i === 1}
              empty={row === null}
            />
          </View>
        ))}
      </View>
      {/* The floor the steps stand on. */}
      <View style={{ height: 1, backgroundColor: colors.line2 }} />
    </View>
  );
}

function RestRow({ row, index, view }: { row: BoardRow; index: number; view: BoardView }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const level = levelName(row.tier, locale);
  return (
    <Rise index={index} from={10}>
      <Reportable row={row} testID={`ranks.board.row.${row.rank}`}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingVertical: 11,
            paddingHorizontal: row.mine ? space.sm : 0,
            marginHorizontal: row.mine ? -space.sm : 0,
            borderRadius: row.mine ? radius.cell : 0,
            backgroundColor: row.mine ? colors.tint : 'transparent',
          }}
        >
          <Text
            style={{
              width: 34,
              fontFamily: fonts.display100,
              fontSize: 24,
              lineHeight: 28,
              fontVariant: ['tabular-nums'],
              color: row.mine ? colors.blue : colors.fnt,
            }}
          >
            {isolateLtr(String(row.rank))}
          </Text>
          <View style={{ flex: 1, gap: 1 }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.body700, fontSize: 15, color: row.mine ? colors.blue : colors.ink }}
            >
              {row.mine ? t('ranks.you') : (row.name ?? t('ranks.player'))}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {level ? (
                <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 11.5, color: colors.fnt }}>
                  {level}
                </Text>
              ) : null}
              {row.klass ? <ClassBadge klass={row.klass} /> : null}
            </View>
          </View>
          <RowValue row={row} view={view} size={16} />
        </View>
      </Reportable>
    </Rise>
  );
}

export function BoardRest({ rows, view, testID }: { rows: readonly BoardRow[]; view: BoardView; testID?: string }) {
  const { colors } = useTheme();
  const { rest } = splitPodium(rows);
  if (rest.length === 0) return null;
  return (
    <View testID={testID} style={{ marginTop: space.xs }}>
      {rest.map((row, i) => (
        <View
          key={`${row.rank}-${i}`}
          style={i > 0 && !row.mine && !rest[i - 1]?.mine ? { borderTopWidth: 1, borderTopColor: colors.line } : null}
        >
          <RestRow row={row} index={i} view={view} />
        </View>
      ))}
    </View>
  );
}

/**
 * The board's number for a row: Race points with their unit, the Touch Level with one decimal,
 * or the gain on Most improved. Nothing while the owner hides the level: the tier says it.
 */
function RowValue({ row, view, size }: { row: BoardRow; view: BoardView; size: number }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const value = rowValue(row, view);
  if (!value) return null;
  const style = { fontFamily: fonts.display800, fontSize: size, color: colors.ink, fontVariant: ['tabular-nums' as const] };
  if (value.kind === 'points') {
    return (
      <Text style={style}>
        {isolateLtr(formatNumber(value.value, locale))}
        <Text style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.fnt }}>{` ${t('ranks.unit')}`}</Text>
      </Text>
    );
  }
  return (
    <Text style={value.kind === 'gain' ? { ...style, color: colors.gstrong } : style}>{isolateLtr(value.text)}</Text>
  );
}

/** A small A / B / C badge: the class the player's level is in (A the highest). */
export function ClassBadge({ klass, label }: { klass: RankClass; label?: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      accessibilityLabel={label ?? t(`ranks.class.${klass}`)}
      style={{
        minWidth: 18,
        paddingStart: 5,
        paddingEnd: 5,
        paddingTop: 1,
        paddingBottom: 1,
        borderRadius: radius.pill,
        backgroundColor: colors.tint,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.body800, fontSize: 10.5, lineHeight: 14, color: colors.blue }}>
        {label ?? klass}
      </Text>
    </View>
  );
}
