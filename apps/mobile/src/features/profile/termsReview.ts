/**
 * The hand-back from the sign-up terms review (app/terms-review.tsx) to the
 * sign-up form's checkbox (app/sign-up.tsx). No session exists yet, so nothing
 * is recorded: Accept only ticks the box, and the version still rides in the
 * sign-up metadata (consent.ts).
 *
 * A listener, not route params: the review is a modal that closes back onto a
 * form whose typed fields must survive, so the form stays mounted and is told.
 *
 * Pure: no React Native imports (vitest runs it in node).
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to "the guest accepted in the review"; returns the unsubscribe. */
export function onTermsReviewAccepted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the review when the guest accepts. */
export function termsReviewAccepted(): void {
  for (const listener of [...listeners]) listener();
}
