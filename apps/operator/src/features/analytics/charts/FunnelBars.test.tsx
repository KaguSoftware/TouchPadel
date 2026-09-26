import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../../lib/i18n';
import { makeFormatters } from '../format';
import { FunnelBars } from './FunnelBars';

// The four steps come from the PostHog funnel query by their raw event names;
// the chart must print words, never `item_added_to_basket`.
const steps = [
  { step: 'pageview', sessions: 100 },
  { step: 'item_viewed', sessions: 60 },
  { step: 'item_added_to_basket', sessions: 30 },
  { step: 'order_submitted', sessions: 12 },
];

describe('FunnelBars', () => {
  it('labels the real steps in words and prints each drop-off', () => {
    render(
      <LocaleProvider>
        <FunnelBars steps={steps} f={makeFormatters('en')} />
      </LocaleProvider>,
    );
    for (const label of ['Opened the menu', 'Viewed an item', 'Added to basket', 'Ordered']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/item_added_to_basket/)).toBeNull();
    expect(screen.getByText('60 · −40%')).toBeTruthy();
    expect(screen.getByText('12 · −60%')).toBeTruthy();
  });

  it('falls back to the raw name for a step it does not know', () => {
    render(
      <LocaleProvider>
        <FunnelBars steps={[{ step: 'pageview', sessions: 10 }, { step: 'mystery', sessions: 4 }]} f={makeFormatters('en')} />
      </LocaleProvider>,
    );
    expect(screen.getByText('mystery')).toBeTruthy();
  });
});
