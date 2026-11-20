import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { StationSetupScreen } from './StationSetupScreen';
import type { SetupState } from './stationSetup';

// The screen is pure: a state in, actions out. These tests drive each step the
// way a person at a fresh till would.

function renderStep(state: SetupState) {
  const dispatch = vi.fn();
  render(
    <LocaleProvider>
      <StationSetupScreen state={state} appVersion="0.2.0" dispatch={dispatch} />
    </LocaleProvider>,
  );
  return dispatch;
}

const till = { step: 'details', mode: 'till', stationId: 'TILL-01' } as const;

describe('StationSetupScreen', () => {
  it('mode: asks what the machine is for, the roles to pick from, the version in the footer', async () => {
    const dispatch = renderStep({ step: 'mode' });
    expect(screen.getByRole('heading', { name: 'What is this machine for?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Café cashier/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Kitchen screen/ })).toBeNull();
    expect(screen.getByText('Version 0.2.0')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Desk/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'chooseMode', mode: 'desk' });
  });

  it('till: the suggested id is prefilled and Finish is live', () => {
    renderStep(till);
    expect((screen.getByLabelText(/Station name/) as HTMLInputElement).value).toBe('TILL-01');
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('till: an invalid id disables Finish and says why', () => {
    renderStep({ ...till, stationId: '-1' });
    expect(screen.getByText('Use capitals, digits and dashes, starting with a letter.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saving and failed', () => {
    renderStep({ step: 'saving', details: till, request: { stationId: 'TILL-01', mode: 'till' } });
    expect(screen.getByText(/Saving and restarting/)).toBeTruthy();
  });

  it('failed: already configured is its own message, with no retry that cannot help', () => {
    renderStep({ step: 'failed', details: till, error: 'already-configured' });
    expect(screen.getByRole('alert').textContent).toContain('already set up');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('failed: a write failure can be retried', () => {
    renderStep({ step: 'failed', details: till, error: 'write-failed' });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
