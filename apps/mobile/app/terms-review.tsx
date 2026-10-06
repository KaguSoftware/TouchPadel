import { useBack } from '../src/navigation/back';
import { TermsReader } from '../src/features/profile/TermsReader';
import { termsReviewAccepted } from '../src/features/profile/termsReview';

/**
 * The Terms and the Privacy Policy, opened from the sign-up form's checkbox:
 * the same reader as the consent gate (app/accept-terms.tsx). The guest reads
 * to the end, ticks, accepts, and the sheet closes onto the form with its
 * checkbox ticked. Nothing is recorded here; there is no account yet.
 *
 * A modal the guest CAN swipe away (app/_layout.tsx): closing it leaves the
 * box unticked.
 */
export default function TermsReviewScreen() {
  // Back to the sign-up form; a review opened with no history lands on it too.
  const back = useBack('/sign-up');
  return (
    <TermsReader
      testID="terms-review"
      onAccept={() => {
        termsReviewAccepted();
        back();
      }}
    />
  );
}
