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

describe('Modal canClose', () => {
  it('asks before the exit, and a "no" leaves no half-closed backdrop', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const canClose = vi.fn().mockResolvedValue(false);
    render(
      <LocaleProvider>
        <Modal title="Edit ingredient" onClose={onClose} canClose={canClose}>
          <p>body</p>
        </Modal>
      </LocaleProvider>,
    );
    const backdrop = screen.getByRole('dialog');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(canClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // The freeze: the fade had already run, leaving an invisible layer on top.
    expect(document.querySelector('[data-closing]')).toBeNull();
    canClose.mockResolvedValue(true);
    fireEvent.keyDown(backdrop, { key: 'Escape' });
    await act(async () => {}); // the answer settles, then the exit starts
    act(() => void vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('Modal requireChoice', () => {
  it('refuses a backdrop click with a warning instead of closing', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <LocaleProvider>
        <Modal title="You have unsaved changes" onClose={onClose} requireChoice footer={<button>Keep editing</button>}>
          <p>body</p>
        </Modal>
      </LocaleProvider>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    const backdrop = screen.getByRole('dialog');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-closing]')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    vi.useRealTimers();
  });
});
