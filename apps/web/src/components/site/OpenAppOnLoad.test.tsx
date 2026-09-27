import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { OpenAppOnLoad, openAppIfSupported } from './OpenAppOnLoad';

/**
 * The payment return page's automatic hop into the app. It jumps on a phone or a tablet
 * and nowhere else: on a computer the scheme has no handler, and a desktop browser may
 * swap the page for an error it cannot come back from. The browser is passed in, because
 * jsdom's `location.replace` cannot be spied on.
 */
const HREF = 'touchpadel://pay/return?ref=7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  // iPadOS asks for the desktop site: a Mac user agent, with a touch screen.
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0',
};

function attempt(userAgent: string, maxTouchPoints: number) {
  const replace = vi.fn();
  const opened = openAppIfSupported(HREF, { userAgent, maxTouchPoints }, { replace });
  return { opened, replace };
}

describe('openAppIfSupported', () => {
  it.each([
    ['an iPhone', UA.iphone, 5],
    ['an Android phone', UA.android, 5],
    ['an iPad asking for the desktop site', UA.ipadDesktop, 5],
  ])('replaces the page with the app link on %s', (_, ua, touch) => {
    const { opened, replace } = attempt(ua, touch);
    expect(opened).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(HREF);
  });

  it.each([
    ['Chrome on Windows', UA.windowsChrome, 0],
    ['Firefox on a Mac', UA.macFirefox, 0],
    ['Safari on a Mac', UA.ipadDesktop, 0],
  ])('stays on the page on %s', (_, ua, touch) => {
    const { opened, replace } = attempt(ua, touch);
    expect(opened).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('OpenAppOnLoad', () => {
  it('renders nothing, and on a computer does not navigate', () => {
    // jsdom's own user agent is a desktop one with no touch points.
    const before = window.location.href;
    const { container } = render(<OpenAppOnLoad href={HREF} />);
    expect(container.innerHTML).toBe('');
    expect(window.location.href).toBe(before);
  });
});
