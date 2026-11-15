/**
 * The drawer's free mode opens and deletes the person's own saved free chats
 * (2026-11-12): on a shared till they used to pile up where only the owner's
 * /assistant page could reach them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { freeChatsKey, resetFreeChatsMemory, serialiseFreeChats, useFreeChats, type FreeChat } from './freeChats';

const h = vi.hoisted(() => ({ staff: { id: 'u1', role: 'cashier' } as { id: string; role: string } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: h.staff, session: { user: { id: h.staff.id } } }),
}));
// The thread itself has its own tests: here it only says which saved chat is open.
vi.mock('./FreeThread', () => ({
  FreeThread: () => {
    const free = useFreeChats(h.staff.id);
    return <div data-testid="free-thread">{free.active?.title ?? 'new'}</div>;
  },
}));

import { AssistantDrawer, AssistantDrawerProvider, useAssistantDrawer } from './AssistantDrawer';

function Opener() {
  const d = useAssistantDrawer();
  useEffect(() => d.openDrawer(), [d]);
  return null;
}

const chat = (id: string, title: string, at: number): FreeChat => ({ id, title, updatedAt: at, exchanges: [{ id: `${id}-e`, question: title, answer: 'Open /till.', done: true, stopped: false, error: null }] });

beforeEach(() => {
  resetFreeChatsMemory();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(freeChatsKey('u1'), serialiseFreeChats('u1', [chat('c2', 'How do I split a bill?', Date.now()), chat('c1', 'Where are my tasks?', Date.now() - 1000)]));
});
afterEach(() => cleanup());

function renderDrawer() {
  render(
    <LocaleProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AssistantDrawerProvider>
            <Opener />
            <AssistantDrawer />
          </AssistantDrawerProvider>
        </ConfirmProvider>
      </ToastProvider>
    </LocaleProvider>,
  );
}

describe('the drawer’s free chats', () => {
  it('lists this person’s saved chats, opens one, and goes back to the thread', async () => {
    renderDrawer();
    expect(await screen.findByTestId('free-thread')).toBeTruthy();
    fireEvent.click(screen.getByTestId('assistant.free.chats'));
    const list = document.querySelector('[data-free-chats]')!;
    expect(within(list as HTMLElement).getByText('How do I split a bill?')).toBeTruthy();
    fireEvent.click(within(list as HTMLElement).getByText('Where are my tasks?'));
    expect(screen.getByTestId('free-thread').textContent).toBe('Where are my tasks?');
    expect(document.querySelector('[data-free-chats]')).toBeNull();
  });

  it('deletes one after asking, and starts a new chat from the list', async () => {
    renderDrawer();
    await screen.findByTestId('free-thread');
    fireEvent.click(screen.getByTestId('assistant.free.chats'));
    const row = document.querySelector('[data-conversation="c1"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    // The confirm dialog: its own Delete.
    const dialog = await screen.findByRole('dialog', { name: /Delete this chat/ });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() => expect(document.querySelector('[data-conversation="c1"]')).toBeNull());
    expect(document.querySelector('[data-conversation="c2"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('assistant.free.chats.new'));
    expect(screen.getByTestId('free-thread').textContent).toBe('new');
  });
});
