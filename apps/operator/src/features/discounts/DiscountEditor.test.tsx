import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { DiscountEditor } from './DiscountEditor';
import { checkDraft, draftOf, type DiscountDraft, type DraftSections } from './discountLogic';

// The editor's inline rules: a value typed out of range is said at once; an
// empty value, no part at all and a missing reason only once Save was pressed.

function Harness({ sections = { cafe: true, court: true }, initial = draftOf(null), showErrors = false }: { sections?: DraftSections; initial?: DiscountDraft; showErrors?: boolean }) {
  const [draft, setDraft] = useState(initial);
  const check = checkDraft(draft, sections);
  return (
    <LocaleProvider>
      <DiscountEditor draft={draft} onChange={setDraft} sections={sections} check={check} showErrors={showErrors} />
      <output data-testid="ok">{String(check.ok)}</output>
    </LocaleProvider>
  );
}

describe('DiscountEditor', () => {
  it('shows a Café and shop part and a Court fee part, each None / % / IQD, and the five reasons', () => {
    render(<Harness />);
    const cafe = within(screen.getByTestId('discount-cafe'));
    expect(cafe.getByText('Café and shop')).toBeTruthy();
    for (const name of ['None', '%', 'IQD']) expect(cafe.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByTestId('discount-court')).toBeTruthy();
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio')).toHaveLength(5);
  });

  it('a percent over 100 is said at once; a valid one with a reason passes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const cafe = within(screen.getByTestId('discount-cafe'));
    await user.click(cafe.getByRole('button', { name: '%' }));
    const value = cafe.getByRole('textbox', { name: 'Café and shop: how much' });
    await user.type(value, '150');
    expect(cafe.getByRole('alert').textContent).toBe('Enter a percent from 1 to 100.');
    await user.clear(value);
    await user.type(value, '20');
    expect(cafe.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('ok').textContent).toBe('false');
    await user.click(screen.getByRole('radio', { name: 'Coach' }));
    expect(screen.getByTestId('ok').textContent).toBe('true');
  });

  it('switching the kind empties the value: 20% never becomes 20 IQD', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...draftOf(null), cafe: { mode: 'percent', text: '20' }, reason: 'coach' }} />);
    const cafe = within(screen.getByTestId('discount-cafe'));
    await user.click(cafe.getByRole('button', { name: 'IQD' }));
    expect((cafe.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('after Save: nothing set is said', () => {
    render(<Harness showErrors />);
    expect(screen.getByText('Set a discount on the café, the court fee, or both.')).toBeTruthy();
  });

  it('after Save: a part with no value asks for one, and a part with no reason asks for it', () => {
    render(<Harness showErrors initial={{ ...draftOf(null), court: { mode: 'amount', text: '' } }} />);
    expect(within(screen.getByTestId('discount-court')).getByRole('alert').textContent).toBe('Enter how much.');
    expect(screen.getByText('Choose a reason.')).toBeTruthy();
  });

  it('a bill without a booking shows the café part only', () => {
    render(<Harness sections={{ cafe: true, court: false }} />);
    expect(screen.queryByTestId('discount-court')).toBeNull();
  });
});
