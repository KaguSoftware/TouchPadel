import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { t } from '@touch/i18n';
import GlobalError from './global-error';

/**
 * The global error page (F-43): it replaces the root layout, so it brings its own document,
 * styled and in the visitor's language. Rendered into a real document here (it owns
 * <html> and <body>). What this proves, EN and AR: the copy, the language and direction,
 * the sheet, Try again through `retry()`, the way home, the automatic report to dev
 * monitoring, and the "Report this problem" button sending it as reported by a person.
 */
const reports = vi.hoisted(
  () => [] as { kind: string; userReported?: boolean; detail?: Record<string, unknown> }[],
);
vi.mock('@/lib/monitoring', () => ({
  reportError: (kind: string, _error: unknown, opts: { userReported?: boolean; detail?: Record<string, unknown> } = {}) => {
    reports.push({ kind, userReported: opts.userReported, detail: opts.detail });
    return Promise.resolve('sent');
  },
}));

let root: Root | null = null;

function mount(ui: React.ReactNode) {
  // The page owns <html>: mount it on the document itself.
  root = createRoot(document);
  act(() => root!.render(ui));
}

beforeEach(() => {
  reports.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  window.history.replaceState(null, '', '/');
});

const boom = Object.assign(new Error('layout exploded'), { digest: 'dg-123' });

describe.each(['en', 'ar'] as const)('global error page (%s)', (locale) => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/${locale}/menu`);
  });

  it('is a whole, styled document in the visitor’s language', () => {
    mount(<GlobalError error={boom} retry={() => {}} />);
    const html = document.documentElement;
    expect(html.getAttribute('lang')).toBe(locale);
    expect(html.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(html.getAttribute('data-theme')).toBe('padel');
    expect(document.querySelector('style')?.textContent).toContain('.tp-lost');
    expect(document.querySelector('h1')?.textContent).toBe(t(locale, 'site.error.title'));
    expect(document.body.textContent).toContain(t(locale, 'site.error.body'));
    const home = Array.from(document.querySelectorAll('a')).find(
      (a) => a.textContent === t(locale, 'site.error.home'),
    );
    expect(home?.getAttribute('href')).toBe(`/${locale}`);
  });

  it('retries through retry(), and reports the error to monitoring once on open', () => {
    const retry = vi.fn();
    mount(<GlobalError error={boom} retry={retry} />);
    expect(reports).toEqual([
      { kind: 'web_error', userReported: undefined, detail: { where: 'global', digest: 'dg-123' } },
    ]);
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === t(locale, 'site.error.retry'),
    )!;
    act(() => button.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('"Report this problem" sends it as reported by a person, and says so', async () => {
    mount(<GlobalError error={boom} retry={() => {}} />);
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === t(locale, 'site.error.report'),
    )!;
    await act(async () => {
      button.click();
    });
    expect(reports.at(-1)).toEqual({
      kind: 'crash',
      userReported: true,
      detail: { where: 'global', digest: 'dg-123' },
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(t(locale, 'site.error.reported'));
  });
});

it('renders on the server in Arabic, the default, with its own <html>', () => {
  const html = renderToString(<GlobalError error={boom} retry={() => {}} />);
  expect(html).toMatch(/^<html lang="ar" dir="rtl"/);
  expect(html).toContain(t('ar', 'site.error.title'));
});
