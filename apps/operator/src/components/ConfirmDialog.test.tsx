import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider, useLocale } from '../lib/i18n';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';

// The dirty-leave prompt every editor shares. It used to be one long question
// in the title with an empty body under it, and the red button sat at the far
// edge of the footer.

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  const { tr } = useLocale();
  return (
    <button
      onClick={() =>
        void confirm({
          title: tr('ws.kit.actions.dirtyLeave'),
          body: tr('ws.kit.actions.dirtyLeaveBody'),
          confirmLabel: tr('ws.kit.actions.dirtyLeaveConfirm'),
          cancelLabel: tr('ws.kit.actions.dirtyLeaveCancel'),
          kind: 'danger',
          pairActions: true,
        }).then(onResult)
      }
    >
      leave
    </button>
  );
}

function renderHarness(onResult = vi.fn()) {
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <Harness onResult={onResult} />
      </ConfirmProvider>
    </LocaleProvider>,
  );
  return onResult;
}

describe('the dirty-leave confirm', () => {
  it('states the loss in a body under a plain title, and names both deeds', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'leave' }));
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    expect(screen.getByText('Everything you changed here will be lost. Are you sure you want to close?')).toBeTruthy();
    // Neither button says "Confirm" or "Cancel": each says what it does.
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('keeps the two buttons paired instead of spreading the red one to the far edge', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'leave' }));
    const discard = screen.getByRole('button', { name: 'Discard changes' });
    expect(discard.style.marginInlineStart).not.toBe('auto');
  });

  it('autofocuses the safe choice, so Enter and Esc both keep the edits', async () => {
    const user = userEvent.setup();
    const onResult = renderHarness();
    await user.click(screen.getByRole('button', { name: 'leave' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('resolves true only when the manager picks the red deed', async () => {
    const user = userEvent.setup();
    const onResult = renderHarness();
    await user.click(screen.getByRole('button', { name: 'leave' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });
});
