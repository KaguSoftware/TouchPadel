import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { Basket } from './Basket';
import { BASKET_LIST_ROWS } from './tillStyles';
import type { BasketLine } from './tillData';

function line(over: Partial<BasketLine> & { key: string }): BasketLine {
  return {
    variantId: 'v1',
    itemName: 'Flat White',
    variantName: 'Regular',
    qty: 1,
    notes: '',
    unitPriceIqd: 3_000,
    modifiers: [],
    ...over,
  };
}

function renderBasket(expanded: boolean, lines: BasketLine[] = [line({ key: 'a' })]) {
  const view = render(
    <LocaleProvider>
      <Basket
        lines={lines}
        forLabel="Table T8"
        sending={false}
        error={null}
        canSend
        expanded={expanded}
        onToggleExpanded={vi.fn()}
        onBump={vi.fn()}
        onNote={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onSend={vi.fn()}
      />
    </LocaleProvider>,
  );
  return view;
}

/**
 * The buttons below the lines must not move when the chevron is pressed. jsdom
 * does no layout, so this is asserted STRUCTURALLY: the basket is pinned to
 * the pane's bottom edge by its caller, so what matters is that the estimate
 * and Send stay the LAST thing in it and keep the lines above them. Opening
 * adds a row at the top of the stack, never below them.
 */
describe('Basket — Send and the estimate hold their place', () => {
  it('reads in order: heading, lines, then the estimate and Send last', () => {
    const view = renderBasket(true);
    const rows = [...view.container.querySelector('section')!.children];
    const heading = view.getByText(/Basket for/);
    const lines = view.getByText(/Turkish Coffee|Flat White/);
    const send = view.getByRole('button', { name: /send to kitchen/i });

    const headingRow = rows.findIndex((r) => r.contains(heading));
    const linesRow = rows.findIndex((r) => r.contains(lines));
    const sendRow = rows.findIndex((r) => r.contains(send));

    expect(headingRow).toBeLessThan(linesRow);
    expect(linesRow).toBeLessThan(sendRow);
  });

  it('keeps the estimate and Send in the last row, open or closed', () => {
    for (const expanded of [false, true]) {
      const view = renderBasket(expanded);
      const rows = [...view.container.querySelector('section')!.children];
      const send = view.getByRole('button', { name: /send to kitchen/i });
      const estimate = view.getByText('Estimated total');

      // Last row either way: opening adds the list ABOVE these, so nothing
      // below them can shift.
      expect(rows.findIndex((r) => r.contains(send))).toBe(rows.length - 1);
      expect(rows.findIndex((r) => r.contains(estimate))).toBe(rows.length - 1);
      view.unmount();
    }
  });

  it('hides the lines when closed and shows them when open', () => {
    // The row stays mounted so the open/close can animate; closed it has no
    // height, is hidden from assistive tech and is out of the tab order.
    const closed = renderBasket(false);
    const closedRow = closed.getByText(/Flat White/).closest('[aria-hidden]') as HTMLElement;
    expect(closedRow.getAttribute('aria-hidden')).toBe('true');
    expect(closedRow.style.visibility).toBe('hidden');
    // jsdom serialises a logical 0 inconsistently; what matters is that it is
    // zero rather than the cap.
    expect(closedRow.style.maxBlockSize).not.toContain('var(--tp-touch)');
    closed.unmount();

    const open = renderBasket(true);
    const openRow = open.getByText(/Flat White/).closest('[aria-hidden]') as HTMLElement;
    expect(openRow.getAttribute('aria-hidden')).toBe('false');
    expect(openRow.style.visibility).toBe('visible');
  });

  it('animates the open and close rather than jumping', () => {
    const view = renderBasket(true);
    const row = view.getByText(/Flat White/).closest('[aria-hidden]') as HTMLElement;
    expect(row.style.transition).toContain('max-block-size');
    // Margin too, or the row's own spacing would snap while the height slid.
    expect(row.style.transition).toContain('margin-block-end');
  });

  it('caps the open list at four lines and scrolls past them', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => line({ key: k, itemName: `Item ${k}` }));
    const view = renderBasket(true, many);

    // Every line is rendered — the cap is a scroll, not a truncation.
    for (const k of ['a', 'f']) expect(view.getByText(new RegExp(`Item ${k}`))).toBeTruthy();

    const scroller = view.getByText(/Item a/).closest('[style*="overflow"]') as HTMLElement;
    expect(scroller.style.overflowY).toBe('auto');
    // Four rows' worth, derived from the row's own touch target rather than
    // a hand-typed height.
    expect(scroller.style.maxBlockSize).toContain(`${BASKET_LIST_ROWS} *`);
    expect(scroller.style.maxBlockSize).toContain('var(--tp-touch)');
  });

  it('turns the chevron between the two states', () => {
    for (const [expanded, turn] of [[false, 'rotate(0deg)'], [true, 'rotate(180deg)']] as const) {
      const view = renderBasket(expanded);
      const toggle = view.getByRole('button', { name: /(show|hide) the basket lines/i });
      const glyph = toggle.querySelector('span[style*="rotate"]') as HTMLElement;
      expect(glyph.style.transform).toBe(turn);
      expect(glyph.style.transition).toContain('transform');
      view.unmount();
    }
  });

  it('stops the minus at one, leaving removal to the x', () => {
    const view = renderBasket(true, [line({ key: 'a', qty: 1 })]);
    const row = view.getByText(/Flat White/).closest('li') as HTMLElement;

    const minus = row.querySelector('button[aria-label="−1"]') as HTMLButtonElement;
    const remove = row.querySelector(
      `button[aria-label="${'Remove line'}"]`,
    ) as HTMLButtonElement;

    expect(minus.disabled).toBe(true);
    // The way out is still there, and right beside it.
    expect(remove.disabled).toBe(false);
  });

  it('allows the minus above one', () => {
    const view = renderBasket(true, [line({ key: 'a', qty: 2 })]);
    const row = view.getByText(/Flat White/).closest('li') as HTMLElement;
    const minus = row.querySelector('button[aria-label="−1"]') as HTMLButtonElement;
    expect(minus.disabled).toBe(false);
  });

  it('counts units in the heading, not lines', () => {
    renderBasket(false, [line({ key: 'a', qty: 2 }), line({ key: 'b', qty: 4 })]);
    expect(screen.getByText('(6)')).toBeTruthy();
  });
});
