import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';
import { DateRangePicker, type DateRangePreset, type Period } from './DateRangePicker';

const TODAY = '2026-10-19';
const PRESETS: DateRangePreset[] = [
  { key: 'today', label: 'Today', period: { from: TODAY, to: TODAY } },
  { key: '7d', label: '7 days', period: { from: '2026-10-13', to: TODAY } },
  { key: '30d', label: '30 days', period: { from: '2026-09-20', to: TODAY } },
];

function renderPicker(value: Period = { from: '2026-09-20', to: TODAY }, max?: string) {
  const onChange = vi.fn();
  render(
    <LocaleProvider>
      <DateRangePicker value={value} onChange={onChange} presets={PRESETS} today={TODAY} max={max} aria-label="Period" />
    </LocaleProvider>,
  );
  return onChange;
}

const field = () => screen.getByRole('button', { name: 'Period' });
const fieldText = () => (field().textContent ?? '').replace(/ /g, ' ');
const apply = () => screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;

describe('DateRangePicker', () => {
  it('shows only the dates in the field, without this year', () => {
    renderPicker();
    expect(fieldText()).toBe('20 Sep – 19 Oct');
  });

  it('names both years when the range crosses one', () => {
    renderPicker({ from: '2025-01-01', to: TODAY });
    expect(fieldText()).toBe('1 Jan 2025 – 19 Oct 2026');
  });

  it('opens on the chip the range matches, and a chip fills the field before Apply', () => {
    const onChange = renderPicker();
    fireEvent.click(field());
    expect(screen.getByRole('button', { name: '30 days', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    // The field is the readout: it changes at once, the panel stays open.
    expect(fieldText()).toBe('13 Oct – 19 Oct');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(apply());
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-13', to: TODAY }, '7d');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('picks a range in two presses, with Apply off until the second', () => {
    const onChange = renderPicker();
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Oct 15, 2026' }));
    expect(fieldText()).toBe('15 Oct – …');
    expect(apply().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Oct 10, 2026' }));
    expect(fieldText()).toBe('10 Oct – 15 Oct');
    fireEvent.click(apply());
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-10', to: '2026-10-15' }, undefined);
  });

  it('Escape cancels: nothing applied, the field goes back', () => {
    const onChange = renderPicker();
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(fieldText()).toBe('20 Sep – 19 Oct');
  });

  it('Clear empties the pick and turns Apply off', () => {
    renderPicker();
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(fieldText()).toBe('Pick dates');
    expect(apply().disabled).toBe(true);
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
  });

  it('changes month and year from the title', () => {
    renderPicker();
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Choose month and year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose year' }));
    fireEvent.click(screen.getByRole('button', { name: '2025' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mar' }));
    expect(screen.getByRole('button', { name: 'Choose month and year' }).textContent).toContain('March 2025');
    expect(screen.getByRole('button', { name: 'Mar 31, 2025' })).toBeTruthy();
  });

  it('keeps days, months and years after `max` out of reach', () => {
    renderPicker(undefined, TODAY);
    fireEvent.click(field());
    expect((screen.getByRole('button', { name: 'Oct 20, 2026' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose month and year' }));
    expect((screen.getByRole('button', { name: 'Nov' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
