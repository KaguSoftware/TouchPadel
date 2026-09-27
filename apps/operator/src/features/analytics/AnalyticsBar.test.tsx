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

  // The bar's dropdowns are SelectMenu, not a native <select>: the options
  // only exist once the panel is open, so each one is opened and then clicked.
  it('writes the court filter to the search', async () => {
    const setSearch = renderBar({ courts: [{ id: 'c1', label: 'Court 1' }] });
    await userEvent.click(screen.getByRole('combobox', { name: 'Court' }));
    await userEvent.click(screen.getByRole('option', { name: 'Court 1' }));
    expect(setSearch).toHaveBeenCalledWith({ court: 'c1' });
  });

  it('closes the court panel on Escape without choosing, and returns focus', async () => {
    const setSearch = renderBar({ courts: [{ id: 'c1', label: 'Court 1' }] });
    const trigger = screen.getByRole('combobox', { name: 'Court' });
    await userEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(setSearch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('commits the arrow-key choice on Enter', async () => {
    const setSearch = renderBar({ courts: [{ id: 'c1', label: 'Court 1' }] });
    screen.getByRole('combobox', { name: 'Court' }).focus();
    // Opens on ArrowDown at the current choice ("All courts"), steps to Court 1.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(setSearch).toHaveBeenCalledWith({ court: 'c1' });
  });

  // The menu portals to <body>, so it is DOM-outside the Settings dialog that
  // holds its trigger. Without the [data-menu-portal] guard in MorePanel, the
  // press that chose an hour read as a press outside and closed the panel.
  it('keeps the Settings panel open while its own dropdown is used', async () => {
    renderBar({ deck: { startHour: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Business day starts at' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: '06:00' }));
    expect(mutate).toHaveBeenCalledWith({ key: 'analytics_business_day_start_hour', value: 6 });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });

  // The bar carries backdrop-filter, which makes it a containing block for
  // fixed-position descendants — so a panel rendered inside it resolved its
  // viewport coordinates against the BAR and hung low, detached from the
  // Settings button and floating over the cards. The portal is what fixes it.
  it('renders the Settings panel outside the filtered bar', async () => {
    renderBar({ deck: { startHour: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    expect(document.getElementById('analytics-bar')?.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
  });

  // The tip is inside the Settings panel, which is itself portalled and
  // fixed-positioned: rendered in place its bubble measured against that
  // panel and landed off-screen, so the button lit up and nothing showed.
  it('shows the info tip opened from inside the Settings panel', async () => {
    renderBar({ deck: { startHour: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    const tip = panel.querySelector<HTMLElement>('.tp-infotip-trigger');
    expect(tip).toBeTruthy();
    await userEvent.click(tip!);
    const bubble = document.querySelector('.tp-infotip[data-open="true"]');
    expect(bubble).toBeTruthy();
    // Portalled out of the panel, which is the whole fix.
    expect(panel.contains(bubble!)).toBe(false);
    expect(bubble!.parentElement).toBe(document.body);
  });

  // Opening Settings used to focus the label's InfoTip — the panel's focus
  // selector said 'select, button, input', and once the dropdown stopped being
  // a <select> the first match became the tooltip button, which opens on focus
  // and covered the only control in the panel.
  it('focuses the setting itself when the panel opens, not the info tip', async () => {
    renderBar({ deck: { startHour: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Business day starts at' }));
  });

  it('opens the Settings panel, keeps it open through a setting write, and closes on Escape', async () => {
    renderBar({ deck: { startHour: 4 } });
    const more = screen.getByRole('button', { name: 'Settings' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(more);
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    expect(panel).toBeTruthy();
    await userEvent.click(screen.getByRole('combobox', { name: 'Business day starts at' }));
    await userEvent.click(screen.getByRole('option', { name: '06:00' }));
    expect(mutate).toHaveBeenCalledWith({ key: 'analytics_business_day_start_hour', value: 6 });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});
