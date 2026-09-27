import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import type { TelegramChatRow } from './DetectedGroups';

// Picking the group from this list replaces reading an id out of getUpdates —
// the step that put the placeholder id in reach in the first place.

const rows: { current: TelegramChatRow[] } = { current: [] };

vi.mock('../../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows.current, error: null }),
  };
  return { supabase: { from: () => chain }, supabaseUrl: '', supabaseAnonKey: '' };
});

import { DetectedGroups } from './DetectedGroups';

function renderList(currentChatId: string | null, onUse = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <DetectedGroups currentChatId={currentChatId} onUse={onUse} busy={false} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onUse };
}

const row = (over: Partial<TelegramChatRow>): TelegramChatRow => ({
  chat_id: '-5203171937',
  title: 'Touch Cafe — Orders',
  type: 'group',
  bot_status: 'member',
  updated_at: '2026-09-13T18:00:00Z',
  ...over,
});

const li = (chatId: string) => document.querySelector(`li[data-chat="${chatId}"]`) as HTMLElement;

describe('DetectedGroups', () => {
  beforeEach(() => {
    rows.current = [];
  });

  it('explains how to make a group appear when there is none', async () => {
    renderList(null);
    expect(await screen.findByText('No groups yet')).toBeTruthy();
  });

  it('Use this group hands the id up; the saved group reads In use; a removed bot cannot be picked', async () => {
    rows.current = [
      row({}),
      row({ chat_id: '-1001234567891', title: 'Old group', bot_status: 'left' }),
      row({ chat_id: '-1002233445566', title: 'Kitchen', type: 'supergroup', bot_status: 'administrator' }),
    ];
    const { onUse } = renderList('-1002233445566');

    await waitFor(() => expect(li('-5203171937')).toBeTruthy());
    expect(within(li('-1002233445566')).getByText('In use')).toBeTruthy();
    expect(within(li('-1001234567891')).getByText('Bot removed')).toBeTruthy();
    expect(within(li('-1001234567891')).queryByRole('button')).toBeNull();

    await userEvent.click(within(li('-5203171937')).getByRole('button', { name: 'Use this group' }));
    expect(onUse).toHaveBeenCalledWith('-5203171937');
  });
});
