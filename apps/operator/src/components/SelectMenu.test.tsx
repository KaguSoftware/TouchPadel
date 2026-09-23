/**
 * The dropdown every screen now uses. These cover the behaviours a native
 * <select> used to give for free and the two that the portal put at risk.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';
import { SelectMenu, typeaheadMatch } from './SelectMenu';
import { Field, Modal, Select } from './ui';

const COURTS = [
  { value: 'c1', label: 'Court 1' },
  { value: 'c2', label: 'Court 2' },
  { value: 'c3', label: 'Court 3', disabled: true },
] as const;

function renderMenu(props: Partial<Parameters<typeof SelectMenu<string>>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <SelectMenu value="c1" onChange={onChange} options={COURTS} aria-label="Court" {...props} />
    </LocaleProvider>,
  );
  return onChange;
}

describe('SelectMenu', () => {
  it('opens on click and commits the chosen option', async () => {
    const onChange = renderMenu();
    await userEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    await userEvent.click(screen.getByRole('option', { name: 'Court 2' }));
    expect(onChange).toHaveBeenCalledWith('c2');
    // Committing closes the panel and hands focus back to the trigger.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Court' }));
  });

  it('closes on Escape without choosing', async () => {
    const onChange = renderMenu();
    await userEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps past a disabled row and commits on Enter', async () => {
    const onChange = renderMenu();
    screen.getByRole('combobox', { name: 'Court' }).focus();
    // Opens on the current choice (Court 1); one step lands on Court 2.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('c2');
  });

  it('never commits a disabled option', async () => {
    const onChange = renderMenu({ value: 'c2' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    await userEvent.click(screen.getByRole('option', { name: 'Court 3' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the placeholder until something is chosen', async () => {
    renderMenu({ value: '', placeholder: 'Choose a court' });
    expect(screen.getByRole('combobox', { name: 'Court' }).textContent).toContain('Choose a court');
  });

  // The recipe editor's ingredient list is long: a second letter has to
  // extend the word, not start a new search on its own.
  it('type-ahead takes a whole word, with spaces and backspace', async () => {
    const onChange = renderMenu({
      value: '',
      options: [
        { value: 'ch', label: 'Cheese' },
        { value: 'ck', label: 'Chicken breast' },
        { value: 'k', label: 'Ketchup' },
        { value: 'oo', label: 'Olive oil' },
        { value: 'ov', label: 'Olive vinegar' },
      ],
    });
    screen.getByRole('combobox', { name: 'Court' }).focus();
    // Typing on the closed control opens it.
    await userEvent.keyboard('chi');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(document.querySelector('[data-typeahead]')?.textContent).toBe('chi');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('ck');

    screen.getByRole('combobox', { name: 'Court' }).focus();
    await userEvent.keyboard('olive vx{Backspace}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('ov');
  });

  it('type-ahead falls back to a word inside the label', () => {
    const opts = [{ label: 'Cheese' }, { label: 'Olive oil' }];
    expect(typeaheadMatch(opts, 'oil')).toBe(1);
    expect(typeaheadMatch(opts, 'ees')).toBe(0);
    expect(typeaheadMatch(opts, 'zz')).toBe(-1);
  });

  it('marks the chosen option as selected for assistive tech', async () => {
    renderMenu({ value: 'c2' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    expect(screen.getByRole('option', { name: 'Court 2' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'Court 1' }).getAttribute('aria-selected')).toBe('false');
  });

  // A long list scrolls inside the panel. The dismiss-on-scroll listener runs
  // in the CAPTURE phase — it must, to hear an ancestor scroller, whose scroll
  // events do not bubble — so it also heard the panel's own scroll and closed
  // the menu the moment anyone tried to scroll it.
  it('stays open when its own list is scrolled, and closes when the page is', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ value: `c${i}`, label: `Court ${i + 1}` }));
    render(
      <LocaleProvider>
        <SelectMenu value="c0" onChange={vi.fn()} options={many} aria-label="Court" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    const panel = screen.getByRole('listbox');

    // A scroll that ORIGINATES in the panel is the user reading the list.
    fireEvent.scroll(panel);
    expect(screen.queryByRole('listbox')).toBeTruthy();

    // A scroll of the page would leave the panel behind its trigger, because
    // the panel is measured once and does not chase it.
    fireEvent.scroll(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // jsdom reports every rect as 0x0, so placement cannot be asserted from a
  // layout here; what IS checked is that the panel is sized from the room
  // measured at open time rather than a hard 18rem that hung off the window.
  it('caps its height to the room available rather than a fixed size', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ value: `c${i}`, label: `Court ${i + 1}` }));
    render(
      <LocaleProvider>
        <SelectMenu value="c0" onChange={vi.fn()} options={many} aria-label="Court" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    const panel = screen.getByRole('listbox');
    expect(panel.style.maxBlockSize).toMatch(/^\d+px$/);
    expect(panel.style.overflowY).toBe('auto');
  });

  // The panel is portalled to <body>, so it is a SIBLING of any dialog rather
  // than a child. Both of these broke when that landed: the panel rendered
  // behind the dialog (fixed by --tp-z-menu), and a press on an option read as
  // a press outside the dialog.
  //
  // jsdom has no layout, so this pins the DOM structure and the click path,
  // NOT the paint order — that --tp-z-menu sits above --tp-z-overlay-raised is
  // a fact about the token file, checked by eye in a browser.
  it('renders above a Modal it was opened from, and choosing does not close it', async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <LocaleProvider>
        <Modal title="Move booking" onClose={onClose}>
          <Field label="New court">
            <Select value="c1" onChange={onChange} options={COURTS} />
          </Field>
        </Modal>
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'New court' }));
    const panel = screen.getByRole('listbox');
    // Outside the dialog in the DOM — that is the point of the portal.
    expect(screen.getByRole('dialog').contains(panel)).toBe(false);
    await userEvent.click(within(panel).getByRole('option', { name: 'Court 2' }));
    expect(onChange).toHaveBeenCalledWith('c2');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // jsdom lays nothing out, so the rects are stubbed: a narrow trigger hard
  // against the right edge, and a panel whose own content is far wider. That
  // is the analytics compare picker, the one that hung off the screen.
  it('pulls a panel wider than its trigger back inside the right edge', async () => {
    const WIDTH = 1000;
    const origin = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('role') === 'combobox') {
        // eslint-disable-next-line no-restricted-syntax -- DOMRect geometry the menu reads, not CSS
        return { left: 900, right: 980, top: 40, bottom: 70, width: 80, height: 30, x: 900, y: 40 } as DOMRect;
      }
      if (this.getAttribute('role') === 'listbox') {
        // Drawn at the trigger's left edge, it would end 300px past the window.
        const left = Number((this as HTMLElement).style.insetInlineStart.replace('px', ''));
        // eslint-disable-next-line no-restricted-syntax -- DOMRect geometry the menu reads, not CSS
        return { left, right: left + 400, top: 70, bottom: 270, width: 400, height: 200, x: left, y: 70 } as DOMRect;
      }
      return origin.call(this);
    });
    Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true });

    renderMenu();
    await userEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    const panel = screen.getByRole('listbox') as HTMLElement;
    const start = Number(panel.style.insetInlineStart.replace('px', ''));
    // Slid back so its right edge clears the 8px gutter, not left at 900.
    expect(start).toBe(WIDTH - 8 - 400);
    vi.restoreAllMocks();
  });
});
