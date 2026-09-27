import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// The staff suggestion box (#63): New, Seen and All from app.suggestions_page,
// signed with the author's name and role, and "Mark as seen".

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

let seen = false;
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'mark_suggestion_seen') {
      seen = true;
      return { seen_at: '2026-09-25T10:00:00Z' };
    }
    if (fn === 'suggestions_page') {
      const row = {
        id: 's1',
        author_name: 'Maha',
        author_role: 'cashier',
        body: 'Put a water cooler by court 2',
        created_at: '2026-09-25T09:00:00Z',
        seen_by_name: seen ? 'Omar' : null,
        seen_at: seen ? '2026-09-25T10:00:00Z' : null,
      };
      const rows = args.p_filter === 'new' ? (seen ? [] : [row]) : args.p_filter === 'seen' ? (seen ? [row] : []) : [row];
      return { suggestions: rows, new_count: seen ? 0 : 1, total: rows.length };
    }
    throw new Error(`unexpected ${fn}`);
  }),
}));

import { SuggestionsPageScreen } from './SuggestionsPage';

function renderPage(locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <SuggestionsPageScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  seen = false;
  calls.length = 0;
});

describe('SuggestionsPageScreen', () => {
  it('shows a new suggestion signed with its author and role, and marks it seen', async () => {
    renderPage();
    const item = await screen.findByTestId('suggestion-s1');
    expect(within(item).getByText('Maha')).toBeTruthy();
    expect(within(item).getByText('Cashier')).toBeTruthy();
    expect(within(item).getByText('Put a water cooler by court 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New (1)' })).toBeTruthy();
    await userEvent.click(within(item).getByRole('button', { name: 'Mark as seen' }));
    expect(calls.find((c) => c.fn === 'mark_suggestion_seen')?.args).toEqual({ p_id: 's1' });
    // The New tab empties with the badge's own read.
    expect(await screen.findByText('No new suggestions')).toBeTruthy();
  });

  it('shows who saw it on the Seen tab', async () => {
    seen = true;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Seen' }));
    // Names are isolated for bidi (FSI … PDI), so the match allows for them.
    expect(await screen.findByText(/Seen by .?Omar/)).toBeTruthy();
    expect(calls.some((c) => c.fn === 'suggestions_page' && c.args.p_filter === 'seen')).toBe(true);
  });

  it('reads in Arabic from the role pages lane', async () => {
    renderPage('ar');
    expect(screen.getByRole('heading', { level: 1, name: 'الاقتراحات' })).toBeTruthy();
    expect(await screen.findByText('كاشير')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'علِّم بأنه اطُّلع عليه' })).toBeTruthy();
  });
});
