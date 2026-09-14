import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../../lib/i18n';
import { makeFormatters } from '../format';
import { Kpi } from './Kpi';

const f = makeFormatters('en');

function tile(props: Partial<Parameters<typeof Kpi>[0]>) {
  return render(
    <LocaleProvider>
      <Kpi label="Waiter calls" value="12" delta={25} vsLabel="vs before" f={f} {...props} />
    </LocaleProvider>,
  );
}

describe('Kpi', () => {
  it('paints a rise in the accent tone by default and in the danger tone when inverted', () => {
    tile({});
    expect((screen.getByText('+25% vs before') as HTMLElement).style.color).toBe('var(--tp-accent)');
  });

  it('inverts the tone for figures where a rise is bad', () => {
    tile({ invert: true });
    expect((screen.getByText('+25% vs before') as HTMLElement).style.color).toBe('var(--tp-danger)');
  });

  it('stays muted for a neutral figure: more waiter calls is neither good nor bad', () => {
    tile({ neutral: true });
    expect((screen.getByText('+25% vs before') as HTMLElement).style.color).toBe('var(--tp-muted-fg)');
    tile({ neutral: true, delta: -30 });
    expect((screen.getByText('−30% vs before') as HTMLElement).style.color).toBe('var(--tp-muted-fg)');
  });

  it('shows a dash and no delta when the figure is unavailable', () => {
    tile({ unavailable: true });
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText(/vs before/)).toBeNull();
  });
});
