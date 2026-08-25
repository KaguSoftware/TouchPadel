'use client';

import { makeT, type Locale } from '@touch/i18n';

/**
 * "Back to top" FAB on the trailing edge. Hidden near the top of the menu,
 * while the footer is on screen (it would collide with the credit line), and
 * whenever a sheet owns the screen. Kept mounted so it can animate out.
 */
export function ScrollTopFab({
  locale,
  visible,
  onClick,
}: {
  locale: Locale;
  visible: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="tp-fab tp-fab--top"
      data-hidden={visible ? undefined : 'true'}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? undefined : -1}
      aria-label={makeT(locale)('cafe.scrollTop')}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M12 19V6M12 6l-6 6M12 6l6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
