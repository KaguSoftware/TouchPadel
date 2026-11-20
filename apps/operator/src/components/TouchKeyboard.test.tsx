import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useState } from 'react';
import { LocaleProvider } from '../lib/i18n';
import { ToastProvider } from './toast';
import { OSK_STORAGE_KEY, TouchDisabledReason, TouchKeyboard } from './TouchKeyboard';
import { Button } from './ui';

// The touch stations' keyboard (owner call 2026-11-20): a finger types into
// sign-in, the manager PIN for Quit, the lock and every other field.

// jsdom has no PointerEvent, and without it fireEvent drops `pointerType` —
// the one field the keyboard decides on.
if (typeof window.PointerEvent !== 'function') {
  class PointerEventShim extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim;
}

beforeEach(() => {
  localStorage.setItem(OSK_STORAGE_KEY, 'on');
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--tp-osk-inset');
});

function Text({ onEnter }: { onEnter?: () => void }) {
  const [v, setV] = useState('');
  return <input aria-label="name" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />;
}

function Pin({ onEnter }: { onEnter: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  return (
    <input
      aria-label="pin"
      type="password"
      inputMode="numeric"
      maxLength={4}
      value={pin}
      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
      onKeyDown={(e) => e.key === 'Enter' && onEnter(pin)}
    />
  );
}

function mount(children: React.ReactNode) {
  return render(
    <LocaleProvider>
      <ToastProvider>
        {children}
        <TouchKeyboard />
        <TouchDisabledReason />
      </ToastProvider>
    </LocaleProvider>,
  );
}

/** A finger on the field: the touch is heard first, then focus lands. */
function touchFocus(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerType: 'touch' });
  act(() => el.focus());
  fireEvent.pointerUp(el, { pointerType: 'touch' });
}

function tap(key: string) {
  const btn = screen.getByTestId('osk').querySelector<HTMLElement>(`[data-osk-key="${key}"]`);
  if (!btn) throw new Error(`no key ${key}`);
  fireEvent.pointerDown(btn, { pointerType: 'touch', pointerId: 1 });
  fireEvent.pointerUp(btn, { pointerType: 'touch', pointerId: 1 });
}

describe('TouchKeyboard', () => {
  it('comes up for a field touched, and types into it through onChange', () => {
    mount(<Text />);
    const input = screen.getByLabelText<HTMLInputElement>('name');
    touchFocus(input);
    expect(screen.getByTestId('osk').dataset.oskKind).toBe('text');
    tap('h');
    tap('i');
    tap('space');
    tap('shift');
    tap('a');
    tap('b');
    expect(input.value).toBe('hi Ab');
    tap('backspace');
    expect(input.value).toBe('hi A');
  });

  it('stays down for a field reached by mouse', () => {
    mount(<Text />);
    const input = screen.getByLabelText('name');
    fireEvent.pointerDown(input, { pointerType: 'mouse' });
    act(() => input.focus());
    expect(screen.queryByTestId('osk')).toBeNull();
  });

  it('gives a PIN field the number pad, keeps its maxLength and sends Enter to its handler', () => {
    const onEnter = vi.fn();
    mount(<Pin onEnter={onEnter} />);
    const input = screen.getByLabelText<HTMLInputElement>('pin');
    touchFocus(input);
    const osk = screen.getByTestId('osk');
    expect(osk.dataset.oskKind).toBe('numeric');
    // Windows' own keyboard is kept away while this one owns the field.
    expect(input.getAttribute('inputmode')).toBe('none');
    for (const d of ['1', '2', '3', '4', '5']) tap(d);
    expect(input.value).toBe('1234');
    tap('enter');
    expect(onEnter).toHaveBeenCalledWith('1234');
  });

  it('submits a form on Enter when no handler claims it', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    mount(
      <form onSubmit={onSubmit}>
        <Text />
        <button type="submit">Sign in</button>
      </form>,
    );
    touchFocus(screen.getByLabelText('name'));
    tap('enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('switches language and remembers it', () => {
    mount(<Text />);
    const input = screen.getByLabelText<HTMLInputElement>('name');
    touchFocus(input);
    tap('lang');
    expect(screen.getByTestId('osk').dataset.oskLang).toBe('ar');
    tap('س');
    tap('لا');
    expect(input.value).toBe('سلا');
  });

  it('hides on Hide, keeps focus, and a tap on the field brings it back', () => {
    mount(<Text />);
    const input = screen.getByLabelText('name');
    touchFocus(input);
    tap('hide');
    expect(screen.queryByTestId('osk')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('inputmode')).toBeNull();
    fireEvent.pointerDown(input, { pointerType: 'touch' });
    expect(screen.getByTestId('osk')).toBeTruthy();
  });

  it('lets go when focus leaves for something that is not a field', async () => {
    mount(
      <>
        <Text />
        <button type="button">elsewhere</button>
      </>,
    );
    touchFocus(screen.getByLabelText('name'));
    expect(screen.getByTestId('osk')).toBeTruthy();
    act(() => screen.getByText('elsewhere').focus());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.queryByTestId('osk')).toBeNull();
  });

  /** jsdom lays nothing out: the panel is 260px tall and the field sits at `fieldBottom` in a 768px window. */
  function layout(fieldBottom: number) {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      // A DOMRect's fields are physical by definition; there is no logical spelling to use.
      // eslint-disable-next-line no-restricted-syntax
      const rect = (top: number, bottom: number) => ({ x: 0, y: top, top, bottom, left: 0, right: 100, width: 100, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
      if (this.getAttribute('role') === 'group' && this.parentElement?.hasAttribute('data-tp-osk')) return rect(508, 768);
      if (this.tagName === 'INPUT') return rect(fieldBottom - 40, fieldBottom);
      return rect(0, 0);
    });
  }
  const inset = () => document.documentElement.style.getPropertyValue('--tp-osk-inset');

  it('re-renders none of itself for a typed letter (the press look is set on the key, not through React)', () => {
    let commits = 0;
    render(
      <LocaleProvider>
        <ToastProvider>
          <Text />
          <Profiler id="osk" onRender={() => commits++}>
            <TouchKeyboard />
          </Profiler>
        </ToastProvider>
      </LocaleProvider>,
    );
    touchFocus(screen.getByLabelText('name'));
    tap('lang');
    if (screen.getByTestId('osk').dataset.oskLang !== 'en') tap('lang');
    const before = commits;
    for (const k of ['t', 'o', 'u', 'c', 'h']) tap(k);
    expect(screen.getByLabelText<HTMLInputElement>('name').value).toBe('touch');
    expect(commits - before).toBe(0);
  });

  it('gives the room back within 1.5 s even when a release never arrives', async () => {
    const spy = layout(700);
    try {
      mount(<Text />);
      touchFocus(screen.getByLabelText('name'));
      expect(inset()).toBe('260px');
      // A press that never lifts (the window lost focus mid-press), then the keys go down.
      fireEvent.pointerDown(document.body, { pointerType: 'touch', pointerId: 42 });
      tap('hide');
      expect(inset()).toBe('260px');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1600));
      });
      expect(inset()).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('moves nothing when the field is already above the keys', () => {
    const spy = layout(200);
    try {
      mount(<Text />);
      touchFocus(screen.getByLabelText('name'));
      expect(screen.getByTestId('osk')).toBeTruthy();
      expect(inset()).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('makes room when the field would be under the keys, and gives it back when they go down', () => {
    const spy = layout(700);
    try {
      mount(<Text />);
      touchFocus(screen.getByLabelText('name'));
      expect(inset()).toBe('260px');
      tap('hide');
      expect(inset()).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the screen still until the press that closed the keys is released', async () => {
    const spy = layout(700);
    try {
      mount(
        <>
          <Text />
          <button type="button">Confirm</button>
        </>,
      );
      touchFocus(screen.getByLabelText('name'));
      expect(inset()).toBe('260px');
      // The mouse goes down on a dialog button, which takes focus: the keys go down at once...
      const confirm = screen.getByText('Confirm');
      fireEvent.pointerDown(confirm, { pointerType: 'mouse', pointerId: 9 });
      act(() => confirm.focus());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(screen.queryByTestId('osk')).toBeNull();
      // ...but the room stays, so the button does not move before the release lands on it.
      expect(inset()).toBe('260px');
      fireEvent.pointerUp(confirm, { pointerType: 'mouse', pointerId: 9 });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(inset()).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the floating keyboard button', () => {
  let rects: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    // jsdom lays nothing out; every element counts as on screen here.
    rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  });
  afterEach(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
    rects.mockRestore();
  });

  function tapButton() {
    const btn = screen.getByTestId('osk-button');
    fireEvent.pointerDown(btn, { pointerType: 'touch', pointerId: 7, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(btn, { pointerType: 'touch', pointerId: 7, clientX: 10, clientY: 10 });
  }

  it('stays on a touch screen, and is not drawn on a machine without one', () => {
    const { unmount } = mount(<Text />);
    expect(screen.getByTestId('osk-button')).toBeTruthy();
    unmount();
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
    mount(<Text />);
    expect(screen.queryByTestId('osk-button')).toBeNull();
  });

  it('brings the keys up for the focused field, even one reached by mouse, and steps aside while they are up', () => {
    mount(<Text />);
    const input = screen.getByLabelText<HTMLInputElement>('name');
    fireEvent.pointerDown(input, { pointerType: 'mouse' });
    act(() => input.focus());
    expect(screen.queryByTestId('osk')).toBeNull();
    tapButton();
    expect(screen.getByTestId('osk')).toBeTruthy();
    expect(screen.queryByTestId('osk-button')).toBeNull();
    // Space, not a letter: an earlier test left the session's remembered language on Arabic.
    tap('space');
    expect(input.value).toBe(' ');
    tap('hide');
    expect(screen.getByTestId('osk-button')).toBeTruthy();
  });

  it('with nothing focused, picks the field in the open dialog over the page behind it', () => {
    mount(
      <>
        <input aria-label="page" />
        <div role="dialog" aria-modal="true">
          <Pin onEnter={() => {}} />
        </div>
      </>,
    );
    tapButton();
    expect(document.activeElement).toBe(screen.getByLabelText('pin'));
    expect(screen.getByTestId('osk').dataset.oskKind).toBe('numeric');
  });

  it('says so when the screen has nothing to type into', () => {
    mount(<button type="button">only a button</button>);
    tapButton();
    expect(screen.queryByTestId('osk')).toBeNull();
    expect(screen.getByText('There is nothing to type into on this screen.')).toBeTruthy();
  });

  it('moves under a sliding finger, remembers the spot, and does not open on a slide', () => {
    mount(<Text />);
    const btn = screen.getByTestId('osk-button');
    fireEvent.pointerDown(btn, { pointerType: 'touch', pointerId: 3, clientX: 900, clientY: 600 });
    fireEvent.pointerMove(btn, { pointerType: 'touch', pointerId: 3, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(btn, { pointerType: 'touch', pointerId: 3, clientX: 400, clientY: 300 });
    expect(screen.queryByTestId('osk')).toBeNull();
    const saved = JSON.parse(localStorage.getItem('touch-operator-osk-button') ?? 'null') as { i: number; b: number } | null;
    expect(saved).not.toBeNull();
    expect(saved!.i).toBeCloseTo((400 - 26) / window.innerWidth, 5);
    expect(btn.style.insetInlineStart).not.toBe('');
  });
});

describe('TouchDisabledReason', () => {
  it("says a disabled button's reason when a finger taps it", () => {
    mount(
      <Button disabled disabledReason="Open a shift first">
        Pay
      </Button>,
    );
    const btn = screen.getByText('Pay').closest('button')!;
    expect(btn.getAttribute('data-disabled-reason')).toBe('Open a shift first');
    const prev = document.elementsFromPoint;
    document.elementsFromPoint = () => [btn];
    try {
      fireEvent.pointerDown(window, { pointerType: 'touch', clientX: 1, clientY: 1 });
    } finally {
      document.elementsFromPoint = prev;
    }
    expect(screen.getByText('Open a shift first')).toBeTruthy();
  });
});
