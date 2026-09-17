import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LocaleProvider } from '../../../lib/i18n';
import { makeFormatters } from '../format';
import { FigureLine, Kpi } from './Kpi';

const f = makeFormatters('en');

function tile(props: Partial<Parameters<typeof Kpi>[0]>) {
  return render(
    <LocaleProvider>
      <Kpi label="Waiter calls" value="12" delta={25} f={f} {...props} />
    </LocaleProvider>,
  );
}

/** The change text's own span carries the tone. */
const toneOf = (text: string) => (screen.getByText(text).closest('[data-tone]') as HTMLElement).dataset.tone;

describe('Kpi', () => {
  it('paints a rise in the success tone by default and in the danger tone when inverted', () => {
    const { unmount } = tile({});
    expect(toneOf('+25%')).toBe('success');
    unmount();
    tile({ invert: true });
    expect(toneOf('+25%')).toBe('danger');
  });

  it('stays neutral for a figure where neither direction is good', () => {
    const { unmount } = tile({ neutral: true });
    expect(toneOf('+25%')).toBe('neutral');
    unmount();
    tile({ neutral: true, delta: -30 });
    expect(toneOf('−30%')).toBe('neutral');
  });

  it('moves a rate in points, not percent, and says what the figure was', () => {
    tile({ label: 'Occupancy', value: '23%', delta: 3, kind: 'points', previous: '20%' });
    expect(screen.getByText('+3 pts')).toBeTruthy();
    expect(screen.getByText('was 20%')).toBeTruthy();
    expect(screen.queryByText('+3%')).toBeNull();
  });

  it('prints only the earlier figure when there is no reliable change, and nothing when there is neither', () => {
    const { unmount } = tile({ delta: null, previous: '9' });
    expect(screen.getByText('was 9')).toBeTruthy();
    expect(document.querySelector('[data-tone]')).toBeNull();
    unmount();
    tile({ delta: null });
    expect(screen.queryByText(/^was /)).toBeNull();
  });

  it('shows a dash and no change when the figure is unavailable', () => {
    tile({ unavailable: true, previous: '9' });
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('+25%')).toBeNull();
    expect(screen.queryByText('was 9')).toBeNull();
  });

  it('opens the transactions behind the figure, naming each figure when a tile carries two', () => {
    const one = vi.fn();
    const { unmount } = tile({ drills: [{ onOpen: one }] });
    fireEvent.click(screen.getByRole('button', { name: 'Open the transactions behind Waiter calls' }));
    expect(one).toHaveBeenCalledTimes(1);
    expect(screen.getByText('See transactions')).toBeTruthy();
    unmount();

    const cash = vi.fn();
    const card = vi.fn();
    tile({ drills: [{ label: 'Cash', onOpen: cash }, { label: 'Card', onOpen: card }] });
    fireEvent.click(screen.getByRole('button', { name: 'Open the transactions behind Card' }));
    expect(card).toHaveBeenCalledTimes(1);
    expect(cash).not.toHaveBeenCalled();
  });

  it('offers no way in while the figure is loading or unavailable', () => {
    const { unmount } = tile({ loading: true, drills: [{ onOpen: vi.fn() }] });
    expect(screen.queryByRole('button', { name: /Open the transactions/ })).toBeNull();
    unmount();
    tile({ unavailable: true, drills: [{ onOpen: vi.fn() }] });
    expect(screen.queryByRole('button', { name: /Open the transactions/ })).toBeNull();
  });
});

describe('FigureLine', () => {
  it('puts the value at the end of the row and the drill behind an icon button named for the figure', () => {
    const open = vi.fn();
    render(
      <LocaleProvider>
        <ul>
          <FigureLine label="Refunds" value="70,000 IQD" delta={40} invert previous="50,000 IQD" drills={[{ onOpen: open }]} f={f} />
        </ul>
      </LocaleProvider>,
    );
    expect(screen.getByText('70,000 IQD', { selector: 'strong' })).toBeTruthy();
    expect(toneOf('+40%')).toBe('danger');
    fireEvent.click(screen.getByRole('button', { name: 'Open the transactions behind Refunds' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
