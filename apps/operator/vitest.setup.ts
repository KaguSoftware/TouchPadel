import { afterEach } from 'vitest';

// Unmount between tests: the operator renders portals (toast, confirm, sheets)
// into document.body, and a leaked host makes the next test's queries ambiguous.
// Guarded because this setup file also runs for the node-environment suites,
// where there is no DOM and testing-library must not be pulled in.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
