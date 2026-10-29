/**
 * One page of a stepped start (Sait, 2026-10-17; the "Form template" board):
 * the native header names the feature, the page asks one question with its
 * step under it in small blue, one card of fields follows, and the bar at the
 * foot holds the progress line and the one way on. There is no Back in the
 * bar and no step strip on top: each step is its own page on the (staff)
 * stack, so the native back goes back a step.
 */
import { type ReactNode, type RefObject } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, space, useTheme } from '../../../theme';
import { Button, ErrorText, MicroLabel, Screen } from '../../../components/ui';

export interface StepAction {
  testID: string;
  label: string;
  /** `cta` (green) for the start itself, the primary blue otherwise. */
  variant?: 'primary' | 'cta';
  busy?: boolean;
  onPress: () => void;
}

export function StepPage({
  title,
  question,
  stepLine,
  lead,
  done,
  total,
  action,
  error,
  scrollRef,
  children,
}: {
  /** The native header: the feature's name. */
  title: string;
  question: string;
  /** "Step 2 of 4", or "Step 2 of 4 · Barista". */
  stepLine: string;
  lead?: string | null;
  /** Steps finished, for the progress line. */
  done: number;
  total: number;
  action: StepAction;
  error?: string | null;
  scrollRef?: RefObject<ScrollViewInstance | null>;
  children: ReactNode;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const insets = useSafeAreaInsets();
  // A sliver at none done, so the track reads as a track (the board's 4%).
  const share = Math.max(done / total, 0.04);
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingTop: space.m, paddingBottom: space.xl, gap: space.sm }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display800, fontSize: 26, lineHeight: 32, color: colors.ink }}>
              {question}
            </Text>
            <MicroLabel style={{ marginTop: space.xs, color: colors.blue, letterSpacing: locale === 'ar' ? 0 : tracking(0.88) }}>
              {stepLine}
            </MicroLabel>
            {lead ? (
              <Text style={{ marginTop: space.xs, fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>{lead}</Text>
            ) : null}
          </View>
          {children}
        </ScrollView>
        <View
          style={{
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.m),
            paddingHorizontal: space.l,
            marginHorizontal: -space.l,
            gap: 10,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.bg,
          }}
        >
          {error ? <ErrorText>{error}</ErrorText> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
              {t('staff.protocols.start.flow.progress', { done: formatNumber(done, locale), total: formatNumber(total, locale) })}
            </Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.seg, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${Math.round(share * 100)}%`, backgroundColor: brand.green }} />
            </View>
          </View>
          <Button
            testID={action.testID}
            label={action.label}
            variant={action.variant ?? 'primary'}
            busy={action.busy}
            onPress={action.onPress}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** A field's label above it, in sentence case (the board's 13.5 semibold). */
export function FieldLabel({ children }: { children: string }) {
  const { colors, fonts } = useTheme();
  return <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 18, color: colors.ink }}>{children}</Text>;
}

/** The card a step's fields sit in: one surface, 14 in and 14 between. */
export function StepCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 16,
        padding: space.m,
        gap: space.m,
      }}
    >
      {children}
    </View>
  );
}

/** A caption over a group (the role groups, the title's card). */
export function StepCaption({ children }: { children: string }) {
  return <MicroLabel style={{ paddingStart: space.xs, marginBottom: -space.xs }}>{children}</MicroLabel>;
}
