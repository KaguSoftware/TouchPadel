import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { Disclosure, loadOpen, saveOpen } from './Disclosure';

function renderIn(ui: React.ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe('Disclosure', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage */
    }
  });

  it('opens by default, hides the body and shows the summary when folded, and remembers the choice', () => {
    renderIn(
      <Disclosure storageKey="t1" title="What this chat may read" summary="14 · ≈ 1.2k tokens">
        <p>body text</p>
      </Disclosure>,
    );
    const btn = screen.getByRole('button', { name: /What this chat may read/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('body text')).toBeTruthy();
    expect(screen.queryByText('14 · ≈ 1.2k tokens')).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('body text')).toBeNull();
    expect(screen.getByText('14 · ≈ 1.2k tokens')).toBeTruthy();
    expect(loadOpen('t1', true)).toBe(false);
  });

  it('starts from the remembered choice, then the default', () => {
    saveOpen('t2', false);
    renderIn(
      <Disclosure storageKey="t2" title="Model" summary="Sonnet 5">
        <p>switch</p>
      </Disclosure>,
    );
    expect(screen.queryByText('switch')).toBeNull();
    renderIn(
      <Disclosure storageKey="t3" defaultOpen={false} title="This message" summary="3.5k · <$0.01">
        <p>meter</p>
      </Disclosure>,
    );
    expect(screen.queryByText('meter')).toBeNull();
    expect(screen.getByText('3.5k · <$0.01')).toBeTruthy();
  });
});
