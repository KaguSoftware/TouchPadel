/**
 * One full-screen state: an emblem, a title, what happened, and the actions
 * pinned to the bottom. The payment screen renders exactly one of these per
 * server answer (app/pay/status.tsx), and app/+not-found.tsx borrows it.
 *
 * It is the same vocabulary Review's hold-expired / slot-taken states and the
 * success screen already speak (a 64 pt tinted disc, an uppercase display
 * title, a muted body, stacked full-width actions), so a guest who has seen
 * one of those recognises this at a glance. Nothing animates but the spinner:
 * the only motion on a payment screen should be "still working".
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../i18n/text';
import { radius, space, useTheme } from '../../theme';
import { CheckIcon, PadelBallIcon, StopwatchIcon } from '../../components/icons';

/** What the emblem says before the words do. */
export type PayTone = 'progress' | 'wait' | 'good' | 'bad' | 'neutral' | 'missing';

function Emblem({ tone }: { tone: PayTone }) {
  const { colors, fonts } = useTheme();
  if (tone === 'missing') return <PadelBallIcon size={58} opacity={0.85} />;
  const ground = {
    progress: colors.tint,
    wait: colors.amb,
    good: colors.gtint,
    bad: colors.redtint,
    neutral: colors.sub,
  }[tone];
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: radius.pill,
        backgroundColor: ground,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {tone === 'progress' ? (
        <ActivityIndicator color={colors.blue} />
      ) : tone === 'wait' ? (
        <StopwatchIcon size={26} color={colors.ambstrong} strokeWidth={2.2} />
      ) : tone === 'good' ? (
        <CheckIcon size={28} color={colors.gtext} strokeWidth={3} />
      ) : tone === 'bad' ? (
        <Text style={{ fontFamily: fonts.display800, fontSize: 22, color: colors.redtext }}>!</Text>
      ) : (
        <StopwatchIcon size={26} color={colors.fnt} strokeWidth={2.2} />
      )}
    </View>
  );
}

export function PayStateLayout({
  tone,
  title,
  body,
  notes,
  children,
  actions,
  testID,
}: {
  tone: PayTone;
  title: string;
  body: string;
  /** Extra sentences under the body (the hold's state, a refusal). */
  notes?: (string | null | false | undefined)[];
  /** The booking the payment is for, when it is known. */
  children?: ReactNode;
  /** Buttons, primary first. */
  actions?: ReactNode;
  /** `<route>.state.<kind>`: which state is on screen, for tests and support. */
  testID?: string;
}) {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const lines = (notes ?? []).filter((n): n is string => typeof n === 'string' && n.length > 0);
  return (
    <View testID={testID} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: 36, paddingBottom: space.l }}
        showsVerticalScrollIndicator={false}
      >
        <View
          accessibilityRole="summary"
          accessibilityLiveRegion="polite"
          style={{ alignItems: 'center', paddingStart: space.m, paddingEnd: space.m }}
        >
          <Emblem tone={tone} />
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: fonts.display900,
              fontSize: 20,
              textTransform: 'uppercase',
              color: colors.ink,
              marginTop: 18,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 13.5,
              lineHeight: 21,
              color: colors.mut,
              marginTop: 8,
              textAlign: 'center',
              maxWidth: 340,
            }}
          >
            {body}
          </Text>
          {lines.map((line) => (
            <Text
              key={line}
              style={{
                fontFamily: fonts.body600,
                fontSize: 12.5,
                lineHeight: 19,
                color: colors.mut2,
                marginTop: 8,
                textAlign: 'center',
                maxWidth: 340,
              }}
            >
              {line}
            </Text>
          ))}
        </View>
        {children ? <View style={{ marginTop: 26 }}>{children}</View> : null}
      </ScrollView>
      {actions ? (
        <View style={{ gap: 9, paddingTop: space.sm, paddingBottom: 20 + insets.bottom }}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}
