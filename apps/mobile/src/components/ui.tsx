/**
 * Shared primitives, restyled to the approved design
 * (`docs/design/mobile-ui/Touch Padel App.dc.html`, 2026-08-31).
 *
 * All styles use LOGICAL properties only (paddingStart/End, marginStart/End) so
 * every screen mirrors correctly in RTL — unchanged rule from the functional
 * pass, now lint-enforced. Colors/fonts come exclusively from useTheme().
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, shadows, space, useTheme } from '../theme';
import { TitleSquiggle } from './icons';

export { TitleSquiggle };

// ── Navigation helpers ──────────────────────────────────────────────────────

/**
 * Back that cannot dead-end. Screens are reached by deep link (verification
 * and recovery emails, push taps) with no history beneath them; `router.back()`
 * is then a silent no-op and the guest is stuck. Fall back to the tabs.
 */
export function useSafeBack(): () => void {
  const router = useRouter();
  return () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
}

// ── Layout ──────────────────────────────────────────────────────────────────

export type ScreenEdge = 'top' | 'bottom';

/**
 * Screen root. Owns the safe-area insets so no screen has to remember them:
 * `edges` defaults to the top only — scrolling screens pad their own content
 * bottom (tab bar / home indicator), static screens ask for `['top','bottom']`.
 *
 * A screen UNDER A NATIVE HEADER must pass `edges={[]}` (or omit 'top'): the
 * bar already consumes the status-bar inset, so keeping the top padding here
 * applies it twice and pushes the page down by ~50pt.
 */
export function Screen({
  children,
  padded = true,
  gutter = space.l,
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  /** Horizontal inset when padded (design: 16 in the app, 20 on the auth screens). */
  gutter?: number;
  edges?: readonly ScreenEdge[];
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: colors.bg },
        edges.includes('top') && { paddingTop: insets.top },
        edges.includes('bottom') && { paddingBottom: insets.bottom },
        padded && { paddingStart: gutter, paddingEnd: gutter },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Scrolling form body with keyboard handling. There was not a single
 * KeyboardAvoidingView in the app: on a 667 pt phone the submit button of every
 * auth form sat under the keyboard.
 */
export function FormScreen({
  children,
  contentStyle,
  bottomInset = 40,
  ...scrollProps
}: ScrollViewProps & {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Extra space under the last control, added to the safe-area bottom. */
  bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        {...scrollProps}
        contentContainerStyle={[
          { paddingTop: 6, paddingBottom: bottomInset + insets.bottom },
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Big uppercase page title with the green squiggle underneath. */
export function Title({
  children,
  squiggle = true,
  plain = false,
  size = 26,
}: {
  children: ReactNode;
  squiggle?: boolean;
  /** Auth-screen variant: no tracking, no squiggle (design `font:900 26px Archivo`). */
  plain?: boolean;
  size?: number;
}) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View style={{ marginBottom: plain ? 0 : space.s }}>
      <Text
        style={{
          fontFamily: fonts.display900,
          fontSize: size,
          lineHeight: Math.round(size * 1.05),
          letterSpacing: plain ? 0 : tracking(-0.26),
          textTransform: 'uppercase',
          color: colors.ink,
        }}
      >
        {children}
      </Text>
      {squiggle && !plain ? <TitleSquiggle /> : null}
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

/**
 * The design's `border-top: 1px dashed`. RN only honours `borderStyle` when all
 * four borders are set, so a `borderTopWidth` divider rendered SOLID; clip a
 * fully-bordered 2 pt box to its top pixel row instead.
 */
export function DashedDivider({ color, style }: { color?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ height: 1, overflow: 'hidden' }, style]}>
      <View
        style={{
          height: 2,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderRadius: 1,
          borderColor: color ?? colors.line,
        }}
      />
    </View>
  );
}

/** Uppercase micro-label above sections/lists ("UPCOMING", "PAST"). */
export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts.display800,
          fontSize: 11,
          letterSpacing: tracking(1.1),
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

/** Small uppercase field/group label (design `font:700 11px Mulish`, `ls .06em`). */
export function MicroLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts.body700,
          fontSize: 11,
          letterSpacing: tracking(0.66),
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

export function Hint({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors, fonts } = useTheme();
  if (!children) return null;
  return (
    <Text
      style={[
        { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut, marginTop: space.xs },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme();
  if (!children) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.redtext, marginTop: space.s }}
    >
      {children}
    </Text>
  );
}

/**
 * Inline text link with a real touch target. The auth footers used bare
 * `<Text onPress>` — a 17 pt target with no role and no press feedback.
 */
export function LinkText({
  label,
  onPress,
  color,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      style={({ pressed }) => [{ alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 }, style]}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: color ?? colors.blue }}>{label}</Text>
    </Pressable>
  );
}

/**
 * "Lead text + link" sentence used under the auth forms: the lead in `mut`,
 * only the action in blue bold — the design's `New here? <b>Create an account</b>`.
 */
export function FooterLink({
  lead,
  label,
  onPress,
  style,
}: {
  lead: string;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10 }}
      style={({ pressed }) => [{ alignSelf: 'center', opacity: pressed ? 0.7 : 1 }, style]}
    >
      <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut, textAlign: 'center' }}>
        {lead}{' '}
        <Text style={{ fontFamily: fonts.body800, color: colors.blue }}>{label}</Text>
      </Text>
    </Pressable>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  /**
   * Force LTR entry in an RTL layout. Defaults on for email / phone / password
   * inputs, whose contents are Latin regardless of UI language (spec §06 Forms).
   */
  latin?: boolean;
  /** 13 pt vertical padding (edit-profile / change-password); default 14 (auth). */
  dense?: boolean;
}

export function Field({ label, error, latin, dense, style, onFocus, onBlur, ...inputProps }: FieldProps) {
  const { colors, fonts } = useTheme();
  const { dir } = useLocale();
  const [focused, setFocused] = useState(false);
  const isLatin =
    latin ??
    (inputProps.secureTextEntry === true ||
      inputProps.keyboardType === 'email-address' ||
      inputProps.keyboardType === 'phone-pad' ||
      inputProps.keyboardType === 'numeric');
  const forceLtr = isLatin && dir === 'rtl';
  return (
    <View style={{ marginTop: space.sm }}>
      {label ? <MicroLabel style={{ marginBottom: 5 }}>{label}</MicroLabel> : null}
      <TextInput
        style={[
          {
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: focused ? brand.green : error ? colors.redline : colors.line2,
            borderRadius: radius.cell,
            paddingStart: space.m,
            paddingEnd: space.m,
            paddingTop: dense ? 13 : 14,
            paddingBottom: dense ? 13 : 14,
            fontFamily: fonts.body600,
            fontSize: 14,
            color: colors.ink,
          },
          // The design's 2 px focus ring, drawn outside the border so the
          // field does not jump when it gains focus.
          focused && { boxShadow: `0 0 0 1 ${brand.green}` },
          // Latin content (email / phone / password) anchors to the physical
          // left even inside the RTL layout — spec §06 Forms. Deliberate
          // exception to the logical-properties rule.
          // eslint-disable-next-line no-restricted-syntax
          forceLtr && { textAlign: 'left', writingDirection: 'ltr' },
          style,
        ]}
        placeholderTextColor={colors.fnt2}
        autoCapitalize="none"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
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
  fit = false,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Active label color; defaults to the interactive blue. */
  activeColor?: string;
  /**
   * Intrinsic-width variant (the availability duration picker): segments size
   * to their labels, track radius 10 / thumb 8, 8×12 padding, 11.5 pt.
   */
  fit?: boolean;
}) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        alignSelf: fit ? 'flex-start' : 'stretch',
        backgroundColor: colors.seg,
        borderRadius: fit ? 10 : radius.cell,
        padding: 3,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[
              {
                flex: fit ? 0 : 1,
                borderRadius: fit ? 8 : 9,
                paddingTop: fit ? 8 : 10,
                paddingBottom: fit ? 8 : 10,
                paddingStart: fit ? 12 : 4,
                paddingEnd: fit ? 12 : 4,
                alignItems: 'center',
                backgroundColor: active ? colors.card : 'transparent',
              },
              active && { boxShadow: shadows.thumb },
            ]}
          >
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: fit ? 11.5 : 12,
                letterSpacing: tracking(0.36),
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

export type ButtonSize = 'regular' | 'medium' | 'compact';

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
  /**
   * regular — radius 14 / padding 15 / 13 pt (main CTAs)
   * medium  — radius 14 / padding 14 / 12 pt (Sign out, Close, Resend, Back to sign in, Done)
   * compact — radius 12 / padding 13 / 12 pt (dialog buttons, Cancel booking, Call the venue,
   *           Enable notifications, empty-state Book a court)
   */
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
  /** Override the label color (e.g. light text on the navy success screen). */
  labelColor?: string;
  /** Background while pressed (design `active` states); defaults to a dim. */
  pressedBg?: string;
}

const SIZES: Record<ButtonSize, { radius: number; padV: number; font: number; ls: number; minH: number }> = {
  regular: { radius: radius.button, padV: 15, font: 13, ls: 0.65, minH: 50 },
  medium: { radius: radius.button, padV: 14, font: 12, ls: 0.6, minH: 46 },
  compact: { radius: radius.cell, padV: 13, font: 12, ls: 0.48, minH: 44 },
};

export function Button({
  label,
  onPress,
  disabled,
  busy,
  variant = 'primary',
  size = 'regular',
  style,
  labelColor,
  pressedBg,
}: ButtonProps) {
  const { colors, fonts, tracking } = useTheme();
  const visual = {
    cta: { bg: brand.green, fg: brand.greenInk, border: 'transparent' },
    primary: { bg: brand.blue, fg: brand.white, border: 'transparent' },
    secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
    danger: { bg: brand.danger, fg: brand.white, border: 'transparent' },
    dangerOutline: { bg: colors.card, fg: colors.redtext, border: colors.redline },
    ghost: { bg: 'transparent', fg: colors.mut, border: 'transparent' },
  }[variant];
  const ghost = variant === 'ghost';
  const s = SIZES[size];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      hitSlop={ghost ? 8 : undefined}
      style={({ pressed }) => [
        {
          borderRadius: s.radius,
          paddingTop: ghost ? 8 : s.padV,
          paddingBottom: ghost ? 8 : s.padV,
          paddingStart: space.l,
          paddingEnd: space.l,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: ghost ? 36 : s.minH,
          backgroundColor: pressed && pressedBg ? pressedBg : visual.bg,
          borderWidth: visual.border === 'transparent' ? 0 : 1.5,
          borderColor: visual.border,
          opacity: disabled || busy ? 0.55 : pressed && !pressedBg ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor ?? visual.fg} />
      ) : (
        <Text
          style={{
            fontFamily: ghost ? fonts.body700 : fonts.display800,
            fontSize: ghost ? 12.5 : s.font,
            letterSpacing: ghost ? 0 : tracking(s.ls),
            textTransform: ghost ? 'none' : 'uppercase',
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
