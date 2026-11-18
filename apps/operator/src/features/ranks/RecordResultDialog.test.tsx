import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// 0364: Record a result from a booking. The booker is already on side A; an opponent is found
// with the desk's customer search; the score is built from the set boxes ("6-4, 7-5"), never
// typed; Record result sends ranks_desk_record with that booking.

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { RecordResultDialog } from './RecordResultDialog';

const rpc = vi.mocked(appRpc);

function mount(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <RecordResultDialog reservationId="r1" booker={{ id: 'p1', name: 'Ali Hassan' }} onClose={onClose} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe('RecordResultDialog', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'customer_search') {
        return [{ id: 'p3', full_name: 'Omar Saleh', phone: '07700000003', email: null, preferred_lang: 'ar', flags: [], counts: {} }];
      }
      if (fn === 'ranks_desk_record') return { id: 'g1', status: 'confirmed' };
      throw new Error(`unexpected ${fn}`);
    });
  });

  it('records the booking with the booker on side A, the picked opponent and the built score', async () => {
    const onClose = mount();
    expect(screen.getByTestId('ranks-seat-a1-name').textContent).toBe('Ali Hassan');

    // Nothing is sent while a side is empty or nobody won.
    await userEvent.click(screen.getByTestId('ranks-record-submit'));
    expect(screen.getByTestId('ranks-record-errors').textContent).toContain('Each side needs at least one player.');
    expect(rpc).not.toHaveBeenCalledWith('ranks_desk_record', expect.anything());

    const seatB = screen.getByTestId('ranks-seat-b1');
    await userEvent.type(seatB.querySelector('input')!, 'Omar');
    await userEvent.click(await screen.findByRole('option', { name: /Omar Saleh/ }));
    await userEvent.click(screen.getByTestId('ranks-winner-a'));
    await userEvent.type(screen.getByTestId('ranks-set-1-a'), '6');
    await userEvent.type(screen.getByTestId('ranks-set-1-b'), '4');
    await userEvent.type(screen.getByTestId('ranks-set-2-a'), '7');
    await userEvent.type(screen.getByTestId('ranks-set-2-b'), '5');
    await userEvent.click(screen.getByTestId('ranks-record-submit'));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('ranks_desk_record', {
        p_reservation_id: 'r1',
        p_a1: 'p1',
        p_a2: null,
        p_b1: 'p3',
        p_b2: null,
        p_winner: 'a',
        p_score: '6-4, 7-5',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refuses a half-filled set instead of sending a score', async () => {
    mount();
    const seatB = screen.getByTestId('ranks-seat-b1');
    await userEvent.type(seatB.querySelector('input')!, 'Omar');
    await userEvent.click(await screen.findByRole('option', { name: /Omar Saleh/ }));
    await userEvent.click(screen.getByTestId('ranks-winner-b'));
    await userEvent.type(screen.getByTestId('ranks-set-1-a'), '6');
    await userEvent.click(screen.getByTestId('ranks-record-submit'));
    expect(screen.getByTestId('ranks-record-errors').textContent).toContain('Fill both sides of a set');
    expect(rpc).not.toHaveBeenCalledWith('ranks_desk_record', expect.anything());
  });

  it('corrects a result: starts from it, asks for a reason, sends ranks_edit_result', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'ranks_edit_result') return { id: 'g9', status: 'confirmed', replaces: 'g1' };
      throw new Error(`unexpected ${fn}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const p = (id: string, name: string) => ({ id, name, username: null, former: false });
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <ToastProvider>
            <RecordResultDialog
              edit={{
                id: 'g1',
                source: 'player',
                status: 'pending',
                winner: 'b',
                score: '4-6',
                played_at: '2026-11-15T18:00:00Z',
                reported_at: '2026-11-15T19:30:00Z',
                reservation_id: 'r1',
                void_reason: null,
                court: null,
                a: [p('p1', 'Ali Hassan'), null],
                b: [p('p3', 'Omar Saleh'), null],
              }}
              onClose={onClose}
            />
          </ToastProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Edit this result')).toBeTruthy();
    expect(screen.getByTestId('ranks-seat-b1-name').textContent).toBe('Omar Saleh');
    expect((screen.getByTestId('ranks-set-1-a') as HTMLInputElement).value).toBe('4');

    await userEvent.click(screen.getByTestId('ranks-winner-a'));
    await userEvent.clear(screen.getByTestId('ranks-set-1-a'));
    await userEvent.type(screen.getByTestId('ranks-set-1-a'), '6');
    await userEvent.clear(screen.getByTestId('ranks-set-1-b'));
    await userEvent.type(screen.getByTestId('ranks-set-1-b'), '4');
    // No reason yet: nothing is sent.
    await userEvent.click(screen.getByTestId('ranks-record-submit'));
    expect(screen.getByText('Write a reason of at least 3 characters.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    await userEvent.type(screen.getByTestId('ranks-edit-reason'), 'Sides swapped');
    await userEvent.click(screen.getByTestId('ranks-record-submit'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('ranks_edit_result', {
        p_result_id: 'g1',
        p_a1: 'p1',
        p_a2: null,
        p_b1: 'p3',
        p_b2: null,
        p_winner: 'a',
        p_score: '6-4',
        p_reason: 'Sides swapped',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
