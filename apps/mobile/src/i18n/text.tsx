/**
 * `<Text>` WITH A BASE WRITING DIRECTION.
 *
 * Yoga mirrors boxes; it does not decide where a paragraph's text sits inside
 * its box. That is the text engine's job, and with `textAlign` left unset —
 * which is the rule everywhere in this app (components/ui.tsx) — the two
 * platforms disagreed:
 *
 *  - Android resolves alignment against the paragraph's LAYOUT DIRECTION
 *    (TextLayoutManager.getTextAlignment reads TA_KEY_LAYOUT_DIRECTION), so it
 *    followed the language and was always right.
 *  - iOS sets no paragraph alignment at all when `textAlign` is absent
 *    (RCTAttributedTextUtils: `alignment` has no value → no paragraph style),
 *    leaving TextKit on NSTextAlignmentNatural + NSWritingDirectionNatural.
 *    "Natural" there means the FIRST STRONG CHARACTER of the string decides.
 *    So in Arabic every heading whose text happens to start with Latin or with
 *    a substituted value — a court name, a booking reference, a price, a time,
 *    a person's name, "Touch Padel" — stayed pinned to the LEFT while the page
 *    around it had mirrored. That is the bug this fixes.
 *
 * Naming the paragraph's base direction removes the guess: `writingDirection`
 * sets NSWritingDirection on iOS, so natural alignment resolves from the
 * LANGUAGE rather than from the content, and mixed Arabic/Latin runs order the
 * way an Arabic reader expects. Android ignores the attribute (Fabric's
 * TA_KEY_BEST_WRITING_DIRECTION is a no-op there) and keeps the behaviour it
 * already had.
 *
 * It is a style, so a caller can still override it — `writingDirection: 'ltr'`
 * on a box that must stay Latin-ordered, exactly as `Field` does for the email
 * and password inputs.
 *
 * EVERY screen imports Text from here, never from react-native: alignment is a
 * native layout property that no typecheck can see, so the rule is pinned by
 * src/i18n/__tests__/direction.test.ts instead.
 */
import { createContext, useContext, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Animated, StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useLocale } from './LocaleProvider';

export type AppTextProps = TextProps & { ref?: Ref<ComponentRef<typeof RNText>> };

/**
 * The smallest text a part of the app draws (Sait, 2026-10-17: bigger text on
 * the staff pages, read at arm's length behind a bar or a counter). Under it,
 * a smaller size is raised to the floor and its line height grows with it.
 * Null, the default, leaves every size as written: the guest app is untouched.
 */
const MinFontSizeContext = createContext<number | null>(null);

/** The staff pages' smallest text, in points: Today, its sheets and every page they open. */
export const STAFF_MIN_FONT = 12.5;

export function MinFontSize({ value, children }: { value: number; children: ReactNode }) {
  return <MinFontSizeContext.Provider value={value}>{children}</MinFontSizeContext.Provider>;
}

/** `style` with any font size under `floor` raised to it. PURE apart from StyleSheet.flatten. */
export function raiseFontSize(style: TextProps['style'], floor: number): TextStyle | TextProps['style'] {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || typeof flat.fontSize !== 'number' || flat.fontSize >= floor) return style;
  const scale = floor / flat.fontSize;
  return {
    ...flat,
    fontSize: floor,
    ...(typeof flat.lineHeight === 'number' ? { lineHeight: Math.round(flat.lineHeight * scale) } : null),
  };
}

export function Text({ style: written, ref, ...rest }: AppTextProps) {
  const { dir } = useLocale();
  const floor = useContext(MinFontSizeContext);
  const style = floor === null ? written : raiseFontSize(written, floor);
  return <RNText ref={ref} {...rest} style={[{ writingDirection: dir }, style]} />;
}

/**
 * The same paragraph rule, for text whose STYLE IS ANIMATED.
 *
 * `Text` above is a plain function component: an `Animated.Value` handed to it
 * as a style value is never subscribed to, so it reaches the native side as an
 * unresolved node and the label paints BLACK — in both themes, which is only
 * visible in dark. `createAnimatedComponent` is what installs that
 * subscription, and it has to wrap this module's Text (not react-native's) so
 * the animated label keeps its writing direction like every other one.
 */
export const AnimatedText = Animated.createAnimatedComponent(Text);
