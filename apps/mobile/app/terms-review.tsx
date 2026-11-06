import { useLocalSearchParams } from 'expo-router';
import { useBack } from '../src/navigation/back';
import { useLocale } from '../src/i18n/LocaleProvider';
import { TermsDocuments } from '../src/features/profile/TermsDocuments';
import { Button, Screen, Title } from '../src/components/ui';
import { space } from '../src/theme';

/**
 * One document, read-only (`?doc=terms|privacy`, default terms): opened from the
 * link beside its consent checkbox (sign-up form, app/accept-terms.tsx).
 * It records nothing and gates nothing; Close returns to where it came from.
 */
export default function TermsReviewScreen() {
  const { t } = useLocale();
  const back = useBack('/sign-up');
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const which = doc === 'privacy' ? 'privacy' : 'terms';
  return (
    // A modal sheet starts below the status bar, so no top inset here.
    <Screen gutter={20} edges={['bottom']} style={{ paddingTop: space.xxl + space.xl }}>
      <Title plain>{t(which === 'privacy' ? 'legal.privacy.title' : 'legal.terms.title')}</Title>
      <TermsDocuments testID="terms-review.document" doc={which} />
      <Button
        testID="terms-review.close"
        label={t('common.close')}
        variant="secondary"
        onPress={back}
        style={{ marginVertical: space.m }}
      />
    </Screen>
  );
}
