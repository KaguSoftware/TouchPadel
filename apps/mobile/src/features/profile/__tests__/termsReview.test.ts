import { describe, expect, it, vi } from 'vitest';
import { onTermsReviewAccepted, termsReviewAccepted } from '../termsReview';

describe('terms review hand-back', () => {
  it('tells every subscribed form', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onTermsReviewAccepted(a);
    const offB = onTermsReviewAccepted(b);
    termsReviewAccepted();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('stops telling a form that has unsubscribed', () => {
    const a = vi.fn();
    const off = onTermsReviewAccepted(a);
    off();
    termsReviewAccepted();
    expect(a).not.toHaveBeenCalled();
  });
});
