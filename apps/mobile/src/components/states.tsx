import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { theme } from '../theme';

/**
 * Loading / empty / error / offline states.
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

// ── Skeleton ────────────────────────────────────────────────────────────────
// A content-shaped placeholder beats a centred spinner: the screen doesn't jump
// when data lands, and perceived load time drops. Opacity only, native-driven,
// so it costs nothing on the JS thread.
export function Skeleton({
  height = 16,
  width = '100%',
  radius = 8,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: object;
}) {
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
      style={[{ height, width, borderRadius: radius, backgroundColor: theme.muted, opacity: pulse }, style]}
    />
  );
}

/** A stack of card-shaped skeletons, sized to the list it stands in for. */
export function SkeletonList({ rows = 4, height = 84 }: { rows?: number; height?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={12} style={styles.skeletonRow} />
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
  return (
    <View style={styles.center} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.glyph}>!</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
      {onRetry ? (
        <View style={styles.action}>
          <Button label={retryLabel} onPress={onRetry} busy={busy} />
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
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.body}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

// ── Offline ─────────────────────────────────────────────────────────────────
/** Persistent bar; the SOW is explicit that the app must fail loudly, not hide. */
export function OfflineBanner({ message }: { message: string }) {
  return (
    <View style={styles.offline} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.offlineText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: 24,
    paddingEnd: 24,
    gap: 6,
  },
  glyph: {
    fontSize: 28,
    fontWeight: '800',
    color: theme.danger,
    marginBottom: 4,
  },
  title: { fontSize: 17, fontWeight: '700', color: theme.fg, textAlign: 'center' },
  body: { fontSize: 14, color: theme.mutedFg, textAlign: 'center', lineHeight: 20 },
  action: { alignSelf: 'stretch', marginTop: 4 },
  skeletonList: { paddingTop: 4 },
  skeletonRow: { marginBottom: 12 },
  offline: {
    backgroundColor: theme.danger,
    paddingTop: 8,
    paddingBottom: 8,
    paddingStart: 16,
    paddingEnd: 16,
  },
  offlineText: {
    color: theme.dangerContrast,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
