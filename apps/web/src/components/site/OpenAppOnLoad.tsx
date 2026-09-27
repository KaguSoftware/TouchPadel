'use client';

import { useEffect, useRef } from 'react';
import { isAppDevice } from '@/lib/site/payReturn';

/**
 * The payment return page's automatic hop into the app: once, after the page has painted,
 * `location.replace(href)` on a phone or tablet (`isAppDevice`), nothing on a computer.
 *
 * `replace`, not an assignment, so the return page does not sit in the in-app browser's
 * history behind the app. The page underneath is complete without this: a browser that
 * refuses a scheme jump nobody tapped for (Chrome on Android does) leaves the visitor on
 * the heading and the Open the app button, which is the same link. Renders nothing.
 */
export function OpenAppOnLoad({ href }: { href: string }) {
  // Strict Mode runs a mount effect twice in development; the app should be asked once.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    openAppIfSupported(href, window.navigator, window.location);
  }, [href]);
  return null;
}

/** The effect itself, with the browser passed in (jsdom's `location.replace` cannot be spied on). */
export function openAppIfSupported(
  href: string,
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>,
  loc: Pick<Location, 'replace'>,
): boolean {
  if (!isAppDevice(nav.userAgent, nav.maxTouchPoints ?? 0)) return false;
  loc.replace(href);
  return true;
}
