import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { WorkspaceGuideDialog, type WorkspaceGuideDialogProps } from './WorkspaceGuideDialog';
import { guideStorageKey } from './guideProgress';

function renderGuide(over: Partial<WorkspaceGuideDialogProps> = {}) {
  const props: WorkspaceGuideDialogProps = {
    workspace: 'cashier',
    staffId: 'staff-1',
    role: 'cashier',
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    ...over,
  };
  const view = render(
    <LocaleProvider>
      <WorkspaceGuideDialog {...props} />
    </LocaleProvider>,
  );
  return { props, ...view };
}

beforeEach(() => {
  localStorage.clear();
});

describe('WorkspaceGuideDialog', () => {
  it('shows the till guide with one tab per section and its progress', () => {
    renderGuide();
    expect(screen.getByRole('dialog', { name: 'Till guide' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toContain('Start of shift');
    expect(tabs.some((t) => t?.includes('Corrections'))).toBe(true);
    expect(screen.getByTestId('guide-progress').textContent).toMatch(/^0 of \d+ learned$/);
    expect(screen.getAllByTestId('guide-step').length).toBeGreaterThan(0);
  });

  it('a tick counts at once and is still there after a remount', async () => {
    const { unmount } = renderGuide();
    const first = screen.getAllByTestId('guide-step')[0]!;
    await userEvent.click(within(first).getByRole('checkbox', { name: 'I know this' }));
    expect(screen.getByTestId('guide-progress').textContent).toMatch(/^1 of \d+ learned$/);
    expect(screen.getAllByRole('tab')[0]!.textContent).toMatch(/1\/\d+$/);
    expect(localStorage.getItem(guideStorageKey('staff-1'))).toContain('cashier.start.');
    unmount();

    renderGuide();
    expect(screen.getByTestId('guide-progress').textContent).toMatch(/^1 of \d+ learned$/);
    expect((within(screen.getAllByTestId('guide-step')[0]!).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);

    // Start over clears this workspace's ticks only.
    await userEvent.click(screen.getByTestId('guide-start-over'));
    expect(screen.getByTestId('guide-progress').textContent).toMatch(/^0 of \d+ learned$/);
  });

  it('Go there navigates and closes the dialog', async () => {
    const { props } = renderGuide();
    await userEvent.click(screen.getByRole('tab', { name: /Corrections/ }));
    const merge = screen.getAllByTestId('guide-step').find((li) => li.getAttribute('data-step-id') === 'cashier.fix.merge')!;
    await userEvent.click(within(merge).getByRole('button', { name: 'Go there' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/till/tabs');
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it('marks a step that needs a manager’s PIN', async () => {
    renderGuide();
    await userEvent.click(screen.getByRole('tab', { name: /Corrections/ }));
    const discount = screen.getAllByTestId('guide-step').find((li) => li.getAttribute('data-step-id') === 'cashier.fix.discount')!;
    expect(within(discount).getByText('Manager’s PIN')).toBeTruthy();
    // The button name is the till's own label, read from its key.
    expect(discount.textContent).toContain('Discount');
  });

  it('leaves out a step whose page the viewer cannot open', () => {
    // /tasks is not the manager's, so a manager in the till sees no My tasks step.
    renderGuide({ role: 'manager' });
    expect(screen.queryByRole('tab', { name: /Tasks and breaks/ })).toBeTruthy();
    expect(document.querySelector('[data-step-id="cashier.more.tasks"]')).toBeNull();
  });

  it('renders in Arabic', () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    renderGuide();
    expect(screen.getByRole('dialog', { name: 'دليل الصندوق' })).toBeTruthy();
    expect(screen.getByTestId('guide-progress').textContent).toMatch(/^تعلّمت 0 من \d+$/);
    expect(screen.getAllByRole('checkbox', { name: 'أعرف هذا' }).length).toBeGreaterThan(0);
  });

  it('the kitchen guide uses the board tone', () => {
    renderGuide({ workspace: 'prep', role: 'chef' });
    expect(screen.getByRole('dialog').getAttribute('data-tone')).toBe('board');
    renderGuide();
    expect(screen.getAllByRole('dialog')[1]!.getAttribute('data-tone')).toBeNull();
  });
});
