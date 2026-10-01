import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';
import { CustomerFlagBadge, ReasonCodePrompt } from './kit';

// noteMode (open matches operator.md §5.15.2): a ban takes a fixed code with
// an optional note under every code, still required for "Other" (R35).

function renderPrompt(props: Partial<Parameters<typeof ReasonCodePrompt>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <LocaleProvider>
      <ReasonCodePrompt action="ban from open matches" reasonCodes={['conduct', 'no_shows', 'reported', 'other']} onSubmit={onSubmit} onCancel={() => {}} {...props} />
    </LocaleProvider>,
  );
  return onSubmit;
}

describe('ReasonCodePrompt noteMode', () => {
  it('by default asks for words only on Other, as before', async () => {
    const user = userEvent.setup();
    const onSubmit = renderPrompt();
    expect(screen.queryByLabelText('Note (optional)')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Conduct' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith('conduct', '');
  });

  it('optional: a note under every code, sent trimmed; Other still needs it', async () => {
    const user = userEvent.setup();
    const onSubmit = renderPrompt({ noteMode: 'optional' });
    await user.click(screen.getByRole('radio', { name: 'Reported by players' }));
    await user.type(screen.getByLabelText('Note (optional)'), '  three reports this week ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenLastCalledWith('reported', 'three reports this week');

    await user.click(screen.getByRole('radio', { name: 'Other' }));
    const field = screen.getByLabelText('What is the reason?') as HTMLInputElement;
    await user.clear(field);
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(field, 'shouting');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenLastCalledWith('other', 'shouting');
  });

  it('an optional note left empty sends the bare code', async () => {
    const user = userEvent.setup();
    const onSubmit = renderPrompt({ noteMode: 'optional' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith('conduct', '');
  });
});

describe('CustomerFlagBadge: a match ban', () => {
  it('reads "Banned from open matches · <reason>" with the code in words', () => {
    render(
      <LocaleProvider>
        <CustomerFlagBadge flag={{ type: 'match_ban', label: 'reported' }} />
      </LocaleProvider>,
    );
    expect(screen.getByText('Banned from open matches · Reported by players')).toBeTruthy();
  });
});
