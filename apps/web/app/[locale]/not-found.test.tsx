import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { t } from '@touch/i18n';
import LocaleNotFound from './not-found';

/**
 * The 404 inside the `[locale]` segment. Next 16 hands `not-found` no params,
 * so the page cannot know the reading language and shows BOTH — which makes it
 * the one screen here with no `describe.each` over locales: every case asserts
 * the English and the Arabic copy together.
 */
describe('locale not-found', () => {
  it('shows the not-found line in both languages', () => {
    render(<LocaleNotFound />);

    expect(screen.getByText(t('ar', 'errors.notFound'))).toBeTruthy();
    expect(screen.getByText(t('en', 'errors.notFound'))).toBeTruthy();
  });

  it('marks each paragraph with its own lang and dir', () => {
    render(<LocaleNotFound />);

    // The one place in the app below <html> that sets `dir` itself: the two
    // paragraphs are opposite directions on the same page, so neither can
    // inherit it (layout.tsx sets a single `dir` for the document).
    const arabic = screen.getByText(t('ar', 'errors.notFound'));
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');

    const english = screen.getByText(t('en', 'errors.notFound'));
    expect(english.getAttribute('lang')).toBe('en');
    expect(english.getAttribute('dir')).toBe('ltr');
  });

  it('links back to a menu root in each locale', () => {
    render(<LocaleNotFound />);

    const arabic = screen.getByRole('link', { name: t('ar', 'cafe.browseMenu') });
    expect(arabic.getAttribute('href')).toBe('/ar');
    expect(arabic.getAttribute('lang')).toBe('ar');

    const english = screen.getByRole('link', { name: t('en', 'cafe.browseMenu') });
    expect(english.getAttribute('href')).toBe('/en');
    expect(english.getAttribute('lang')).toBe('en');
  });
});
