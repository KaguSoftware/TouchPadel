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
  models.mockResolvedValue({ default_model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'some-other-model'] });
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
    expect(venue.textContent).toContain('Opus 5.5');
    expect(venue.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Opus 5.5 · best answers' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sonnet 5.5 · about 2× cheaper' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'some-other-model' })).toBeTruthy();
    expect(screen.getByText('Applies to the next answer. Each answer’s meter shows the model that priced it.')).toBeTruthy();
  });

  it('saves a pick on an existing chat through setModel and reports it', async () => {
    save.mockResolvedValue({} as never);
    const { onChange } = renderSwitch();
    fireEvent.click(await screen.findByRole('button', { name: 'Sonnet 5.5 · about 2× cheaper' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', 'claude-sonnet-5-5'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('claude-sonnet-5-5'));
  });

  it('clears the override with null when the venue default is picked', async () => {
    save.mockResolvedValue({} as never);
    const { onChange } = renderSwitch({ value: 'claude-sonnet-5-5' });
    expect((await screen.findByRole('button', { name: 'Sonnet 5.5 · about 2× cheaper' })).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Venue default/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', null));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it('holds the choice locally for a chat that has no row yet', async () => {
    const { onChange } = renderSwitch({ conversationId: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Opus 5.5 · best answers' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('claude-opus-5-5'));
    expect(save).not.toHaveBeenCalled();
  });

  it('says in one sentence when the server refuses an unpriced model', async () => {
    save.mockRejectedValue(new AppRpcError('ASSISTANT_MODEL_NOT_PRICED', 'ASSISTANT_MODEL_NOT_PRICED'));
    renderSwitch();
    fireEvent.click(await screen.findByRole('button', { name: 'some-other-model' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That model has no rates in the pricing table, so it cannot be billed. Add its four rates first.');
  });

  it('offers The free AI after the models only when the parent allows it', async () => {
    renderSwitch();
    await screen.findByRole('button', { name: 'Opus 5.5 · best answers' });
    expect(screen.queryByTestId('model-__free__')).toBeNull();
  });

  it('switches to the free AI without saving anything on the chat', async () => {
    const onChooseFree = vi.fn();
    const { onChange } = renderSwitch({ onChooseFree });
    const free = await screen.findByTestId('model-__free__');
    expect(free.textContent).toBe("The free AI · finds pages, explains how things work, can't see your data");
    fireEvent.click(free);
    expect(onChooseFree).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables every button while streaming', async () => {
    renderSwitch({ disabled: true });
    const btn = await screen.findByRole('button', { name: 'Opus 5.5 · best answers' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ModelSwitch compact (the chat toolbar)', () => {
  it('shows short names, presses the venue default when the chat names none, and saves another pick', async () => {
    save.mockResolvedValue({} as never);
    const { onChange } = renderSwitch({ compact: true, onChooseFree: vi.fn() });
    const opus = await screen.findByTestId('model-claude-opus-5-5');
    // The kit's segmented control: its label (and a hidden bold twin that holds the width).
    expect(opus.className).toBe('tp-seg-btn');
    expect(opus.textContent).toMatch(/^Opus 5\.5/);
    expect(opus.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Venue default/ })).toBeNull();
    // Apart from the Claude pair, with its own "Free" tag.
    expect(screen.getByTestId('model-__free__').textContent).toBe('Free AIFree');
    expect(screen.getByRole('group', { name: 'Claude models' }).contains(screen.getByTestId('model-__free__'))).toBe(false);

    fireEvent.click(opus);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('model-claude-sonnet-5-5'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', 'claude-sonnet-5-5'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('claude-sonnet-5-5'));
  });
});
