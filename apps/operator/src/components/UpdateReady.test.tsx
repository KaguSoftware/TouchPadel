import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';
import { UpdateReadyControl } from './UpdateReady';

describe('UpdateReadyControl', () => {
  it('rail: names the version and installs on click', async () => {
    const onInstall = vi.fn();
    render(
      <LocaleProvider>
        <UpdateReadyControl variant="rail" version="0.2.0" onInstall={onInstall} />
      </LocaleProvider>,
    );
    const button = screen.getByRole('button', { name: /Update ready 0\.2\.0/ });
    expect(button.getAttribute('title')).toBe('Restart to update to 0.2.0');
    await userEvent.setup().click(button);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('pill: a status region with the same action', async () => {
    const onInstall = vi.fn();
    render(
      <LocaleProvider>
        <UpdateReadyControl variant="pill" version="0.2.0" onInstall={onInstall} />
      </LocaleProvider>,
    );
    expect(screen.getByRole('status').textContent).toContain('0.2.0');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update ready' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});
