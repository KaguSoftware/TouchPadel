import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import type { DiagnoseResponse } from './diagnoseTypes';

// The panel exists because "chat not found" said nothing about WHICH part was
// wrong. It must name each failing check, and offer the one-click fixes.

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../lib/edge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callEdge: vi.fn(),
}));

import { callEdge } from '../../../lib/edge';
import { DiagnosePanel } from './DiagnosePanel';

const edge = vi.mocked(callEdge);

const PLACEHOLDER: DiagnoseResponse = {
  bot: { username: 'touchcafe_orders_bot' },
  webhookUrl: 'https://ref.supabase.co/functions/v1/telegram-callback',
  checks: [
    { id: 'token', status: 'ok', code: 'TOKEN_SET' },
    { id: 'bot', status: 'ok', code: 'BOT_OK', params: { username: 'touchcafe_orders_bot' } },
    { id: 'settings', status: 'fail', code: 'CHAT_ID_PLACEHOLDER', params: { chatId: '-1001234567890' } },
    { id: 'chat', status: 'fail', code: 'CHAT_NOT_FOUND' },
    { id: 'membership', status: 'skip', code: 'SKIPPED' },
    { id: 'webhook', status: 'warn', code: 'WEBHOOK_UPDATES', params: { allowed: 'callback_query' } },
    { id: 'outbox', status: 'fail', code: 'OUTBOX_FAILING', params: { error: 'HTTP 400: Bad Request: chat not found' } },
    { id: 'allowlist', status: 'ok', code: 'ALLOWLIST_OK', params: { count: 1 } },
  ],
};

function renderPanel(onUseChatId = vi.fn(async () => {})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <DiagnosePanel onUseChatId={onUseChatId} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onUseChatId };
}

const item = (id: string) => document.querySelector(`li[data-check="${id}"]`) as HTMLElement;

describe('DiagnosePanel', () => {
  beforeEach(() => edge.mockReset());

  it('runs nothing until asked, then lists every check with its sentence', async () => {
    edge.mockResolvedValue(PLACEHOLDER);
    renderPanel();
    expect(edge).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Run diagnosis' }));

    await waitFor(() => expect(item('settings')).toBeTruthy());
    expect(edge).toHaveBeenCalledWith('telegram-diagnose', { action: 'diagnose' }, { ttlMs: 0 });
    expect(document.querySelectorAll('li[data-check]')).toHaveLength(8);
    expect(item('settings').dataset.status).toBe('fail');
    expect(item('settings').textContent).toContain('is the example number, not a real group');
    expect(item('chat').textContent).toContain('Telegram does not know this chat for this bot');
    expect(item('membership').textContent).toContain('Not checked');
    expect(screen.queryByText('Everything checks out.')).toBeNull();
  });

  it('offers Re-register webhook for a fixable webhook state and re-runs afterwards', async () => {
    edge.mockResolvedValueOnce(PLACEHOLDER).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(PLACEHOLDER);
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Run diagnosis' }));
    await waitFor(() => expect(item('webhook')).toBeTruthy());

    await userEvent.click(within(item('webhook')).getByRole('button', { name: 'Re-register webhook' }));

    await waitFor(() => expect(edge).toHaveBeenCalledTimes(3));
    expect(edge.mock.calls[1]).toEqual(['telegram-diagnose', { action: 'register_webhook' }, { ttlMs: 0 }]);
    expect(edge.mock.calls[2]?.[1]).toEqual({ action: 'diagnose' });
  });

  it('a supergroup upgrade offers the new id', async () => {
    const migrated: DiagnoseResponse = {
      ...PLACEHOLDER,
      checks: [
        { id: 'chat', status: 'fail', code: 'CHAT_MIGRATED', newChatId: '-1002233445566', params: { newChatId: '-1002233445566' } },
      ],
    };
    edge.mockResolvedValue(migrated);
    const { onUseChatId } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Run diagnosis' }));
    await waitFor(() => expect(item('chat')).toBeTruthy());

    await userEvent.click(within(item('chat')).getByRole('button', { name: 'Use the new ID' }));
    expect(onUseChatId).toHaveBeenCalledWith('-1002233445566');
  });

  it('says so when every check is ok', async () => {
    edge.mockResolvedValue({
      ...PLACEHOLDER,
      checks: PLACEHOLDER.checks.map((c) => ({ ...c, status: 'ok' as const, code: 'TOKEN_SET' })),
    });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Run diagnosis' }));
    expect(await screen.findByText('Everything checks out.')).toBeTruthy();
  });

  it('an unknown code from a newer function still renders, as the raw code', async () => {
    edge.mockResolvedValue({ ...PLACEHOLDER, checks: [{ id: 'bot', status: 'warn', code: 'SOMETHING_NEW' }] });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Run diagnosis' }));
    await waitFor(() => expect(item('bot')).toBeTruthy());
    expect(item('bot').textContent).toContain('SOMETHING_NEW');
  });
});
