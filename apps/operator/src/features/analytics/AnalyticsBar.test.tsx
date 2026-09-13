import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { AnalyticsBar } from './AnalyticsBar';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
const mutate = vi.fn();
vi.mock('../../lib/settings', () => ({ useSetCafeSetting: () => ({ mutate, isPending: false, error: null }) }));

function renderBar(props: Partial<Parameters<typeof AnalyticsBar>[0]> = {}) {
  const setSearch = vi.fn();
  render(
    <LocaleProvider>
      <AnalyticsBar tab="courts" search={{ range: '30d' }} setSearch={setSearch} zones={[]} compareBasis="prev" {...props} />
    </LocaleProvider>,
  );
  return setSearch;
}

describe('AnalyticsBar', () => {
  beforeEach(() => {
    navigate.mockReset();
    mutate.mockReset();
  });

  it('writes a preset to the search and hides the date inputs until Custom is chosen', async () => {
    const setSearch = renderBar();
    expect(screen.queryByLabelText('From')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(setSearch).toHaveBeenCalledWith({ range: '7d', from: undefined, to: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(setSearch).toHaveBeenCalledTimes(1);
  });

  it('applies a custom range only when both dates are valid and ordered', async () => {
    const setSearch = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('From'), '2026-08-10');
    await userEvent.type(screen.getByLabelText('To'), '2026-08-01');
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText('To'));
    await userEvent.type(screen.getByLabelText('To'), '2026-08-20');
    await userEvent.click(apply);
    expect(setSearch).toHaveBeenCalledWith({ range: 'custom', from: '2026-08-10', to: '2026-08-20' });
  });

  it('writes the court filter to the search', async () => {
    const setSearch = renderBar({ courts: [{ id: 'c1', label: 'Court 1' }] });
    await userEvent.selectOptions(screen.getByLabelText('Court'), 'c1');
    expect(setSearch).toHaveBeenCalledWith({ court: 'c1' });
  });

  it('opens the More panel, keeps it open through a setting write, and closes on Escape', async () => {
    renderBar({
      deck: { startHour: 4, live: true, refreshMinutes: 0, setRefreshMinutes: vi.fn(), autoRefreshActive: false },
    });
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(more);
    const panel = screen.getByRole('dialog', { name: 'More' });
    expect(panel).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Business day starts at'), '6');
    expect(mutate).toHaveBeenCalledWith({ key: 'analytics_business_day_start_hour', value: 6 });
    expect(screen.getByRole('dialog', { name: 'More' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});
