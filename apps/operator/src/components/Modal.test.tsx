import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';
import { Modal } from './ui';

function renderModal(dismissible: boolean, onClose = vi.fn()) {
  const view = render(
    <LocaleProvider>
      <Modal title="Take payment" onClose={onClose} dismissible={dismissible}>
        <p>body</p>
      </Modal>
    </LocaleProvider>,
  );
  return { onClose, rerender: view.rerender };
}

describe('Modal dismissible', () => {
  it('ignores Esc while not dismissible and leaves no half-closed backdrop', () => {
    vi.useFakeTimers();
    const { onClose } = renderModal(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(onClose).not.toHaveBeenCalled();
    // The bug: the exit fade was applied and stuck, leaving an invisible layer
    // that swallowed every click, with `closing` latched so Esc never worked again.
    expect(document.querySelector('[data-closing]')).toBeNull();
    vi.useRealTimers();
  });

  it('closes normally once it is dismissible again', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = renderModal(false, onClose);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    rerender(
      <LocaleProvider>
        <Modal title="Take payment" onClose={onClose} dismissible>
          <p>body</p>
        </Modal>
      </LocaleProvider>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('is dismissible by default', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <LocaleProvider>
        <Modal title="Take payment" onClose={onClose}>
          <p>body</p>
        </Modal>
      </LocaleProvider>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
