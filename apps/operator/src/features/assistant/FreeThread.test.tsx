import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';
import { EdgeError } from '../../lib/edge';
import { resetModeMemory } from './mode';
import { FREE_CHATS_KEY, resetFreeChatsMemory } from './freeChats';

// The free thread asks the router which paths are pages, and auth who is asking.
const h = vi.hoisted(() => ({
  staff: { id: 'u1', role: 'cashier' } as { id: string; role: string },
  navigate: vi.fn(async () => {}),
  stream: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ routesByPath: { '/till': {}, '/tasks': {}, '/admin/staff': {}, '/assistant': {} }, navigate: h.navigate }),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: '/till' } }),
}));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: h.staff }),
}));
vi.mock('../../lib/edge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  streamEdge: (...args: unknown[]) => h.stream(...args),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchModels: async () => ({ default_model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] }),
}));

import { FreeThread } from './FreeThread';
import { takePendingNewChatModel, takePendingQuestion } from './ModelSwitch';

function renderThread(onNavigate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <FreeThread onNavigate={onNavigate} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onNavigate };
}

/** A stream that answers `text` in two deltas. */
function answers(text: string) {
  h.stream.mockImplementation(async (_fn: string, _body: unknown, opts: { onEvent: (n: string, d: unknown) => void }) => {
    opts.onEvent('message_start', { model: 'groq', free: true });
    opts.onEvent('delta', { text: text.slice(0, 5) });
    opts.onEvent('delta', { text: text.slice(5) });
    opts.onEvent('done', { stop_reason: 'end_turn' });
  });
}

describe('FreeThread', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetModeMemory();
    resetFreeChatsMemory();
    h.staff = { id: 'u1', role: 'cashier' };
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('says what it is, offers three starters and no paid option to staff', () => {
    renderThread();
    expect(screen.getByText(/It can't see sales, bookings or any other data/)).toBeTruthy();
    expect(screen.getByTestId('assistant.free.starter.tasks')).toBeTruthy();
    expect(screen.getByTestId('assistant.free.starter.break')).toBeTruthy();
    expect(screen.getByTestId('assistant.free.starter.incident')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.queryByTestId('assistant.free.usePaid')).toBeNull();
  });

  it('asks assistant-free with the route and history, and links only pages this person may open', async () => {
    answers('Open /tasks for your list; the owner sets staff on /admin/staff.');
    const { onNavigate } = renderThread();
    fireEvent.click(screen.getByTestId('assistant.free.starter.tasks'));
    await screen.findByText(/Open \/tasks for your list/);

    const [fn, body] = h.stream.mock.calls[0]!;
    expect(fn).toBe('assistant-free');
    expect(body).toEqual({ text: 'Where do I see my tasks?', lang: 'en', app: 'operator', route: '/till', history: [] });

    // A cashier may open /tasks, not the owner's /admin/staff.
    expect(screen.getByTestId('assistant.free.goto./tasks')).toBeTruthy();
    expect(screen.queryByTestId('assistant.free.goto./admin/staff')).toBeNull();
    fireEvent.click(screen.getByTestId('assistant.free.goto./tasks'));
    expect(h.navigate).toHaveBeenCalledWith({ to: '/tasks' });
    expect(onNavigate).toHaveBeenCalled();

    // The next question carries the finished turn; the chat is saved on this computer.
    answers('Press Go on break in the rail.');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'and a break?' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText('Press Go on break in the rail.');
    expect((h.stream.mock.calls[1]![1] as { history: unknown[] }).history).toEqual([
      { role: 'user', text: 'Where do I see my tasks?' },
      { role: 'assistant', text: 'Open /tasks for your list; the owner sets staff on /admin/staff.' },
    ]);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(FREE_CHATS_KEY)!).chats[0].exchanges).toHaveLength(2));
  });

  it("gives the owner the owner's links, and Free AI is just a pressed model: Sonnet goes back to paid on Sonnet", async () => {
    h.staff = { id: 'o1', role: 'owner' };
    answers('Staff accounts are on /admin/staff.');
    renderThread();
    expect(screen.queryByTestId('assistant.free.usePaid')).toBeNull();
    fireEvent.click(screen.getByTestId('assistant.free.starter.incident'));
    await screen.findByTestId('assistant.free.goto./admin/staff');

    fireEvent.click(screen.getByTestId('assistant-model'));
    expect(screen.getByTestId('model-__free__').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(await screen.findByTestId('model-claude-sonnet-5-5'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('touch-assistant-mode-v1')!)).toEqual({ owner: 'o1', mode: 'paid' }));
    expect(takePendingNewChatModel()).toBe('claude-sonnet-5-5');
  });

  it('hands a question the guide cannot answer to the paid assistant, typed, not sent', async () => {
    h.staff = { id: 'o1', role: 'owner' };
    answers("I can't see any of the club's data. Takings are on the Revenue report.");
    renderThread();
    fireEvent.click(screen.getByTestId('assistant.free.starter.break'));
    fireEvent.click(await screen.findByTestId('assistant.free.askPaid'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('touch-assistant-mode-v1')!)).toEqual({ owner: 'o1', mode: 'paid' }));
    expect(takePendingQuestion()).toBe('How do I take a break?');
  });

  it('offers staff no paid hand-off', async () => {
    answers("I can't see any of the club's data.");
    renderThread();
    fireEvent.click(screen.getByTestId('assistant.free.starter.break'));
    await screen.findByText("I can't see any of the club's data.");
    expect(screen.queryByTestId('assistant.free.askPaid')).toBeNull();
  });

  it('says how long to wait after a per-minute refusal, and retries', async () => {
    h.stream.mockRejectedValueOnce(new EdgeError(429, 'RATE_LIMITED', 'x', 'RATE_LIMITED', { scope: 'minute', retry_after_s: 20 }));
    renderThread();
    fireEvent.click(screen.getByTestId('assistant.free.starter.break'));
    expect((await screen.findByRole('alert')).textContent).toContain("You've asked a lot in a minute; try again in");
    expect(screen.getByRole('alert').textContent).toContain('20');
    answers('Use Go on break.');
    fireEvent.click(screen.getByTestId('assistant.free.retry'));
    await screen.findByText('Use Go on break.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers no retry once the day is used up', async () => {
    h.stream.mockRejectedValueOnce(new EdgeError(429, 'RATE_LIMITED', 'x', 'RATE_LIMITED', { scope: 'day', retry_after_s: 3600 }));
    renderThread();
    fireEvent.click(screen.getByTestId('assistant.free.starter.break'));
    expect((await screen.findByRole('alert')).textContent).toContain("Today's free questions are used up");
    expect(screen.queryByTestId('assistant.free.retry')).toBeNull();
  });
});
