/**
 * The main button in the same place on every staff form (Sait, 2026-10-17):
 * a bar at the foot of the screen that rides above the keyboard, with the
 * form's error line over the button. Its shape is the incident report's
 * bottom row (app/(staff)/staff-incident-report.tsx) and the tournament
 * start's (TournamentPlanStep.tsx): in the flow after the scroll, inside a
 * KeyboardAvoidingView, so it is never under the keyboard and the list never
 * runs under it.
 *
 * `ScreenWithBar` is the scroll and the bar together; a page passes its scroll
 * props (refresh control, content style) and the bar's buttons. Inside a
 * `Screen`, whose side gutter the bar bleeds through to reach both edges.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, useTheme } from '../theme';
import { ErrorText } from './ui';

/** The native bar over a staff page, as the incident report and the tournament start offset it. */
const HEADER_OFFSET = 100;

export function BottomBar({ children, error }: { children: ReactNode; error?: string | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: space.sm,
        paddingBottom: Math.max(insets.bottom, space.m),
        paddingHorizontal: space.l,
        marginHorizontal: -space.l,
        gap: space.s,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.bg,
      }}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}
      {children}
    </View>
  );
}

export function ScreenWithBar({
  bar,
  error,
  children,
  contentContainerStyle,
  ...scrollProps
}: ScrollViewProps & {
  /** The bar's buttons; null for a reader with nothing to send (no bar). */
  bar: ReactNode | null;
  /** The form's line over the button: a server refusal, or what is missing. */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? HEADER_OFFSET : 0}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        {...scrollProps}
        contentContainerStyle={[{ paddingBottom: space.xl }, contentContainerStyle]}
      >
        {children}
      </ScrollView>
      {bar ? <BottomBar error={error}>{bar}</BottomBar> : null}
    </KeyboardAvoidingView>
  );
}
