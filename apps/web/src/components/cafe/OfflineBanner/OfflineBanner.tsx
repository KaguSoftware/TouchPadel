'use client';

import { makeT, type Locale } from '@touch/i18n';

/**
 * Offline notice (web-slice §7 — no service worker: the app is useless
 * offline, and a SW would serve stale prices). `role="status"` so it is
 * announced once; nothing else on the page moves (it is fixed above the bar).
 */
export function OfflineBanner({ locale, online }: { locale: Locale; online: boolean }) {
  if (online) return null;
  return (
    <div className="tp-offline" role="status">
      {makeT(locale)('cafe.offline')}
    </div>
  );
}
