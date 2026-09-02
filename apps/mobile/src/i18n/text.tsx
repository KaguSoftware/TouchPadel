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
import type { ComponentRef, Ref } from 'react';
import { Text as RNText, type TextProps } from 'react-native';
import { useLocale } from './LocaleProvider';

export type AppTextProps = TextProps & { ref?: Ref<ComponentRef<typeof RNText>> };

export function Text({ style, ref, ...rest }: AppTextProps) {
  const { dir } = useLocale();
  return <RNText ref={ref} {...rest} style={[{ writingDirection: dir }, style]} />;
}
