import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { AppBand } from './AppBand';
import { APP_SCREEN_MS } from './AppScreens';

/**
 * The app band: the three promises as tabs, each putting its real app screen (in the
 * page's language) on the phone; the band loops through them only while in view, and
 * a pick restarts the count from the picked screen. The cross-fade and the cut-off phone are
 * proven in a browser.
 */
const PHONE = '+964 770 123 4567';
const NO_STORES = { appStore: null, googlePlay: null };

let seen: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
class ControlledObserver {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    seen = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function band(locale: Locale = 'en', phone: string | null = PHONE) {
  return render(<AppBand locale={locale} stores={NO_STORES} phone={phone} />);
}
const shown = () => document.querySelector('.tp-appband__screen[data-on]')?.getAttribute('src');

beforeEach(() => {
  seen = null;
  vi.stubGlobal('IntersectionObserver', ControlledObserver);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AppBand', () => {
  it('names the band, lists the three promises and starts on the first screen', () => {
    band();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      `${t('en', 'site.app.titleOne')} ${t('en', 'site.app.titleTwo')}`,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      t('en', 'site.app.liveEyebrow') + t('en', 'site.app.liveTitle'),
      t('en', 'site.app.holdEyebrow') + t('en', 'site.app.holdTitle'),
      t('en', 'site.app.placeEyebrow') + t('en', 'site.app.placeTitle'),
    ]);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
    expect(screen.getByRole('img', { name: t('en', 'site.app.liveAlt') })).toBeTruthy();
    expect(shown()).toBe('/brand/app/availability-en.webp');
  });

  it('shows the Arabic screens on the Arabic page', () => {
    band('ar');
    expect(shown()).toBe('/brand/app/availability-ar.webp');
    expect(screen.getAllByRole('tab')[1]!.textContent).toContain(t('ar', 'site.app.holdTitle'));
  });

  it('puts the picked promise on the phone, by click and by arrow keys', () => {
    band();
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]!);
    expect(shown()).toBe('/brand/app/hold-en.webp');
    expect(tabs[1]!.getAttribute('tabindex')).toBe('0');
    expect(tabs[0]!.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowDown' });
    expect(shown()).toBe('/brand/app/reservations-en.webp');
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowDown' });
    expect(shown()).toBe('/brand/app/availability-en.webp');
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(shown()).toBe('/brand/app/reservations-en.webp');
  });

  it('loops on its own only while in view, and carries on from a picked promise', () => {
    band();
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS * 2));
    expect(shown()).toBe('/brand/app/availability-en.webp');

    act(() => seen!([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(shown()).toBe('/brand/app/hold-en.webp');

    act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(shown()).toBe('/brand/app/reservations-en.webp');
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(shown()).toBe('/brand/app/availability-en.webp');

    // A pick restarts the full count from the picked screen, then the loop goes on.
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS - 100));
    fireEvent.click(screen.getAllByRole('tab')[2]!);
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS - 100));
    expect(shown()).toBe('/brand/app/reservations-en.webp');
    act(() => vi.advanceTimersByTime(100));
    expect(shown()).toBe('/brand/app/availability-en.webp');

    act(() => seen!([{ isIntersecting: false }]));
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS * 3));
    expect(shown()).toBe('/brand/app/availability-en.webp');
  });

  it('books through the venue phone until the app ships, and shows both stores as soon', () => {
    band();
    expect(document.querySelector('[data-contact="whatsapp"]')).not.toBeNull();
    expect(document.querySelector('[data-contact="call"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: t('en', 'site.app.appStoreSoon') })).toBeTruthy();
    expect(screen.getByRole('img', { name: t('en', 'site.app.googlePlaySoon') })).toBeTruthy();
    expect(document.querySelector('.tp-stores a')).toBeNull();
  });

  it('falls back to "Plan your visit" with no venue phone', () => {
    band('en', null);
    expect(document.querySelector('[data-contact="visit"]')).not.toBeNull();
    expect(document.querySelector('[data-contact="call"]')).toBeNull();
  });
});
