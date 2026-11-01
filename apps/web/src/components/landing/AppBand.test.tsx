import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { AppBand } from './AppBand';
import { APP_DRAIN_MS, APP_SCREEN_MS } from './AppScreens';

/**
 * The app band: the three screens as tabs, each putting its real app capture on the phone; the band loops through them only while in view, and
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
  it('names the band, lists the three screens and starts on the first screen', () => {
    band();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      `${t('en', 'site.app.titleOne')} ${t('en', 'site.app.titleTwo')}`,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      t('en', 'site.app.bookEyebrow') + t('en', 'site.app.bookTitle'),
      t('en', 'site.app.timeEyebrow') + t('en', 'site.app.timeTitle'),
      t('en', 'site.app.joinEyebrow') + t('en', 'site.app.joinTitle'),
    ]);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
    expect(screen.getByRole('img', { name: t('en', 'site.app.bookAlt') })).toBeTruthy();
    expect(shown()).toBe('/brand/app/1-book.webp');
  });

  it('answers to #app, the payment return page\'s "Don\'t have the app?" link', () => {
    band();
    expect(document.getElementById('app')?.classList.contains('tp-appband')).toBe(true);
  });

  it('shows the same captures, with Arabic words, on the Arabic page', () => {
    band('ar');
    expect(shown()).toBe('/brand/app/1-book.webp');
    expect(screen.getAllByRole('tab')[1]!.textContent).toContain(t('ar', 'site.app.timeTitle'));
  });

  it('puts the picked screen on the phone, by click and by arrow keys', () => {
    band();
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]!);
    expect(shown()).toBe('/brand/app/2-pick-a-time.webp');
    expect(tabs[1]!.getAttribute('tabindex')).toBe('0');
    expect(tabs[0]!.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowDown' });
    expect(shown()).toBe('/brand/app/3-join.webp');
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowDown' });
    expect(shown()).toBe('/brand/app/1-book.webp');
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(shown()).toBe('/brand/app/3-join.webp');
  });

  it('loops on its own only while in view, and carries on from a picked screen', () => {
    band();
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS * 2));
    expect(shown()).toBe('/brand/app/1-book.webp');

    act(() => seen!([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(shown()).toBe('/brand/app/2-pick-a-time.webp');
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(shown()).toBe('/brand/app/3-join.webp');
    // The last screen stays on while the lines drain, then the first comes round.
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(shown()).toBe('/brand/app/3-join.webp');
    act(() => vi.advanceTimersByTime(APP_DRAIN_MS));
    expect(shown()).toBe('/brand/app/1-book.webp');

    // A pick restarts the full count from the picked screen, then the loop goes on.
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS - 100));
    fireEvent.click(screen.getAllByRole('tab')[2]!);
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS - 100));
    expect(shown()).toBe('/brand/app/3-join.webp');
    act(() => vi.advanceTimersByTime(100));
    act(() => vi.advanceTimersByTime(APP_DRAIN_MS));
    expect(shown()).toBe('/brand/app/1-book.webp');

    act(() => seen!([{ isIntersecting: false }]));
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS * 3));
    expect(shown()).toBe('/brand/app/1-book.webp');
  });

  it('fills each line over exactly one screen\'s time, and keeps the ones before it full', () => {
    band();
    const tabs = screen.getAllByRole('tab');
    const lines = () => tabs.map((tab) => tab.getAttribute('data-line'));
    expect(lines()).toEqual(['full', null, null]);
    act(() => seen!([{ isIntersecting: true }]));
    expect(lines()).toEqual(['run', null, null]);
    act(() => vi.advanceTimersByTime(APP_SCREEN_MS - 1));
    expect(lines()).toEqual(['run', null, null]);
    act(() => vi.advanceTimersByTime(1));
    expect(lines()).toEqual(['full', 'run', null]);
    fireEvent.click(tabs[2]!);
    expect(lines()).toEqual(['full', 'full', 'run']);
  });

  it('drains all the lines together when the last screen\'s time is up, then refills from the first', () => {
    band();
    const tabs = screen.getAllByRole('tab');
    const lines = () => tabs.map((tab) => tab.getAttribute('data-line'));
    act(() => seen!([{ isIntersecting: true }]));
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(lines()).toEqual(['drain', 'drain', 'drain']);
    expect(shown()).toBe('/brand/app/3-join.webp');
    act(() => vi.advanceTimersByTime(APP_DRAIN_MS));
    expect(lines()).toEqual(['run', null, null]);
    expect(shown()).toBe('/brand/app/1-book.webp');
  });

  it('drops a drain when a screen is picked or the band leaves the view', () => {
    band();
    const tabs = screen.getAllByRole('tab');
    act(() => seen!([{ isIntersecting: true }]));
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    fireEvent.click(tabs[1]!);
    expect(tabs.map((tab) => tab.getAttribute('data-line'))).toEqual(['full', 'run', null]);
    for (let i = 0; i < 2; i++) act(() => vi.advanceTimersByTime(APP_SCREEN_MS));
    expect(tabs[0]!.getAttribute('data-line')).toBe('drain');
    act(() => seen!([{ isIntersecting: false }]));
    expect(tabs[0]!.getAttribute('data-line')).toBe('full');
    expect(shown()).toBe('/brand/app/3-join.webp');
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
