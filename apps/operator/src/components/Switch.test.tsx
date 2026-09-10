import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';
import { ToastProvider } from './toast';
import { LocaleProvider } from '../lib/i18n';

// First component test in this app. Until 2026-08-28 vitest ran only
// `*.test.ts` in `environment: 'node'`, so none of the 89 .tsx files could be
// tested at all.
//
// `Switch` is the right first target: it is the shared optimistic toggle behind
// sold-out, item availability, the per-table waiter bell and the Telegram
// enable flag — every one of which is a control a manager flips mid-service and
// must be able to trust. Its revert-on-error path had no coverage anywhere.

function renderSwitch(props: Partial<Parameters<typeof Switch>[0]> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <LocaleProvider>
      <ToastProvider>
        <Switch checked={false} label="Sold out" {...props} onChange={onChange} />
      </ToastProvider>
    </LocaleProvider>,
  );
  return { ...utils, onChange };
}

describe('Switch', () => {
  it('exposes the accessible switch role and state', () => {
    renderSwitch({ checked: true });
    expect(screen.getByRole('switch', { name: 'Sold out' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
  });

  it('flips optimistically before onChange resolves', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderSwitch({ onChange: () => pending });

    const toggle = screen.getByRole('switch');
    await user.click(toggle);

    // Still in flight: the UI already shows the new value and marks itself busy.
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-busy')).toBe('true');
    release();
  });

  it('reverts and surfaces an error when onChange throws', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockRejectedValue(new Error('SOLD_OUT_FAILED'));
    renderSwitch({ onChange });

    const toggle = screen.getByRole('switch');
    await user.click(toggle);

    // The revert is the point: a manager must never be left believing an item
    // is 86'd when the write failed.
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('ignores clicks while a call is in flight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    renderSwitch({ onChange });

    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    await user.click(toggle);
    await user.click(toggle);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSwitch({ disabled: true, onChange });

    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Switch — optimistic settle window', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('holds the optimistic value for the settle grace, then releases it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // `checked` stays false — as if the query has not refetched yet.
    renderSwitch({ onChange: vi.fn().mockResolvedValue(undefined) });

    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));

    // Without the grace window the switch would visibly snap back to the stale
    // value between the successful write and the refetch.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await vi.advanceTimersByTimeAsync(1_500);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });
});
