import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ToolbarPopover } from './ToolbarPopover';

// jsdom has no layout: give the trigger a box and the panel a width, as a
// 1280px window would.
function place(triggerLeft: number, triggerWidth: number, panelWidth: number) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'dialog' ? new DOMRect(0, 0, panelWidth, 300) : new DOMRect(triggerLeft, 600, triggerWidth, 40);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(panelWidth);
}

function renderOpen(align: 'start' | 'end') {
  render(
    <ToolbarPopover open onOpenChange={() => {}} label="Reads" panelLabel="What it reads" align={align} side="above">
      <button type="button">Just help</button>
    </ToolbarPopover>,
  );
  return screen.getByRole('dialog', { name: 'What it reads' });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ToolbarPopover in place', () => {
  it('pulls a start-aligned panel back inside the window', () => {
    // The composer's Reads button at 947px, a 440px panel: 115px past the 8px margin.
    place(947, 156, 440);
    expect(renderOpen('start').style.marginInlineStart).toBe('-115px');
  });

  it('leaves a panel that fits where it is', () => {
    place(813, 120, 440);
    expect(renderOpen('start').style.marginInlineStart).toBe('0');
  });

  it('never pulls it past the window on the other side', () => {
    place(100, 40, 2000);
    expect(renderOpen('start').style.marginInlineStart).toBe('-92px');
  });

  it('pulls an end-aligned panel back the other way', () => {
    // Trigger 0–40px, panel pinned to its end: 1240px from the window's right edge.
    place(0, 40, 440);
    expect(renderOpen('end').style.marginInlineEnd).toBe('-408px');
  });
});
