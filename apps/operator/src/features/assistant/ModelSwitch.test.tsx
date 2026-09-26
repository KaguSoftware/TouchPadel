import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { ToastProvider } from '../../components/toast';
import { ModelSwitch } from './ModelSwitch';

// The switch reads the priced models and writes the chat's choice through
// the data layer; the supabase client is not mounted in a unit test.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchModels: vi.fn(),
  setModel: vi.fn(),
}));

import { fetchModels, setModel } from './api';

const models = vi.mocked(fetchModels);
const save = vi.mocked(setModel);

function renderSwitch(props: Partial<Parameters<typeof ModelSwitch>[0]> = {}) {
  models.mockResolvedValue({ default_model: 'claude-opus-5', models: ['claude-opus-5', 'claude-sonnet-5', 'some-other-model'] });
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ModelSwitch conversationId="c1" value={null} onChange={onChange} {...props} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onChange };
}

describe('ModelSwitch', () => {
  it('lists every priced model with a spoken label, unknown ids as-is, and the venue default first', async () => {
    renderSwitch();
    const venue = await screen.findByRole('button', { name: /^Venue default/ });
    expect(venue.textContent).toContain('Opus 5');
    expect(venue.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Opus 5 · best answers' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sonnet 5 · about 2.5× cheaper' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'some-other-model' })).toBeTruthy();
    expect(screen.getByText('Applies to the next answer. Each answer’s meter shows the model that priced it.')).toBeTruthy();
  });

  it('saves a pick on an existing chat through setModel and reports it', async () => {
    save.mockResolvedValue({} as never);
    const { onChange } = renderSwitch();
    fireEvent.click(await screen.findByRole('button', { name: 'Sonnet 5 · about 2.5× cheaper' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', 'claude-sonnet-5'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('claude-sonnet-5'));
  });

  it('clears the override with null when the venue default is picked', async () => {
    save.mockResolvedValue({} as never);
    const { onChange } = renderSwitch({ value: 'claude-sonnet-5' });
    expect((await screen.findByRole('button', { name: 'Sonnet 5 · about 2.5× cheaper' })).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Venue default/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', null));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it('holds the choice locally for a chat that has no row yet', async () => {
    const { onChange } = renderSwitch({ conversationId: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Opus 5 · best answers' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('claude-opus-5'));
    expect(save).not.toHaveBeenCalled();
  });

  it('says in one sentence when the server refuses an unpriced model', async () => {
    save.mockRejectedValue(new AppRpcError('ASSISTANT_MODEL_NOT_PRICED', 'ASSISTANT_MODEL_NOT_PRICED'));
    renderSwitch();
    fireEvent.click(await screen.findByRole('button', { name: 'some-other-model' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That model has no rates in the pricing table, so it cannot be billed. Add its four rates first.');
  });

  it('disables every button while streaming', async () => {
    renderSwitch({ disabled: true });
    const btn = await screen.findByRole('button', { name: 'Opus 5 · best answers' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
