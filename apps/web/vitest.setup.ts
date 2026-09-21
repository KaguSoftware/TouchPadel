import { afterEach } from 'vitest';

// Unmount between tests: a page smoke render mounts the full cafe app, and a
// leaked tree makes the next test's queries ambiguous (two top bars, two menu
// stages). Guarded because this setup file also runs for the node-environment
// suites, where there is no DOM and testing-library must not be pulled in.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

// ---------------------------------------------------------------- DOM stubs
//
// jsdom implements neither observer, and the cafe app uses both on mount:
// Footer watches itself with an IntersectionObserver to get the FABs out of the
// way, and the sheets measure with a ResizeObserver. Footer already guards on
// `typeof IntersectionObserver === 'undefined'`, but stubbing it is what lets a
// test assert the visibility handshake instead of the guard's fallback.
//
// `matchMedia` is jsdom's other famous hole (prefers-reduced-motion) and
// `navigator.vibrate` does not exist outside a real phone — `@/lib/haptics`
// feature-detects it, so the stub here is what makes the tap path itself run.
//
// Everything is guarded on `typeof window` because the node suites load this
// file too, and `defineProperty` on a missing global would throw at collection.
if (typeof window !== 'undefined') {
  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }

  const globalAny = globalThis as unknown as Record<string, unknown>;
  globalAny.IntersectionObserver ??= NoopObserver;
  globalAny.ResizeObserver ??= NoopObserver;

  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof navigator.vibrate !== 'function') {
    Object.defineProperty(navigator, 'vibrate', { writable: true, value: () => true });
  }

  // jsdom has no layout engine, so `scrollTo` on an element is unimplemented
  // and throws "Not implemented" noise the moment a category pill is tapped.
  if (typeof Element.prototype.scrollTo !== 'function') {
    Object.defineProperty(Element.prototype, 'scrollTo', { writable: true, value: () => {} });
  }

  // jsdom ships no `CSS` namespace object at all, and CategoryPills centres the
  // active pill with `rail.querySelector('[data-cat="' + CSS.escape(id) + '"]')`
  // in a mount effect — so without this every cafe render throws before a single
  // assertion. The ids under test are plain uuid/slug strings; this escapes
  // everything outside the CSS identifier alphabet, which is stricter than the
  // spec algorithm and therefore safe for them.
  const cssNamespace = (globalThis as unknown as { CSS?: { escape?: unknown } }).CSS;
  if (typeof cssNamespace?.escape !== 'function') {
    const escape = (value: string): string => String(value).replace(/[^\w-]/g, (ch) => `\\${ch}`);
    if (cssNamespace) {
      (cssNamespace as { escape: unknown }).escape = escape;
    } else {
      (globalThis as unknown as Record<string, unknown>).CSS = { escape };
    }
  }
}
