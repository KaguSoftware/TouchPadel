import { View } from 'react-native';
import { useBack } from '../src/navigation/back';
import { useLocale } from '../src/i18n/LocaleProvider';
import { TermsReader } from '../src/features/profile/TermsReader';
import { termsReviewAccepted } from '../src/features/profile/termsReview';
import { space } from '../src/theme';
import { Button } from '../src/components/ui';

/**
 * The Terms and the Privacy Policy, opened from the sign-up form's checkbox:
 * the same reader as the consent gate (app/accept-terms.tsx). The guest reads
 * to the end, ticks, accepts, and the sheet closes onto the form with its
 * checkbox ticked. Nothing is recorded here; there is no account yet.
 *
 * A modal the guest CAN swipe away or close with Not now (app/_layout.tsx):
 * either leaves the box unticked, and sign-up refuses to submit until it is
 * ticked, so there is no way past the form without accepting.
 */
export default function TermsReviewScreen() {
  const { t } = useLocale();
  // Back to the sign-up form; a review opened with no history lands on it too.
  const back = useBack('/sign-up');
  return (
    <TermsReader
      testID="terms-review"
      onAccept={() => {
        termsReviewAccepted();
        back();
      }}
      footer={
        <View style={{ marginBottom: space.l }}>
          <Button
            testID="terms-review.not-now"
            label={t('consent.notNow')}
            variant="secondary"
            onPress={back}
          />
        </View>
      }
    />
  );
}
