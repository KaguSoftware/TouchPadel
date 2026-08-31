/**
 * Loading / empty / error / offline states, restyled to the design
 * (2026-08-31) — behavior unchanged from the reliability pass.
 *
 * The bug these exist to kill: two of the three main screens checked only
 * `isLoading` and never `isError`, so a network failure fell through to the
 * empty-state copy — the court list said "No courts are available right now"
 * and My Bookings said "You have no upcoming bookings". The app told the user a
 * confident lie and offered no way to retry.
 *
 * An empty state and an error state are different things and must never share
 * a branch again.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { radius, space, useTheme } from '../theme';
import { Button } from './ui';
import { PadelBallIcon } from './icons';

// ── Skeleton ────────────────────────────────────────────────────────────────
// A content-shaped placeholder beats a centred spinner: the screen doesn't jump
// when data lands, and perceived load time drops. Opacity only, native-driven,
// so it costs nothing on the JS thread.
export function Skeleton({
  height = 16,
  width = '100%',
  radius: r = radius.cell,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: object;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { height, width, borderRadius: r, backgroundColor: colors.seg, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A stack of card-shaped skeletons, sized to the list it stands in for. */
export function SkeletonList({ rows = 4, height = 84 }: { rows?: number; height?: number }) {
  return (
    <View style={{ paddingTop: space.xs }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={radius.button} style={{ marginBottom: space.sm }} />
      ))}
    </View>
  );
}

// ── Error ───────────────────────────────────────────────────────────────────
export function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
  busy,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingStart: space.xxl,
        paddingEnd: space.xxl,
        gap: 6,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          backgroundColor: colors.redtint,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.sm,
        }}
      >
        <Text style={{ fontFamily: fonts.display800, fontSize: 22, color: colors.redtext }}>!</Text>
      </View>
      <Text
        style={{
          fontFamily: fonts.display900,
          fontSize: 18,
          textTransform: 'uppercase',
          color: colors.mut2,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily: fonts.body400,
          fontSize: 13,
          color: colors.mut,
          textAlign: 'center',
          lineHeight: 20,
        }}
      >
        {message}
      </Text>
      {onRetry ? (
        <View style={{ alignSelf: 'stretch', marginTop: space.sm }}>
          <Button label={retryLabel} onPress={onRetry} busy={busy} variant="cta" />
        </View>
      ) : null}
    </View>
  );
}

// ── Empty ───────────────────────────────────────────────────────────────────
export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingStart: space.xl,
        paddingEnd: space.xl,
        paddingTop: 44,
        paddingBottom: 44,
        gap: 6,
      }}
    >
      <PadelBallIcon size={58} opacity={0.85} />
      <Text
        style={{
          fontFamily: fonts.display900,
          fontSize: 18,
          textTransform: 'uppercase',
          color: colors.mut2,
          textAlign: 'center',
          marginTop: space.sm,
        }}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 13,
            color: colors.mut,
            textAlign: 'center',
            lineHeight: 19,
          }}
        >
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: space.l }}>
          <Button label={actionLabel} onPress={onAction} variant="cta" />
        </View>
      ) : null}
    </View>
  );
}

// ── Offline ─────────────────────────────────────────────────────────────────
/** Persistent bar; the SOW is explicit that the app must fail loudly, not hide. */
export function OfflineBanner({ message }: { message: string }) {
  const { fonts } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: '#B42318',
        paddingTop: 8,
        paddingBottom: 8,
        paddingStart: space.l,
        paddingEnd: space.l,
      }}
    >
      <Text
        style={{ color: '#FFFFFF', fontFamily: fonts.body600, fontSize: 13, textAlign: 'center' }}
      >
        {message}
      </Text>
    </View>
  );
}
