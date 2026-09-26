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
  it('holds a five-digit year instead of offering it to Apply', () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider>
        <DateRangeControl period={{ from: '2026-09-01', to: '2026-09-23' }} onChange={onChange} />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '20266-09-01' } });
    // The draft never took the bad year, so there is nothing to apply.
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
