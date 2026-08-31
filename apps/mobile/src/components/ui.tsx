/**
 * Shared primitives, restyled to the approved design
 * (`docs/design/mobile-ui/Touch Padel App.dc.html`, 2026-08-31).
 *
 * All styles use LOGICAL properties only (paddingStart/End, marginStart/End) so
 * every screen mirrors correctly in RTL — unchanged rule from the functional
 * pass, now lint-enforced. Colors/fonts come exclusively from useTheme().
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { brand, radius, space, useTheme } from '../theme';
import { BackChevronIcon, TitleSquiggle } from './icons';

export { TitleSquiggle };

// ── Layout ──────────────────────────────────────────────────────────────────

export function Screen({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: colors.bg },
        padded && { paddingStart: space.l, paddingEnd: space.l },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Big uppercase page title with the green squiggle underneath. */
export function Title({ children, squiggle = true }: { children: ReactNode; squiggle?: boolean }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ marginBottom: space.s }}>
      <Text
        style={{
          fontFamily: fonts.display900,
          fontSize: 26,
          lineHeight: 30,
          letterSpacing: -0.26,
          textTransform: 'uppercase',
          color: colors.ink,
        }}
      >
        {children}
      </Text>
      {squiggle ? <TitleSquiggle /> : null}
    </View>
  );
}

/** In-screen header row: round back button + compact display title. */
export function ScreenHeader({ title, onBack }: { title?: string; onBack?: () => void }) {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  return (
    <View
      style={{
        paddingTop: space.s + 2,
        paddingBottom: space.s + 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack ?? (() => router.back())}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: radius.pill,
          backgroundColor: pressed ? colors.sub : colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <BackChevronIcon size={17} color={colors.ink} strokeWidth={2.4} />
      </Pressable>
      {title ? (
        <Text style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}>{title}</Text>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          padding: space.l,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Uppercase micro-label above sections/lists ("UPCOMING", "PAST"). */
export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts.display800,
          fontSize: 11,
          letterSpacing: 1.1,
          textTransform: 'uppercase',
          color: colors.mut,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

export function Hint({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme();
  if (!children) return null;
  return (
    <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut, marginTop: space.xs }}>
      {children}
    </Text>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme();
  if (!children) return null;
  return (
    <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.redtext, marginTop: space.s }}>
      {children}
    </Text>
  );
}

export function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue, marginTop: space.m }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

export function Field({ label, error, style, ...inputProps }: FieldProps) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ marginTop: space.sm }}>
      {label ? (
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: 11,
            letterSpacing: 0.66,
            textTransform: 'uppercase',
            color: colors.mut,
            marginBottom: 5,
          }}
        >
          {label}
        </Text>
      ) : null}
      <TextInput
        style={[
          {
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: error ? colors.redline : colors.line2,
            borderRadius: radius.cell,
            paddingStart: space.m,
            paddingEnd: space.m,
            paddingTop: 13,
            paddingBottom: 13,
            fontFamily: fonts.body600,
            fontSize: 14,
            color: colors.ink,
          },
          style,
        ]}
        placeholderTextColor={colors.fnt2}
        autoCapitalize="none"
        {...inputProps}
      />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** Design's segmented control (duration, language, appearance pickers). */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  activeColor,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Active label color; defaults to the interactive blue. */
  activeColor?: string;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: colors.seg, borderRadius: radius.cell, padding: 3 }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[
              {
                flex: 1,
                borderRadius: 9,
                paddingTop: 10,
                paddingBottom: 10,
                alignItems: 'center',
                backgroundColor: active ? colors.card : 'transparent',
              },
              active && {
                shadowColor: brand.navy,
                shadowOpacity: 0.12,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
                elevation: 1,
              },
            ]}
          >
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: 12,
                letterSpacing: 0.36,
                color: active ? (activeColor ?? colors.blue) : colors.mut,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /**
   * cta           — the big green brand button (design's main action)
   * primary       — blue filled (auth actions; fixed brand blue in both themes, per design)
   * secondary     — outlined on card
   * danger        — red filled
   * dangerOutline — outlined red (cancel booking)
   * ghost         — borderless muted text button
   */
  variant?: 'cta' | 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost';
  style?: StyleProp<ViewStyle>;
  /** Override the label color (e.g. light text on the navy success screen). */
  labelColor?: string;
}

export function Button({ label, onPress, disabled, busy, variant = 'primary', style, labelColor }: ButtonProps) {
  const { colors, fonts } = useTheme();
  const visual = {
    cta: { bg: brand.green, fg: brand.greenInk, border: 'transparent' },
    primary: { bg: brand.blue, fg: brand.white, border: 'transparent' },
    secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
    danger: { bg: brand.danger, fg: brand.white, border: 'transparent' },
    dangerOutline: { bg: colors.card, fg: colors.redtext, border: colors.redline },
    ghost: { bg: 'transparent', fg: colors.mut, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        {
          borderRadius: radius.button,
          paddingTop: variant === 'ghost' ? 8 : 15,
          paddingBottom: variant === 'ghost' ? 8 : 15,
          paddingStart: space.l,
          paddingEnd: space.l,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: variant === 'ghost' ? 36 : 50,
          backgroundColor: visual.bg,
          borderWidth: visual.border === 'transparent' ? 0 : 1.5,
          borderColor: visual.border,
          opacity: disabled || busy ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor ?? visual.fg} />
      ) : (
        <Text
          style={{
            fontFamily: variant === 'ghost' ? fonts.body700 : fonts.display800,
            fontSize: variant === 'ghost' ? 12.5 : 13,
            letterSpacing: variant === 'ghost' ? 0 : 0.65,
            textTransform: variant === 'ghost' ? 'none' : 'uppercase',
            color: labelColor ?? visual.fg,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.blue} size="large" />
    </View>
  );
}
