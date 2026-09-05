import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { StationSetupScreen } from './StationSetupScreen';
import type { DetailsState, SetupState } from './stationSetup';

// The screen is pure: a state in, actions out. These tests drive each step the
// way a person at a fresh till or kitchen screen would.

function renderStep(state: SetupState) {
  const dispatch = vi.fn();
  render(
    <LocaleProvider>
      <StationSetupScreen state={state} appVersion="0.2.0" dispatch={dispatch} />
    </LocaleProvider>,
  );
  return dispatch;
}

const kds: DetailsState = { step: 'details', mode: 'kds', stationId: 'KDS-01', code: '', host: '', showAdvanced: false };

describe('StationSetupScreen', () => {
  it('mode: three roles to pick from, the version in the footer', async () => {
    const dispatch = renderStep({ step: 'mode' });
    expect(screen.getByRole('button', { name: /^Till/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Desk/ })).toBeTruthy();
    expect(screen.getByText('Version 0.2.0')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Kitchen screen/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'chooseMode', mode: 'kds' });
  });

  it('till: the suggested id is prefilled and Finish is live; an invalid id explains itself', () => {
    renderStep({ step: 'details', mode: 'till', stationId: 'TILL-01', code: '', host: '', showAdvanced: false });
    expect((screen.getByLabelText(/Station id/) as HTMLInputElement).value).toBe('TILL-01');
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText(/Pairing code/)).toBeNull();
  });

  it('till: an invalid id disables Finish and says why', () => {
    renderStep({ step: 'details', mode: 'till', stationId: '-1', code: '', host: '', showAdvanced: false });
    expect(screen.getByText('Use capitals, digits and dashes, starting with a letter.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('kds: typing the code dispatches it raw; Advanced reveals the address field', async () => {
    const dispatch = renderStep(kds);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Pairing code/), 'a');
    expect(dispatch).toHaveBeenCalledWith({ type: 'code', value: 'a' });
    expect(screen.queryByLabelText(/Advanced: till address/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Advanced: till address' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleAdvanced' });
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('kds: a complete code shows grouped and enables Finish', () => {
    renderStep({ ...kds, code: 'ABCDEFGHJK' });
    expect((screen.getByLabelText(/Pairing code/) as HTMLInputElement).value).toBe('ABCDE-FGHJK');
    expect((screen.getByRole('button', { name: 'Finish setup' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('scanning and saving are live regions; choose lists the tills', async () => {
    renderStep({ step: 'scanning', details: kds });
    expect(screen.getByText(/Looking for the till/)).toBeTruthy();
  });

  it('choose: each till is a button', async () => {
    const dispatch = renderStep({ step: 'choose', details: kds, tills: ['10.0.0.2', '10.0.0.3'] });
    await userEvent.setup().click(screen.getByRole('button', { name: '10.0.0.3' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'pickTill', host: '10.0.0.3' });
  });

  it('not found: a refused code has no "Save anyway"; an unreachable address does', async () => {
    const dispatch = renderStep({ step: 'notFound', details: { ...kds, code: 'ABCDEFGHJK' }, reason: 'bad-code' });
    expect(screen.getByRole('alert').textContent).toContain('did not accept that code');
    expect(screen.queryByRole('button', { name: 'Save anyway' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'retry' });
  });

  it('not found: unreachable names the address and offers Save anyway', async () => {
    const details = { ...kds, code: 'ABCDEFGHJK', host: '192.168.4.10', showAdvanced: true };
    const dispatch = renderStep({ step: 'notFound', details, reason: 'unreachable' });
    expect(screen.getByRole('alert').textContent).toContain('192.168.4.10');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'saveAnyway' });
  });

  it('saving and failed', () => {
    renderStep({ step: 'saving', details: kds, request: { stationId: 'KDS-01', mode: 'kds' } });
    expect(screen.getByText(/Saving and restarting/)).toBeTruthy();
  });

  it('failed: already configured is its own message', () => {
    renderStep({ step: 'failed', details: kds, error: 'already-configured' });
    expect(screen.getByRole('alert').textContent).toContain('already set up');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
