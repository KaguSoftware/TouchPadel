import type { Locale } from '@touch/i18n';
import { notFound } from 'next/navigation';

export const LOCALES = ['en', 'ar'] as const;
/** Arabic is the default (owner decision, web-slice §0). */
export const DEFAULT_LOCALE: Locale = 'ar';
/** Cookie the locale switcher sets; proxy.ts reads it before Accept-Language. */
export const LOCALE_COOKIE = 'tp-locale';

export function isLocale(value: string): value is Locale {
  return value === 'en' || value === 'ar';
}

/**
 * Narrow an arbitrary route segment to a supported locale (default: 'ar').
 *
 * For the ROOT LAYOUT and the client error boundary only — the two places that
 * cannot 404 (Next forbids notFound() in a root layout) and must still pick a
 * `lang`/`dir` for whatever the page under them decides to render. A page
 * takes requireLocale() instead.
 */
export function asLocale(value: string): Locale {
  return value === 'en' ? 'en' : 'ar';
}

/**
 * The `[locale]` segment, refused rather than coerced.
 *
 * `[locale]` is the first segment of every route, so it matches ANY first
 * segment, and coercing the unknown ones to Arabic is how `/api/t`, `/x.y/t`
 * and `/.well-known/t` came to render the table page (security-audit
 * 2026-09-13 M3). proxy.ts now sends a bad first segment to a real locale
 * (where it 404s), but the proxy has a matcher and matchers get edited; a
 * dotted last segment or a `_next/` path still reaches a page with the proxy
 * never having run. This is the layer that holds regardless: every page and
 * every generateMetadata resolves its locale through here, so an unknown
 * value is a 404 before anything under `[locale]` renders.
 *
 * `dynamicParams = false` on the layout says the same thing declaratively,
 * but measured on the 16.3.4 production build (2026-09-20) it does nothing
 * for these routes: the tree is fully dynamic (C11), so no prerender entry
 * exists for the runtime to check against, and `/.well-known/t` came back
 * 200. Hence code, not config.
 *
 * RE-MEASURED 2026-09-21 on the same production build, with this function in
 * place: `/.well-known/t` and `/xx.y` are 404, `/xx/t/tok.x` is a 404 with an
 * empty body from the route handler. `notFound()` works from wherever it is
 * called — including, as `t/page.tsx` used to, from inside the JSX after the
 * awaits. The refusal was never the broken part.
 *
 * WHAT A 404 BODY CONTAINS, because a test was written against the wrong
 * belief about it (e2e/tests/web-security-headers.spec.ts): notFound() renders
 * `app/[locale]/not-found.tsx` INSIDE `app/[locale]/layout.tsx`, and that
 * layout inlines the whole cafe stylesheet. So a correct 404 carries every
 * class name in `src/styles/cafe/**` — `tp-cafe__table` included — as CSS
 * text. A class name is therefore not evidence that a page rendered. In `next
 * dev` it is not even that: the dev server answers a 404 with a bare shell and
 * none of the app's markup, so a body assertion that holds under `dev` says
 * nothing about the built app.
 */
export function requireLocale(value: string): Locale {
  if (!isLocale(value)) notFound();
  return value;
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

/**
 * Same page in another locale. Rewrites a leading /en|/ar, or prefixes a
 * locale-less path (the printed /t/{token}); search string preserved.
 */
export function hrefForLocale(pathname: string, search: string, locale: Locale): string {
  const stripped = pathname.replace(/^\/(en|ar)(?=\/|$)/, '');
  const base = stripped === '' ? '' : stripped;
  return `/${locale}${base}${search}`;
}
