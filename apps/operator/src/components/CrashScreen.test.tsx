import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppErrorBoundary, CrashPanel, NotFoundPanel } from './CrashScreen';
import { LocaleProvider } from '../lib/i18n';
import { setReporter, type Reporter } from '../lib/telemetry';

// A blank kiosk is the failure mode these guard against: till and KDS stations
// run with `kiosk: true` and `autoHideMenuBar: true`, so before this existed a
// render throw left a cashier with no menu, no address bar and no way back
// mid-service — and the shell's `render-process-gone` reload never fires,
// because a React exception is not a process crash.

function Boom(): never {
  throw new Error('KABOOM');
}

function withLocale(node: React.ReactNode) {
  return render(<LocaleProvider>{node}</LocaleProvider>);
}

beforeEach(() => {
  setReporter(null);
  // React logs the caught error; that noise is expected, not a failure.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AppErrorBoundary', () => {
  it('renders the fallback instead of propagating the throw', () => {
    withLocale(
      <AppErrorBoundary fallback={(error) => <CrashPanel error={error} />}>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('This screen stopped working')).toBeTruthy();
  });

  it('reports the error through the telemetry seam', () => {
    const captured: unknown[] = [];
    const reporter: Reporter = {
      captureException: (error) => captured.push(error),
      captureMessage: () => {},
      addBreadcrumb: () => {},
    };
    setReporter(reporter);

    withLocale(
      <AppErrorBoundary fallback={(error) => <CrashPanel error={error} />}>
        <Boom />
      </AppErrorBoundary>,
    );

    // Without this the only trace of a station crash is the blank screen itself.
    expect(captured).toHaveLength(1);
    expect((captured[0] as Error).message).toBe('KABOOM');
  });

  it('recovers when the fallback resets it', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Sometimes() {
      if (shouldThrow) throw new Error('KABOOM');
      return <p>recovered</p>;
    }

    withLocale(
      <AppErrorBoundary
        fallback={(error, reset) => <CrashPanel error={error} onRetry={reset} />}
      >
        <Sometimes />
      </AppErrorBoundary>,
    );

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try this screen again' }));
    expect(screen.getByText('recovered')).toBeTruthy();
  });

  it('keeps the stack behind a collapsed disclosure', () => {
    // A guest can read this screen over the cashier's shoulder.
    withLocale(
      <AppErrorBoundary fallback={(error) => <CrashPanel error={error} />}>
        <Boom />
      </AppErrorBoundary>,
    );
    const details = screen.getByText('Technical details').closest('details');
    expect(details).toBeTruthy();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText(/KABOOM/)).toBeTruthy();
  });
});

describe('CrashPanel actions', () => {
  it('offers only the escapes it was given', () => {
    withLocale(<CrashPanel error={new Error('x')} />);
    // No retry and no home when the caller cannot provide them; reload always
    // works, so the station is never left with zero ways out.
    expect(screen.queryByRole('button', { name: 'Try this screen again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to my home screen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restart the app' })).toBeTruthy();
  });

  it('calls onHome when the operator takes the home escape', async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    withLocale(<CrashPanel error={new Error('x')} onHome={onHome} />);
    await user.click(screen.getByRole('button', { name: 'Go to my home screen' }));
    expect(onHome).toHaveBeenCalledOnce();
  });
});

describe('NotFoundPanel', () => {
  it('explains the address and offers a way out, but no retry', async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    withLocale(<NotFoundPanel onHome={onHome} />);

    expect(screen.getByText('Screen not found')).toBeTruthy();
    // Retrying a bad URL changes nothing, so it is not offered.
    expect(screen.queryByRole('button', { name: 'Try this screen again' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Go to my home screen' }));
    expect(onHome).toHaveBeenCalledOnce();
  });
});
