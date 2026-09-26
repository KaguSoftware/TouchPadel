import type { ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import type { Locale } from '@touch/i18n';

/**
 * Smoke-render an async Server Component page in jsdom.
 *
 * Every page under `app/[locale]/` is `async (props: { params: Promise<{ locale }> })`,
 * which React's client renderer cannot mount directly. There is no RSC runtime
 * here and there does not need to be one: a page is a function, so we call it,
 * await the element it returns, and hand THAT to `@testing-library/react`. The
 * page's own server work (`requireLocale`, the cached reads) really runs; only
 * the streaming boundary is skipped.
 *
 * What this deliberately does NOT render is `app/[locale]/layout.tsx` — the
 * only place `dir` is set (on `<html>`, from `dirAttr(locale)`). So an Arabic
 * assertion in a page test is about the Arabic STRINGS the page chose, never
 * about a wrapper's direction: there is no RTL wrapper below the layout to
 * assert on. `e2e/tests/cafe-rtl-layout.spec.ts` is what checks the rendered
 * direction, with a real document around it.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export type ServerPage = (props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) => Promise<ReactNode>;

/** A page's props as Next hands them over: the locale, and the query (none by default). */
export function pageProps(
  locale: string,
  searchParams: SearchParams = {},
): { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> } {
  return { params: Promise.resolve({ locale }), searchParams: Promise.resolve(searchParams) };
}

export async function renderServerPage(
  Page: ServerPage,
  locale: Locale,
  searchParams: SearchParams = {},
): Promise<RenderResult> {
  const element = await Page(pageProps(locale, searchParams));
  return render(element);
}

/**
 * The `tp-table` cookie the mocked `next/headers` serves, as mutable state —
 * same reason as `serverData` in ./fixtures (module mock factories run once,
 * `restoreMocks: true` would wipe a `vi.fn()` implementation between cases).
 */
export const cookieJar: { table: string | null } = { table: null };

export function resetCookieJar(): void {
  cookieJar.table = null;
}

/** The object shape `cookies()` resolves to, for the pages that read one cookie. */
export function fakeCookieStore(): {
  get(name: string): { name: string; value: string } | undefined;
} {
  return {
    get(name: string) {
      if (name === 'tp-table' && cookieJar.table !== null) {
        return { name, value: cookieJar.table };
      }
      return undefined;
    },
  };
}

/** The object shape `headers()` resolves to: nothing set, like a plain request. */
export function fakeHeaderStore(): { get(name: string): string | null } {
  return { get: () => null };
}
