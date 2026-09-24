'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useParams } from 'next/navigation';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { DEFAULT_SITE_MODE, siteModeFromCookieString, type SiteMode } from '@/lib/site/mode';
import { siteLostCss } from '@/styles/site/lost.css';
import { LostCourt } from '@/components/site/LostCourt';

/**
 * Segment error boundary (client): "Let. Play that one again." (a let is a point that is
 * replayed), one plain sentence, retry, and the way home.
 *
 * It wraps EVERY route in the segment, the café menu's too, so it ships in their
 * JavaScript. It therefore carries only its own small sheet (`siteLostCss`, about 2 KB)
 * rather than the site's, and reads the visitor's mode from the cookie in the
 * browser: night on the server pass, the saved mode once mounted.
 */
const subscribe = () => () => {};
const readMode = (): SiteMode => siteModeFromCookieString(document.cookie);
const serverMode = (): SiteMode => DEFAULT_SITE_MODE;

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  const locale = asLocale(params?.locale ?? 'ar');
  const tr = makeT(locale);
  const mode = useSyncExternalStore(subscribe, readMode, serverMode);
  useEffect(() => {
    console.error('[site] route error:', error);
  }, [error]);
  return (
    <div data-theme="padel" data-mode={mode}>
      <style dangerouslySetInnerHTML={{ __html: siteLostCss }} />
      <main className="tp-lost tp-lost--bare">
        <LostCourt />
        <div className="tp-lost__copy">
          <h1 className="tp-lost__title tp-lost__title--sized">{tr('site.error.title')}</h1>
          <p className="tp-lost__body">{tr('site.error.body')}</p>
          <div className="tp-lost__actions">
            <button type="button" className="tp-lost__btn tp-lost__btn--go" onClick={() => reset()}>
              {tr('site.error.retry')}
            </button>
            <a className="tp-lost__btn" href={`/${locale}`}>
              {tr('site.error.home')}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
