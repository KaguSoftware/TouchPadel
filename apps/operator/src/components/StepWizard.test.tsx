import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';
import { ReviewList, StepWizard, type WizardStep } from './StepWizard';

function renderWizard({ problems = [] as string[], onSubmit = vi.fn() } = {}) {
  const steps: WizardStep[] = [
    { key: 'name', label: 'Name', note: 'Gold', problems, content: <p>name step</p> },
    { key: 'points', label: 'Points', content: <p>points step</p> },
  ];
  render(
    <LocaleProvider>
      <StepWizard
        title="Add a tier"
        steps={steps}
        review={(goTo) => <ReviewList rows={[{ label: 'Name', value: 'Gold', step: 'name' }]} goTo={goTo} />}
        submitLabel="Save"
        onSubmit={onSubmit}
        onClose={vi.fn()}
        testId="wiz"
      />
    </LocaleProvider>,
  );
  return { onSubmit };
}

describe('StepWizard', () => {
  it('counts only the steps, not Review, and names the buttons after them', () => {
    renderWizard();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByText('0 of 2 done')).toBeTruthy();
    // Review is in the menu, unnumbered, but the steps are what is counted.
    expect(screen.getByTestId('wiz.step.review').textContent).toBe('Review');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Points' }).at(-1)!);
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    // The footer's way back is named after the step before.
    expect(screen.getByRole('button', { name: 'Name' })).toBeTruthy();
    // The last step's way on is the Review page.
    fireEvent.click(screen.getAllByRole('button', { name: 'Review' }).at(-1)!);
    expect(screen.getByText('All 2 steps done')).toBeTruthy();
    expect(screen.getByText('2 of 2 done')).toBeTruthy();
    // The passed step shows its answer under its name.
    expect(screen.getByTestId('wiz.step.name').textContent).toContain('Gold');
  });

  it('holds an unfinished step and says why', () => {
    renderWizard({ problems: ['Both names are needed.'] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Points' }).at(-1)!);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByText('Both names are needed.')).toBeTruthy();
  });

  it('submits from Review, and Change opens the step', () => {
    const { onSubmit } = renderWizard();
    fireEvent.click(screen.getByTestId('wiz.step.review'));
    fireEvent.click(screen.getByTestId('wiz.submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Change Name' }));
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });
});
