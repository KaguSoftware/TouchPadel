import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { AnalyticsTabs } from './AnalyticsTabs';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

function renderTabs(value: 'courts' | 'cafe') {
  return render(
    <LocaleProvider>
      <AnalyticsTabs value={value} />
    </LocaleProvider>,
  );
}

describe('AnalyticsTabs', () => {
  beforeEach(() => navigate.mockReset());

  it('renders the two tabs with the current one selected', () => {
    renderTabs('cafe');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Courts', 'Cafe']);
    expect(screen.getByRole('tab', { name: 'Cafe' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Courts' })).toHaveAttribute('aria-selected', 'false');
  });

  it('navigates to the other tab and keeps the search params', async () => {
    renderTabs('cafe');
    await userEvent.click(screen.getByRole('tab', { name: 'Courts' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/analytics/courts', search: expect.any(Function) });
    const search = navigate.mock.calls[0]![0].search as (prev: unknown) => unknown;
    expect(search({ range: '7d', cmp: '4w' })).toEqual({ range: '7d', cmp: '4w' });
  });

  it('does not navigate when the current tab is clicked again', async () => {
    renderTabs('courts');
    await userEvent.click(screen.getByRole('tab', { name: 'Courts' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys, Home and End', async () => {
    renderTabs('courts');
    screen.getByRole('tab', { name: 'Courts' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/analytics/cafe' }));
    await userEvent.keyboard('{End}');
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/analytics/cafe' }));
    navigate.mockReset();
    await userEvent.keyboard('{Home}');
    // Already on the first tab: nothing to do.
    expect(navigate).not.toHaveBeenCalled();
  });
});
