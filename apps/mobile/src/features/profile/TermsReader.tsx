import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PRIVACY_SECTIONS, TERMS_SECTIONS, legalParams } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { useVenueSettings } from '../availability/hooks';
import { readToEnd } from './consent';
import { LegalDocument } from './LegalDocument';
import { brand, space, useTheme } from '../../theme';
import { Button, Card, ErrorText, Screen, Title } from '../../components/ui';
import { CheckIcon } from '../../components/icons';

/** A document's header in the reading box: "Part 1 of 2" over its title. */
function PartHeader({ part, title }: { part: number; title: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderTopWidth: part > 1 ? 1 : 0,
        borderColor: colors.line,
        paddingHorizontal: space.m,
        paddingVertical: space.sm,
      }}
    >
      <Text
        style={{ fontFamily: fonts.body700, fontSize: 11, lineHeight: 15, color: colors.gstrong }}
      >
        {t('consent.part', { n: part, total: 2 })}
      </Text>
      <Text
        style={{ fontFamily: fonts.display900, fontSize: 17, lineHeight: 23, color: colors.ink }}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * The Terms and the Privacy Policy in full, in a box the guest scrolls; the
 * agree checkbox stays locked until they reach the end, and Accept until it is
 * ticked. The text is the same section list the public pages render
 * (packages/i18n/src/legal.ts).
 *
 * One reader, two sheets: the consent gate (app/accept-terms.tsx) records the
 * acceptance on the server; the sign-up review (app/terms-review.tsx) has no
 * session yet and hands it back to the sign-up checkbox. What Accept does is
 * the caller's.
 *
 * Derives its children's ids from `testID` (`<testID>.accept`, …).
 */
export function TermsReader({
  testID,
  onAccept,
  busy = false,
  error = null,
  footer = null,
}: {
  testID: string;
  onAccept: () => void;
  busy?: boolean;
  error?: string | null;
  /**
   * Under the scroll hint: the consent gate's ways out (sign out, delete
   * instead), or the sign-up review's Not now.
   */
  footer?: ReactNode;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const settings = useVenueSettings();
  const [read, setRead] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // The box's last measurements; once read, it stays read.
  const metrics = useRef({ offsetY: 0, viewportHeight: 0, contentHeight: 0 });
  const measure = (next: Partial<typeof metrics.current>) => {
    metrics.current = { ...metrics.current, ...next };
    if (!read && readToEnd(metrics.current)) setRead(true);
  };

  const params = legalParams(locale, settings.data?.cancellation_window_hours);
  const phone = settings.data?.phone;

  return (
    // A modal sheet starts below the status bar, so no top inset here.
    // The bottom safe-area inset comes from `edges`; the button keeps its own air above it.
    <Screen gutter={20} edges={['bottom']} style={{ paddingTop: space.xxl + space.xl }}>
      <Title plain>{t('consent.title')}</Title>
      <Text
        style={{
          fontFamily: fonts.body400,
          fontSize: 14,
          lineHeight: 22,
          color: colors.mut,
          marginTop: space.sm,
        }}
      >
        {t('consent.body')}
      </Text>

      <Card style={{ flex: 1, padding: 0, marginTop: space.m, overflow: 'hidden' }}>
        {/* Two parts, each under its own header; the header of the part being
            read stays pinned to the top of the box. */}
        <ScrollView
          testID={`${testID}.document`}
          stickyHeaderIndices={[0, 2]}
          contentContainerStyle={{ paddingBottom: space.m }}
          scrollEventThrottle={64}
          onLayout={(e) => measure({ viewportHeight: e.nativeEvent.layout.height })}
          onContentSizeChange={(_w, h) => measure({ contentHeight: h })}
          onScroll={(e) => measure({ offsetY: e.nativeEvent.contentOffset.y })}
        >
          <PartHeader part={1} title={t('legal.terms.title')} />
          <View style={{ padding: space.m }}>
            <LegalDocument
              locale={locale}
              intro="legal.terms.intro"
              sections={TERMS_SECTIONS}
              params={params}
              phone={phone}
            />
          </View>
          <PartHeader part={2} title={t('legal.privacy.title')} />
          <View style={{ padding: space.m }}>
            <LegalDocument
              locale={locale}
              intro="legal.privacy.intro"
              sections={PRIVACY_SECTIONS}
              params={params}
              phone={phone}
            />
          </View>
        </ScrollView>
      </Card>

      {/* The sign-up form's checkbox (app/sign-up.tsx); locked until the text is read to the end.
          The whole row toggles, so the sentence is a real target too. */}
      <Pressable
        testID={`${testID}.agree-row`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed, disabled: !read }}
        accessibilityLabel={t('consent.agree')}
        accessibilityHint={read ? undefined : t('consent.scrollHint')}
        disabled={!read}
        onPress={() => setAgreed((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          marginTop: space.m,
          opacity: read ? 1 : 0.45,
        }}
      >
        <View
          testID={`${testID}.agree`}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            // An empty box is still a control: fnt clears 3:1 on the card.
            borderColor: agreed ? brand.green : colors.fnt,
            backgroundColor: agreed ? brand.green : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {agreed ? <CheckIcon size={13} color={brand.greenInk} strokeWidth={3} /> : null}
        </View>
        <Text
          style={{
            flex: 1,
            fontFamily: fonts.body600,
            fontSize: 13,
            lineHeight: 19,
            color: colors.ink,
          }}
        >
          {t('consent.agree')}
        </Text>
      </Pressable>
      <ErrorText>{error}</ErrorText>

      <Button
        testID={`${testID}.accept`}
        label={t('consent.accept')}
        variant="primary"
        busy={busy}
        disabled={!agreed}
        onPress={() => {
          if (agreed && !busy) onAccept();
        }}
        style={{ marginTop: space.m }}
      />
      {/* Kept in the layout once read (just hidden), so the box above never jumps. */}
      <Text
        accessibilityElementsHidden={read}
        importantForAccessibility={read ? 'no-hide-descendants' : 'auto'}
        style={{
          fontFamily: fonts.body400,
          fontSize: 12,
          lineHeight: 17,
          color: colors.mut,
          textAlign: 'center',
          marginTop: space.sm,
          marginBottom: space.l,
          opacity: read ? 0 : 1,
        }}
      >
        {t('consent.scrollHint')}
      </Text>
      {footer}
    </Screen>
  );
}
