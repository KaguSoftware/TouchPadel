import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { ConsentCheckbox } from './ConsentCheckbox';
import { space, useTheme } from '../../theme';
import { Button, ErrorText, Screen, Title } from '../../components/ui';

/**
 * The consent sheet: one checkbox, and the Terms of Service and Privacy Policy
 * as links in its sentence that open the read-only viewer (app/terms-review.tsx).
 * No reading is required to tick. What Accept does is the caller's
 * (app/accept-terms.tsx records it on the server).
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
  /** Under Accept: the consent gate's way out (Not now). */
  footer?: ReactNode;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [agreed, setAgreed] = useState(false);

  return (
    <Screen gutter={20} edges={['bottom']} style={{ paddingTop: space.xxl + space.xl }}>
      <Title plain>{t('consent.title')}</Title>
      <Text style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 22, color: colors.mut, marginTop: space.sm }}>
        {t('consent.body')}
      </Text>

      <ConsentCheckbox testID={`${testID}.agree`} checked={agreed} onToggle={() => setAgreed((v) => !v)} />
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
      {footer ? <View style={{ marginTop: space.sm, marginBottom: space.l }}>{footer}</View> : null}
    </Screen>
  );
}
