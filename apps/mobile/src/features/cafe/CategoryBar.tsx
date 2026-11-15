import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Text } from '../../i18n/text';
import { liquidGlass } from '../../lib/liquidGlass';
import { brand, radius, space, useTheme, withAlpha } from '../../theme';
import type { CategoryBarProps } from './CategoryBar.types';

export type { CategoryBarProps, CategoryChip } from './CategoryBar.types';

const PAD = 4;
/** Room at each end, wider than the fade, so a chip at rest at the very end clears it. */
const SIDE = space.l;
/** How far in from each end the chips fade out. */
const FADE = 22;
const CHIP_H = 36;
/** The lens grows a little while it is held, as the tab bar's does. */
const HELD_SCALE = 1.12;

type Frame = { x: number; width: number };

/**
 * The café menu's category bar, the iOS 26 tab bar's way (Majed, 2026-11-13): one Liquid Glass
 * bar, the picked chip under its own glass lens, its name in the tab bar's selected colour.
 * Press the lens and drag: it follows the finger (a little larger), ticks on each chip it
 * crosses, and picks the chip it is let go on. A tap picks a chip; a drag anywhere else
 * scrolls the bar.
 *
 * Built from what every installed binary already carries, no native build: the glass is
 * `expo-glass-effect`'s `GlassView` (UIKit's own glass, as the Book tab's capsule,
 * app/(tabs)/index.tsx), the drag a PanResponder like `useSwipeTrack`'s
 * (components/booking.tsx). Where Liquid Glass is not there (Android, iOS before 26, Jest) the
 * bar takes the tab bar's fill and hairline and the lens a lighter fill; the drag is the same.
 *
 * GlassView draws nothing under an ancestor at alpha < 1 and may not come back, so the lens is
 * mounted once placed rather than faded in.
 */
export function CategoryBar({ chips, active, onPick, testID }: CategoryBarProps) {
  const { colors, fonts, appearance } = useTheme();
  // The tab bar's colours (navigation/TabsLayout.ios.tsx): brand green on dark, brand blue on
  // light (colors.blue is white on dark), the rest in fnt2.
  const selected = appearance === 'dark' ? brand.green : brand.blue;

  const scrollRef = useRef<ScrollViewInstance>(null);
  const frames = useRef<Record<string, Frame>>({});
  const barW = useRef(0);
  const [barWidth, setBarWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  // The edges fade only when there is more bar than shows.
  const overflow = contentWidth > barWidth + 1;
  const [lensX] = useState(() => new Animated.Value(0));
  const [lensW] = useState(() => new Animated.Value(0));
  const [lensScale] = useState(() => new Animated.Value(1));
  const [placed, setPlaced] = useState(false);
  /** The chip under the finger while the lens is held; null otherwise. */
  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * Picked here, not yet echoed back as `active`: keeps the lens from flicking back. It counts
   * only while `active` is still what it was at the pick, so any change of `active` (the echo,
   * or the menu scrolling on) retires it with no effect to clear it.
   */
  const [pending, setPending] = useState<{ id: string; from: string | null } | null>(null);
  const settled = pending && pending.from === active ? pending.id : active;
  const shown = hovered ?? settled;
  const [held, setHeld] = useState(false);

  const spring = useCallback(
    (to: Frame) => {
      const cfg = { useNativeDriver: false, bounciness: 5, speed: 16 } as const;
      Animated.parallel([
        Animated.spring(lensX, { toValue: to.x, ...cfg }),
        Animated.spring(lensW, { toValue: to.width, ...cfg }),
      ]).start();
    },
    [lensX, lensW],
  );

  /** Puts the lens under `id`: at once the first time, with a spring after. */
  const settle = useCallback(
    (id: string | null) => {
      const f = id ? frames.current[id] : undefined;
      if (!f) return;
      if (!placed) {
        lensX.setValue(f.x);
        lensW.setValue(f.width);
        setPlaced(true);
        return;
      }
      spring(f);
    },
    [placed, lensX, lensW, spring],
  );

  useEffect(() => {
    if (held) return;
    const f = settled ? frames.current[settled] : undefined;
    if (!f) return;
    settle(settled);
    scrollRef.current?.scrollTo({
      x: Math.max(0, f.x - (barW.current - f.width) / 2),
      animated: true,
    });
    // `settle` changes once `placed` flips; re-running then is harmless.
  }, [settled, held, settle]);

  const pick = useCallback(
    (id: string) => {
      if (id === settled) return;
      setPending({ id, from: active });
      onPick(id);
    },
    [settled, active, onPick],
  );

  // The drag reads these through refs: the responder is built once per chip set.
  const live = useRef({ settled, hovered, pick });
  useEffect(() => {
    live.current = { settled, hovered, pick };
  });

  const nearest = (x: number): string | null => {
    let best: string | null = null;
    let gap = Infinity;
    for (const [id, f] of Object.entries(frames.current)) {
      const d = Math.abs(f.x + f.width / 2 - x);
      if (d < gap) {
        gap = d;
        best = id;
      }
    }
    return best;
  };

  /** Where on the bar's content the finger took the lens. */
  const grabX = useRef(0);
  const lensDrag = useMemo(() => {
    const end = (commit: boolean) => {
      const { hovered: target, settled: from, pick: choose } = live.current;
      setHeld(false);
      setHovered(null);
      Animated.spring(lensScale, { toValue: 1, useNativeDriver: false, speed: 18 }).start();
      const to = commit && target ? target : from;
      const f = to ? frames.current[to] : undefined;
      if (f) spring(f);
      if (commit && target) choose(target);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Never hand the finger to the ScrollView once the lens has it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const from = live.current.settled;
        const f = from ? frames.current[from] : undefined;
        grabX.current = (f?.x ?? 0) + e.nativeEvent.locationX;
        lensX.stopAnimation();
        lensW.stopAnimation();
        setHeld(true);
        setHovered(from);
        Animated.spring(lensScale, {
          toValue: HELD_SCALE,
          useNativeDriver: false,
          speed: 20,
        }).start();
      },
      onPanResponderMove: (_e, g) => {
        const all = Object.values(frames.current);
        if (all.length === 0) return;
        const x = grabX.current + g.dx;
        const id = nearest(x);
        const f = id ? frames.current[id] : undefined;
        if (!f) return;
        const lo = Math.min(...all.map((a) => a.x));
        const hi = Math.max(...all.map((a) => a.x + a.width)) - f.width;
        lensX.setValue(Math.min(Math.max(x - f.width / 2, lo), Math.max(lo, hi)));
        if (id !== live.current.hovered) {
          live.current.hovered = id;
          setHovered(id);
          Animated.spring(lensW, {
            toValue: f.width,
            useNativeDriver: false,
            speed: 24,
            bounciness: 0,
          }).start();
          void Haptics.selectionAsync().catch(() => {});
        }
      },
      onPanResponderRelease: () => end(true),
      onPanResponderTerminate: () => end(false),
    });
    // Built once per chip set: everything that changes is read through `live` and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips, lensX, lensW, lensScale, spring]);

  const dark = appearance === 'dark';
  // Blue glass, not the system's grey (Majed, 2026-11-13): the booking sheet's own glass
  // formula (components/BookingSheet.tsx, `withAlpha(colors.bg, …)`) tints the bar with the
  // page's blue (navy on dark); the lens takes a lighter blue on dark (`tint`) and white on
  // light, so it reads as the highlight. Off glass, the lens is the same blue as a flat fill.
  const barTint = withAlpha(colors.bg, dark ? 0.45 : 0.35);
  const lensTint = withAlpha(dark ? colors.tint : colors.page, dark ? 0.75 : 0.6);
  const lensFill = dark ? colors.tint : colors.seg;
  // The edge fade is the bar's own colour going clear: the glass's blue tint, or the tab
  // bar's fill off glass. No mask view in this binary, so it is drawn over the chips.
  const edge = liquidGlass ? colors.bg : colors.tabBg;
  const edgeSolid = withAlpha(edge, liquidGlass ? 0.85 : 0.95);
  const edgeClear = withAlpha(edge, 0);

  return (
    <View
      style={{
        borderRadius: radius.pill,
        overflow: 'hidden',
        ...(liquidGlass
          ? null
          : { backgroundColor: colors.tabBg, borderWidth: 1, borderColor: colors.line }),
      }}
    >
      {liquidGlass ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle="regular"
          tintColor={barTint}
          colorScheme={dark ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
        />
      ) : null}
      <ScrollView
        ref={scrollRef}
        horizontal
        // Off while the lens is held, so the bar stays put under the finger.
        scrollEnabled={!held}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 2,
          paddingTop: PAD,
          paddingBottom: PAD,
          paddingStart: SIDE,
          paddingEnd: SIDE,
        }}
        onLayout={(e) => {
          barW.current = e.nativeEvent.layout.width;
          setBarWidth(e.nativeEvent.layout.width);
        }}
        onContentSizeChange={(w) => setContentWidth(w)}
      >
        {placed ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: PAD,
              height: CHIP_H,
              // Physical on purpose: onLayout's x is measured from the physical left in both
              // directions, and so are the finger's moves, so the lens is placed the same way.
              // eslint-disable-next-line no-restricted-syntax
              left: lensX,
              width: lensW,
              transform: [{ scale: lensScale }],
            }}
          >
            {liquidGlass ? (
              <GlassView
                pointerEvents="none"
                glassEffectStyle="regular"
                isInteractive
                tintColor={lensTint}
                colorScheme={dark ? 'dark' : 'light'}
                style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { borderRadius: radius.pill, backgroundColor: lensFill },
                ]}
              />
            )}
          </Animated.View>
        ) : null}
        {chips.map(({ id, label }) => {
          const on = id === shown;
          const onLayout = (e: { nativeEvent: { layout: Frame } }) => {
            frames.current[id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
            if (id === settled && !placed) settle(id);
          };
          const text = (
            <Text
              style={{
                fontFamily: on ? fonts.display800 : fonts.display600,
                fontSize: 13,
                color: on ? selected : colors.fnt2,
              }}
            >
              {label}
            </Text>
          );
          const chipStyle = {
            height: CHIP_H,
            paddingStart: space.m,
            paddingEnd: space.m,
            borderRadius: radius.pill,
            justifyContent: 'center' as const,
          };
          // The chip under the lens takes the drag; the others are plain taps.
          return id === settled ? (
            <View
              key={id}
              testID={`${testID}.category.${id}`}
              accessible
              accessibilityRole="button"
              accessibilityState={{ selected: true }}
              onLayout={onLayout}
              style={chipStyle}
              {...lensDrag.panHandlers}
            >
              {text}
            </View>
          ) : (
            <Pressable
              key={id}
              testID={`${testID}.category.${id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: false }}
              onLayout={onLayout}
              onPress={() => pick(id)}
              style={({ pressed }) => ({ ...chipStyle, opacity: pressed ? 0.6 : 1 })}
            >
              {text}
            </Pressable>
          );
        })}
      </ScrollView>
      {overflow ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[edgeSolid, edgeClear]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            // Physical on purpose: the gradient runs left to right, so each one is pinned to
            // the physical edge it fades from, in either direction.
            // eslint-disable-next-line no-restricted-syntax
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: FADE }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[edgeClear, edgeSolid]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            // eslint-disable-next-line no-restricted-syntax
            style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: FADE }}
          />
        </>
      ) : null}
    </View>
  );
}
