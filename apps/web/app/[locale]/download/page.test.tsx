import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { renderServerPage } from '@/test/renderPage';
import DownloadPage from './page';

/**
 * The staff download page. Both buttons must point at the releases repo's
 * "latest" redirect with VERSION-LESS artifact names — that is the whole
 * contract with apps/operator-shell/electron-builder.config.cjs, and the only
 * reason this page never needs editing at release time. A renamed artifact is
 * a silent 404 for whoever is installing the till, so the filenames are
 * asserted literally.
 */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const LOCALES = ['en', 'ar'] as const;

describe.each(LOCALES)('download page (%s)', (locale: Locale) => {
  it('titles and describes itself in the reading language', async () => {
    await renderServerPage(DownloadPage, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t(locale, 'download.title'));
    expect(screen.getByText(t(locale, 'download.lead'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'download.smartScreenNote'))).toBeTruthy();
  });

  it('offers exactly two installers, at stable version-less URLs', async () => {
    await renderServerPage(DownloadPage, locale);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);

    const windows = screen.getByRole('link', { name: t(locale, 'download.windowsButton') });
    expect(windows.getAttribute('href')).toMatch(/\/Touch-Padel-Operator-Setup\.exe$/);
    expect(windows.getAttribute('href')).toContain('/releases/latest/download/');

    const mac = screen.getByRole('link', { name: t(locale, 'download.macButton') });
    expect(mac.getAttribute('href')).toMatch(/\/Touch-Padel-Operator-arm64\.dmg$/);
    expect(mac.getAttribute('href')).toContain('/releases/latest/download/');
  });
});

describe('download page locale guard', () => {
  it('404s on a segment that is not a locale', async () => {
    await expect(renderServerPage(DownloadPage, 'de' as unknown as Locale)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
