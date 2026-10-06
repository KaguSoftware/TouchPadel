import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FillBar } from './TournamentParts';

// A list card is one <button> whose children are presentational, so its fill
// bar is decorative there (the "n / max registered" text beside it carries the
// figure); the detail banner's bar stays a labelled progressbar.
describe('FillBar', () => {
  it('is a labelled progressbar by default', () => {
    render(<FillBar percent={40} label="Round 2 of 5" />);
    const bar = screen.getByRole('progressbar', { name: 'Round 2 of 5' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('drops the role and hides itself when decorative', () => {
    const { container } = render(<FillBar percent={40} decorative />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
