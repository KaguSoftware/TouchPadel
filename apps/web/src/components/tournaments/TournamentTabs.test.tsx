import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TournamentTabs } from './TournamentTabs';

const tabs = [
  { id: 'standings', label: 'Standings', content: <p>The table</p> },
  { id: 'schedule', label: 'Schedule', content: <p>The rounds</p> },
];

describe('TournamentTabs', () => {
  it('shows the first segment and hides the other', () => {
    render(<TournamentTabs tabs={tabs} label="Tournament" />);
    expect(screen.getByRole('tab', { name: 'Standings' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Schedule' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByText('The table').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(
      screen
        .getByText('The rounds', { exact: true })
        .closest('[role="tabpanel"]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
  });

  it('switches on a click and on the arrow keys', () => {
    render(<TournamentTabs tabs={tabs} label="Tournament" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    expect(screen.getByRole('tab', { name: 'Schedule' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Schedule' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Schedule' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Standings' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Standings' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Schedule' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
