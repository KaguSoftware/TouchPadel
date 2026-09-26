import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoTip } from './InfoTip';
import { LocaleProvider } from '../lib/i18n';

// The InfoTip is the one explanation surface every workspace shares, and its
// whole point is that mouse, keyboard and finger all reach the same panel.
// Each path is asserted separately: a regression in one is invisible from the
// others.
//
// Two clocks on purpose. The hover timing suite fakes timers and drives the
// pointer with fireEvent so the 120ms open / 80ms close windows are exact;
// user-event cannot run under plain fake timers here (testing-library's async
// wrapper waits on a faked setTimeout it only auto-advances for jest, and
// `shouldAdvanceTime` would make exact millisecond assertions racy). The
// interaction suite keeps real timers and user-event for the same reason the
// Switch test does: a click there is a real click.

const LOCALE_KEY = 'touch-operator-locale';

function renderTip(ui = <InfoTip content="What this figure counts." />) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

function panel(): HTMLElement {
  return screen.getByRole('tooltip');
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup() {
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.removeItem(LOCALE_KEY);
});

describe('InfoTip', () => {
  it('mounts the tooltip while closed and points aria-describedby at it', () => {
    renderTip();
    const trigger = screen.getByRole('button', { name: 'More about this' });
    const tip = panel();
    expect(tip.dataset.open).toBe('false');
    expect(tip.id).not.toBe('');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(tip.textContent).toBe('What this figure counts.');
  });

  it('opens on focus and closes on blur', () => {
    renderTip();
    const trigger = screen.getByRole('button');

    act(() => trigger.focus());
    expect(panel().dataset.open).toBe('true');
    act(() => trigger.blur());
    expect(panel().dataset.open).toBe('false');
  });

  it('pins on click so unhover no longer closes it', async () => {
    const user = setup();
    renderTip();
    const trigger = screen.getByRole('button');

    await user.click(trigger);
    expect(panel().dataset.open).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.unhover(trigger);
    await act(() => settle(150));
    expect(panel().dataset.open).toBe('true');

    // A second click releases it.
    await user.click(trigger);
    expect(panel().dataset.open).toBe('false');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes a pinned tip on an outside pointerdown', async () => {
    const user = setup();
    renderTip(
      <div>
        <InfoTip content="Explained." />
        <button type="button">Elsewhere</button>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'More about this' });

    await user.click(trigger);
    expect(panel().dataset.open).toBe('true');
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('button', { name: 'Elsewhere' }) });
    expect(panel().dataset.open).toBe('false');
  });

  it('closes on Escape, returns focus to the trigger and stops propagation', async () => {
    const user = setup();
    const parentKeyDown = vi.fn();
    renderTip(
      <div onKeyDown={parentKeyDown}>
        <InfoTip content="Explained." />
      </div>,
    );
    const trigger = screen.getByRole('button');

    await user.click(trigger);
    expect(panel().dataset.open).toBe('true');

    await user.keyboard('{Escape}');
    expect(panel().dataset.open).toBe('false');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    // The Modal that may wrap this must not close with it.
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('lets Escape through to the parent while the tip is closed', async () => {
    const user = setup();
    const parentKeyDown = vi.fn();
    renderTip(
      <div onKeyDown={parentKeyDown}>
        <InfoTip content="Explained." />
      </div>,
    );
    act(() => screen.getByRole('button').focus());
    act(() => screen.getByRole('button').blur());
    act(() => screen.getByRole('button').focus());
    // Focus opened it; close it via Escape first, then a second Escape must bubble.
    await user.keyboard('{Escape}');
    expect(parentKeyDown).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('closes on window scroll', async () => {
    const user = setup();
    renderTip();
    await user.click(screen.getByRole('button'));
    expect(panel().dataset.open).toBe('true');
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(panel().dataset.open).toBe('false');
  });

  it('describes a custom child trigger and keeps its own handlers', async () => {
    const user = setup();
    const onClick = vi.fn();
    renderTip(
      <InfoTip content="The delta against last week.">
        <button type="button" onClick={onClick}>
          +12%
        </button>
      </InfoTip>,
    );
    const trigger = screen.getByRole('button', { name: '+12%' });
    expect(trigger.getAttribute('aria-describedby')).toBe(panel().id);

    await user.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(panel().dataset.open).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('uses a custom label for the default trigger', () => {
    renderTip(<InfoTip content="x" label="About occupancy" />);
    expect(screen.getByRole('button', { name: 'About occupancy' })).toBeTruthy();
  });
});

describe('InfoTip hover timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens on hover after the delay and closes after unhover', () => {
    renderTip();
    const trigger = screen.getByRole('button');

    fireEvent.pointerEnter(trigger);
    expect(panel().dataset.open).toBe('false');
    act(() => vi.advanceTimersByTime(119));
    expect(panel().dataset.open).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(panel().dataset.open).toBe('true');

    fireEvent.pointerLeave(trigger);
    expect(panel().dataset.open).toBe('true');
    act(() => vi.advanceTimersByTime(79));
    expect(panel().dataset.open).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(panel().dataset.open).toBe('false');
  });

  it('does not open when the pointer leaves before the delay', () => {
    renderTip();
    const trigger = screen.getByRole('button');

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(60));
    fireEvent.pointerLeave(trigger);
    act(() => vi.advanceTimersByTime(500));
    expect(panel().dataset.open).toBe('false');
  });

  it('stays open while the pointer is inside the panel', () => {
    renderTip();
    const trigger = screen.getByRole('button');

    fireEvent.pointerEnter(trigger);
    act(() => vi.advanceTimersByTime(120));
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(panel());
    act(() => vi.advanceTimersByTime(500));
    expect(panel().dataset.open).toBe('true');

    fireEvent.pointerLeave(panel());
    act(() => vi.advanceTimersByTime(80));
    expect(panel().dataset.open).toBe('false');
  });
});

describe('InfoTip placement', () => {
  function mockRects() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // Trigger 30x20 at (100, 50); panel 100x40. jsdom viewport is 1024x768.
      return this.getAttribute('role') === 'tooltip' ? new DOMRect(0, 0, 100, 40) : new DOMRect(100, 50, 30, 20);
    });
  }

  it('aligns to the trigger inline-start edge in LTR', () => {
    mockRects();
    renderTip();
    act(() => screen.getByRole('button').focus());
    const tip = panel();
    expect(tip.style.insetInlineStart).toBe('100px');
    // Below the trigger: bottom 70 + 6px gap.
    expect(tip.style.insetBlockStart).toBe('76px');
  });

  it('computes the inline inset from the right edge in RTL', () => {
    mockRects();
    localStorage.setItem(LOCALE_KEY, 'ar');
    renderTip();
    act(() => screen.getByRole('button', { name: 'المزيد عن هذا' }).focus());
    // inset-inline-start resolves to the right edge in Arabic: 1024 - 130.
    expect(panel().style.insetInlineStart).toBe('894px');
  });

  it('flips above the trigger when there is no room below', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tooltip' ? new DOMRect(0, 0, 100, 40) : new DOMRect(100, 740, 30, 20);
    });
    renderTip();
    act(() => screen.getByRole('button').focus());
    // top 740 - 40 - 6.
    expect(panel().style.insetBlockStart).toBe('694px');
  });
});
