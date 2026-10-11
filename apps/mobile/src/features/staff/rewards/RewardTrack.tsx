import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { countPhrase, formatIQD, formatMonthLong, formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { LtrIsland } from '../../../i18n/direction';
import { brand, radius, space, useTheme } from '../../../theme';
import { MicroLabel } from '../../../components/ui';
import { BrandPattern } from '../../../components/BrandPattern';
import { CheckIcon, ChevronIcon, PadelBallIcon, TrophyIcon } from '../../../components/icons';
import { useReduceMotion } from '../../../lib/useReduceMotion';
import type { MyReward, MyRewards } from './api';
import { fillFor, newlyReached, trackModel, visibleLabels } from './logic';
import { readSeen, writeSeen } from './seen';

/**
 * The reward track: the person's orders this month as a ball rolling along a
 * court line, each of their rewards a marker on it (0332).
 *
 * The one committed surface on Today: the brand navy with the court-line
 * pattern, because it is the one thing on the page that is about the person
 * rather than the work. Personal only: no other person's figure ever reaches
 * it, and nothing compares (PRODUCT.md: nothing grades staff).
 *
 * MOTION. The fill rolls from the count the person last saw to the count now,
 * which is the server's doing while they were on the floor (the motion rule in
 * docs/DESIGN.md: only what the server did moves). A reward crossed on the way
 * settles once and the phone taps once. Reduce Motion: the track is drawn where
 * it ends, with the same words.
 */

const POINT = 22;
const PUCK = 24;
const RAIL = 8;
const LABEL_W = 56;

/** "50,000 IQD", or the prize when the reward is a prize only. */
function rewardText(r: Pick<MyReward, 'reward_iqd' | 'prize'>, locale: 'en' | 'ar'): string {
  return r.reward_iqd > 0 ? formatIQD(r.reward_iqd, locale) : (r.prize ?? '');
}

/** A server date (`YYYY-MM-DD`) at noon UTC, so no zone moves it to another day. */
const dayOf = (iso: string) => new Date(`${iso}T12:00:00Z`);

/**
 * The unlocks already celebrated in this app process, `staff.venue.month.reward`:
 * Today stays mounted under the rewards page, and both tracks watch the same
 * query, so the first one to finish its roll taps the phone and the other does
 * not.
 */
const announced = new Set<string>();

type Props = {
  data: MyRewards;
  staffId: string;
  venueId: string;
  /** `<route>.<element>`; the track and points derive theirs from it. */
  testID: string;
  /** Today opens the person's page; the page itself passes none. */
  onPress?: () => void;
};

/** A new month, person or branch starts a fresh track: no roll or unlock carries over. */
export function RewardTrack(props: Props) {
  return <RewardTrackInner key={`${props.staffId}.${props.venueId}.${props.data.month}`} {...props} />;
}

function RewardTrackInner({ data, staffId, venueId, testID, onPress }: Props) {
  const { t, locale, dir } = useLocale();
  const { fonts, tracking } = useTheme();
  const reduceMotion = useReduceMotion();
  const model = useMemo(() => trackModel(data.rewards, data.count), [data.rewards, data.count]);
  const top = model.points.length > 0 ? model.points[model.points.length - 1]!.reward.target : 0;

  const [width, setWidth] = useState(0);
  // What the person saw last (undefined until read), and what is news this visit.
  const [seen, setSeen] = useState<number | null | undefined>(undefined);
  const [fresh, setFresh] = useState<MyReward[]>([]);
  const [fill] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Map<string, Animated.Value>());
  const pulseOf = (id: string) => {
    let v = pulse.get(id);
    if (!v) {
      v = new Animated.Value(1);
      pulse.set(id, v);
    }
    return v;
  };

  // Read the last look once per month shown.
  useEffect(() => {
    let live = true;
    void readSeen(staffId, venueId, data.month).then((n) => {
      if (live) setSeen(n);
    });
    return () => {
      live = false;
    };
  }, [staffId, venueId, data.month]);

  // Roll from the last look (or from where the bar stands, on a refetch) to now.
  const shown = useRef<number | null>(null);
  // The highest count already announced this month: a void that lowers the
  // count and the order that brings it back never announce a reward twice.
  const peak = useRef(0);
  // Crossed but not celebrated yet: a roll cut short (Reduce Motion resolving
  // late, a refetch) leaves them here for the next run's done().
  const pending = useRef<MyReward[]>([]);
  useEffect(() => {
    if (seen === undefined) return;
    const from = shown.current ?? seen ?? 0;
    const to = data.count;
    peak.current = Math.max(peak.current, seen ?? 0);
    const crossed = newlyReached(data.rewards, Math.max(from, peak.current), to);
    peak.current = Math.max(peak.current, to);
    if (crossed.length > 0) {
      setFresh((prev) => (shown.current === null ? crossed : [...prev, ...crossed]));
      pending.current = [...pending.current, ...crossed];
    }
    shown.current = to;
    // Stored at the start of the roll, so a page opened mid-roll starts from here.
    void writeSeen(staffId, venueId, data.month, peak.current);
    const target = fillFor(to, top);
    const done = () => {
      const hit = pending.current.filter((r) => {
        const k = `${staffId}.${venueId}.${data.month}.${r.id}`;
        if (announced.has(k)) return false;
        announced.add(k);
        return true;
      });
      pending.current = [];
      if (hit.length === 0) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (reduceMotion) return;
      Animated.parallel(
        hit.map((r) =>
          Animated.sequence([
            Animated.timing(pulseOf(r.id), {
              toValue: 1.35,
              duration: 140,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulseOf(r.id), {
              toValue: 1,
              duration: 260,
              easing: Easing.out(Easing.poly(4)),
              useNativeDriver: true,
            }),
          ]),
        ),
      ).start();
    };
    if (reduceMotion || to <= from) {
      fill.setValue(target);
      done();
      return;
    }
    fill.setValue(fillFor(from, top));
    // Longer for a longer roll, never past a second.
    const span = Math.min(1, target - fillFor(from, top));
    Animated.timing(fill, {
      toValue: target,
      duration: 380 + 620 * span,
      easing: Easing.out(Easing.poly(4)),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) done();
    });
    // pulseOf and fill are stable; the roll is keyed on the figures alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, data.count, data.month, top, reduceMotion]);

  // ── Words ──────────────────────────────────────────────────────────────────
  const orders = (n: number) => countPhrase('staff.rewards.orders', n, locale);
  const next = model.next;
  // The headline with the reward in green: split the sentence where the reward goes.
  const MARK = '\u0000';
  const [before, after] = next
    ? t('staff.rewards.card.next', { orders: orders(model.toGo), reward: MARK }).split(MARK)
    : [countPhrase('staff.rewards.card.allDone', model.points.length, locale), ''];
  const headline = next ? `${before}${rewardText(next, locale)}${after}` : before!;
  const plusPrize = next && next.reward_iqd > 0 && next.prize ? next.prize : null;
  const newest = fresh.length > 0 ? fresh[fresh.length - 1]! : null;
  const lastReached = data.last_month.reached.length;
  const footer = [
    t('staff.rewards.card.thisMonth', { orders: orders(data.count) }),
    lastReached > 0 ? countPhrase('staff.rewards.card.lastMonth', lastReached, locale) : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  // ── Geometry (inside an LTR island: x runs left to right, mirrored for Arabic) ──
  const rtl = dir === 'rtl';
  const xOf = (at: number) => (rtl ? 1 - at : at) * width;
  const labels = visibleLabels(model.points, width, 40);
  const fillShift = fill.interpolate({
    inputRange: [0, 1],
    outputRange: rtl ? [width, 0] : [-width, 0],
  });
  const puckShift = fill.interpolate({
    inputRange: [0, 1],
    outputRange: rtl ? [width - PUCK / 2, -PUCK / 2] : [-PUCK / 2, width - PUCK / 2],
  });

  const body = (
    <>
      <BrandPattern opacity={0.1} />
      {/* Eyebrow: the month, or what was just unlocked; the days left at the end. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        {newest ? (
          <View
            testID={`${testID}.unlocked`}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <TrophyIcon size={14} color={brand.green} />
            <Text
              numberOfLines={1}
              style={{ flex: 1, fontFamily: fonts.body800, fontSize: 12.5, color: brand.green }}
            >
              {t('staff.rewards.card.unlocked', { reward: rewardText(newest, locale) })}
            </Text>
          </View>
        ) : (
          <MicroLabel style={{ flex: 1, color: brand.navyText }}>
            {t('staff.rewards.card.title', { month: formatMonthLong(dayOf(data.month), locale) })}
          </MicroLabel>
        )}
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: 12,
            color: data.days_left <= 3 ? brand.green : brand.navyText,
          }}
        >
          {countPhrase('staff.rewards.daysLeft', data.days_left, locale)}
        </Text>
      </View>

      {/* The headline: what is left for the next reward, the reward in green. */}
      <View style={{ marginTop: 6, gap: 2 }}>
        <Text
          testID={`${testID}.headline`}
          style={{
            fontFamily: fonts.display800,
            fontSize: 21,
            lineHeight: 27,
            letterSpacing: rtl ? 0 : tracking(-0.2),
            color: brand.white,
          }}
        >
          {before}
          {next ? <Text style={{ color: brand.green }}>{rewardText(next, locale)}</Text> : null}
          {after}
        </Text>
        {plusPrize ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: brand.navyText }}>
            {t('staff.rewards.card.plusPrize', { prize: plusPrize })}
          </Text>
        ) : null}
      </View>

      {/* The track. */}
      <LtrIsland
        testID={`${testID}.track`}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('staff.rewards.card.trackA11y', {
          orders: orders(data.count),
          target: formatNumber(top, locale),
        })}
        accessibilityValue={{ min: 0, max: top, now: Math.min(data.count, top) }}
        style={{ marginTop: space.l, paddingStart: POINT / 2, paddingEnd: POINT / 2 }}
      >
        <View
          style={{ height: POINT + 4, justifyContent: 'center' }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          <View
            style={{
              height: RAIL,
              borderRadius: RAIL / 2,
              backgroundColor: brand.navyTrack,
              overflow: 'hidden',
            }}
          >
            {width > 0 ? (
              <Animated.View
                style={{
                  height: RAIL,
                  width,
                  borderRadius: RAIL / 2,
                  backgroundColor: brand.green,
                  transform: [{ translateX: fillShift }],
                }}
              />
            ) : null}
          </View>
          {/* The ball, at the head of the fill; under the markers, so a marker always reads. */}
          {width > 0 && model.fill < 1 ? (
            <Animated.View
              style={{
                position: 'absolute',
                start: 0,
                width: PUCK,
                height: PUCK,
                borderRadius: PUCK / 2,
                backgroundColor: brand.navy,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ translateX: puckShift }],
              }}
            >
              <PadelBallIcon size={PUCK - 4} />
            </Animated.View>
          ) : null}
          {width > 0
            ? model.points.map((p) => (
                <Animated.View
                  key={p.reward.id}
                  testID={`${testID}.point.${p.reward.id}`}
                  style={{
                    position: 'absolute',
                    start: xOf(p.at) - POINT / 2,
                    width: POINT,
                    height: POINT,
                    borderRadius: POINT / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: p.reached ? brand.green : brand.navy,
                    borderWidth: p.reached ? 0 : 2,
                    borderColor: p.next ? brand.green : brand.navyLine,
                    transform: [{ scale: pulseOf(p.reward.id) }],
                  }}
                >
                  {p.reached ? (
                    <CheckIcon size={12} color={brand.greenInk} strokeWidth={3} />
                  ) : p.next ? (
                    <View
                      style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: brand.green }}
                    />
                  ) : null}
                </Animated.View>
              ))
            : null}
        </View>
        {/* Each marker's target under it, where there is room. */}
        <View style={{ height: 16, marginTop: 4 }}>
          {width > 0
            ? model.points.map((p, i) =>
                labels[i] ? (
                  <Text
                    key={p.reward.id}
                    numberOfLines={1}
                    style={{
                      position: 'absolute',
                      start: xOf(p.at) - LABEL_W / 2,
                      width: LABEL_W,
                      textAlign: 'center',
                      fontFamily: p.next ? fonts.body800 : fonts.body600,
                      fontSize: 11.5,
                      fontVariant: ['tabular-nums'],
                      color: p.next ? brand.green : p.reached ? brand.navyText : brand.navyMuted,
                    }}
                  >
                    {isolateLtr(formatNumber(p.reward.target, locale))}
                  </Text>
                ) : null,
              )
            : null}
        </View>
      </LtrIsland>

      {/* The month so far, last month's result, and the way in. */}
      <View style={{ marginTop: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontFamily: fonts.body600, fontSize: 12.5, color: brand.navyText }}
        >
          {footer}
        </Text>
        {onPress ? <ChevronIcon size={16} color={brand.navyText} /> : null}
      </View>
    </>
  );

  const frame = {
    padding: space.l,
    paddingTop: space.m,
    borderRadius: radius.sheet,
    borderWidth: 1,
    borderColor: brand.navyLine,
    overflow: 'hidden' as const,
  };

  if (!onPress) {
    return (
      <View testID={testID} style={[frame, { backgroundColor: brand.navy }]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('staff.rewards.card.a11y', { headline, progress: footer })}
      onPress={onPress}
      style={({ pressed }) => [frame, { backgroundColor: pressed ? brand.navyCard : brand.navy }]}
    >
      {body}
    </Pressable>
  );
}
