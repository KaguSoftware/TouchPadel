import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { EASE_OUT_EXPO, Rise } from '../../components/motion';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { brand, radius, space, useTheme } from '../../theme';
import { levelName, splitPodium, type BoardRow } from './logic';

/**
 * The board (Majed, 2026-10-22: public, the top ten only, "everybody fighting over it").
 *
 * The first three stand on a podium, second, first and third as a podium is set out, drawn as
 * the tab's own glyph: three steps, the ball over first place. The numbers are Lama Sans Thin,
 * large and light, so the steps read before the names do. The rest of the board follows as plain
 * rows on hairlines: rank, name and level, points. The guest's own row, when they are on it, is
 * tinted and says so. Nothing here is pressable and nothing ranks on the phone: the server sent
 * these rows in this order.
 *
 * Light on the device: plain views, one native-driver rise per step on mount, no SVG, no blur.
 */

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

function Standing({ row, lead }: { row: BoardRow | null; lead: boolean }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  if (!row) return <View style={{ minHeight: 58 }} />;
  const level = levelName(row.level, locale);
  return (
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
      <Text
        style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] }}
      >
        {isolateLtr(formatNumber(row.points, locale))}
        <Text style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.fnt }}>
          {` ${t('ranks.unit')}`}
        </Text>
      </Text>
      {level ? (
        <Text numberOfLines={1} style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.fnt }}>
          {level}
        </Text>
      ) : null}
    </View>
  );
}

export function Podium({ rows, testID }: { rows: readonly BoardRow[]; testID?: string }) {
  const { colors } = useTheme();
  const { podium } = splitPodium(rows);
  return (
    <View testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
        {podium.map((row, i) => (
          <View key={i} style={{ flex: 1 }}>
            <Standing row={row} lead={i === 1} />
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

function RestRow({ row, index }: { row: BoardRow; index: number }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const level = levelName(row.level, locale);
  return (
    <Rise index={index} from={10}>
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
          {level ? (
            <Text numberOfLines={1} style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.fnt }}>
              {level}
            </Text>
          ) : null}
        </View>
        <Text
          style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] }}
        >
          {isolateLtr(formatNumber(row.points, locale))}
          <Text style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.fnt }}>
            {` ${t('ranks.unit')}`}
          </Text>
        </Text>
      </View>
    </Rise>
  );
}

export function BoardRest({ rows, testID }: { rows: readonly BoardRow[]; testID?: string }) {
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
          <RestRow row={row} index={i} />
        </View>
      ))}
    </View>
  );
}
