import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';
import { AmountPad } from './ui';
import { DateRangeControl } from './kit';

describe('AmountPad nullable', () => {
  function pad(value: number | null) {
    const onChange = vi.fn();
    render(
      <LocaleProvider>
        <AmountPad nullable value={value} onChange={onChange} />
      </LocaleProvider>,
    );
    return onChange;
  }

  it('Clear goes back to "not entered", not to a count of 0', () => {
    const onChange = pad(25_000);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('backspace on the last digit empties it', () => {
    const onChange = pad(5);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('a first digit starts the count, and 0 is a count', () => {
    const onChange = pad(null);
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it('the plain pad still clears to 0', () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider>
        <AmountPad value={120} onChange={onChange} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});

describe('DateRangeControl', () => {
  // The two date boxes are gone (DateRangePicker, 2026-10-19): the periods are
  // the panel's chips, resolved against `now`, and nothing applies until Apply.
  it('offers its periods as chips and applies the one picked', () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider>
        <DateRangeControl period={{ from: '2026-09-01', to: '2026-09-23' }} onChange={onChange} now={new Date(2026, 8, 23)} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
    expect(screen.getByRole('button', { name: 'This month', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-22', to: '2026-09-22' });
  });
});
