/**
 * The main button in the same place on every staff form (Sait, 2026-10-17):
 * a bar at the foot of the screen that rides above the keyboard, with the
 * form's error line over the button. Its shape is the incident report's
 * bottom row (app/(staff)/staff-incident-report.tsx) and the tournament
 * start's (TournamentPlanStep.tsx): in the flow after the scroll, inside a
 * KeyboardAvoid, so it is never under the keyboard and the list never runs
 * under it; its home-indicator padding tucks under the keys.
 *
 * `ScreenWithBar` is the scroll and the bar together; a page passes its scroll
 * props (refresh control, content style) and the bar's buttons. Inside a
 * `Screen`, whose side gutter the bar bleeds through to reach both edges.
 */
import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiftAssistantFab } from '../features/assistant/AssistantFab';
import { space, useTheme } from '../theme';
import { ErrorText } from './ui';
import { KeyboardAvoid } from './KeyboardAvoid';

/** The bar's bottom padding: the home indicator's room, or `space.m` on a phone without one. */
export function useBottomBarPad(): number {
  return Math.max(useSafeAreaInsets().bottom, space.m);
}

export function BottomBar({ children, error }: { children: ReactNode; error?: string | null }) {
  const { colors } = useTheme();
  const pad = useBottomBarPad();
  return (
    <View
      style={{
        paddingTop: space.sm,
        paddingBottom: pad,
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
  // The floating assistant button rides above the bar instead of covering it.
  useLiftAssistantFab(!!bar);
  const pad = useBottomBarPad();
  return (
    <KeyboardAvoid footerPad={bar ? pad : 0}>
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
    </KeyboardAvoid>
  );
}
