import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { COMPOSER_MAX_REM, Composer } from './Composer';

afterEach(() => cleanup());

describe('Composer', () => {
  it('grows with the question up to a cap, then scrolls (2026-11-12)', () => {
    render(
      <LocaleProvider>
        <Composer onAsk={() => {}} onStop={() => {}} streaming={false} />
      </LocaleProvider>,
    );
    const box = document.querySelector('textarea')!;
    // jsdom lays nothing out: the text's height is set by hand.
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 132 });
    fireEvent.change(box, { target: { value: 'A long question\nover three\nlines' } });
    expect(box.style.blockSize).toBe('132px');
    expect(box.style.maxBlockSize).toBe(`${COMPOSER_MAX_REM}rem`);
    expect(box.style.overflowY).toBe('auto');
  });
});
