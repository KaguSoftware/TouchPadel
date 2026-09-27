import { describe, expect, it } from 'vitest';
import { appReturnHref, APP_RETURN_URL, isAppDevice, parsePaymentRef, payReturnPath } from './payReturn';

/**
 * The payment return page's pure parts: which refs are forwarded to the app, and the
 * links built from them. A ref that is not a UUID is never forwarded, so nothing a
 * stranger puts in the URL reaches the app's route or the page's markup.
 */
const REF = '7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30';

describe('parsePaymentRef', () => {
  it('accepts a UUID, trimmed and lowercased', () => {
    expect(parsePaymentRef(REF)).toBe(REF);
    expect(parsePaymentRef(` ${REF.toUpperCase()} `)).toBe(REF);
  });

  it('reads the first of a repeated ref', () => {
    expect(parsePaymentRef([REF, 'x'])).toBe(REF);
    expect(parsePaymentRef(['x', REF])).toBeNull();
  });

  it.each([undefined, '', 'abc', `${REF}0`, `${REF}&x=1`, REF.replace(/-/g, ''), `{${REF}}`, 'javascript:alert(1)'])(
    'refuses %j',
    (raw) => {
      expect(parsePaymentRef(raw)).toBeNull();
    },
  );
});

describe('the links', () => {
  it('builds the app link with the ref, or without one', () => {
    expect(APP_RETURN_URL).toBe('touchpadel://pay/return');
    expect(appReturnHref(REF)).toBe(`touchpadel://pay/return?ref=${REF}`);
    expect(appReturnHref(null)).toBe('touchpadel://pay/return');
  });

  it('builds the same page in another language, keeping only a valid ref', () => {
    expect(payReturnPath('ar', REF)).toBe(`/ar/pay/return?ref=${REF}`);
    expect(payReturnPath('en', null)).toBe('/en/pay/return');
  });
});

describe('isAppDevice', () => {
  it('knows phones and tablets, including an iPad that says it is a Mac', () => {
    expect(isAppDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isAppDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5)).toBe(true);
    expect(isAppDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isAppDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
  });

  it('leaves computers alone', () => {
    expect(isAppDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isAppDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false);
    // A Windows laptop with a touch screen is still not where the app runs.
    expect(isAppDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10)).toBe(false);
    expect(isAppDevice('Mozilla/5.0 (X11; Linux x86_64)', 0)).toBe(false);
  });
});
