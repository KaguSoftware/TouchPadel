import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { mutate } from '../../lib/mutate';
import { KdsBoard } from './KdsBoard';
import type { TicketRow } from './ticketView';

// The container: a real query client over a mocked table read, the single
// write path mocked at `mutate()`. The alarms hook is stubbed so no realtime
// channel or WebAudio is touched.

// The "server": the read returns whatever the last write left behind.
let serverRows: TicketRow[] = [];
const rows: TicketRow[] = [
  {
    id: 't1',
    status: 'queued',
    target_seconds: 600,
    created_at: new Date(Date.now() - 30_000).toISOString(),
    completed_at: null,
    last_actor_label: null,
    order: {
      id: 'o1',
      source: 'guest_web',
      status: 'sent',
      tab: { id: 'tab1', label: null, table: { table_number: '9' }, reservation: null },
      order_items: [
        {
          id: 'i1',
          qty: 1,
          notes: null,
          voided: false,
          ready_at: null,
          menu_item: { name_en: 'Espresso', name_ar: 'إسبريسو' },
          variant: { name_en: 'Regular', name_ar: 'عادي' },
          order_item_modifiers: [],
        },
      ],
    },
  },
];

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        or: () => ({
          order: async () => ({ data: serverRows, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock('../../lib/mutate', () => ({
  mutate: vi.fn(async (_type: string, payload: { ticketId: string; status: TicketRow['status'] }) => {
    serverRows = serverRows.map((r) => (r.id === payload.ticketId ? { ...r, status: payload.status } : r));
    return { queued: false, localId: '', idempotencyKey: '', result: null };
  }),
  isElectron: () => false,
}));
vi.mock('../../lib/appRpc', () => ({ appRpc: vi.fn(async () => null) }));
vi.mock('./useKdsAlarms', () => ({
  useKdsAlarms: () => ({ stale: new Set<string>(), unseen: 0, status: 'live' }),
}));

function renderBoard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <KdsBoard />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  serverRows = rows;
  vi.mocked(mutate).mockClear();
  // The browser-mode bridge mock warns on every cache miss; expected here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('KdsBoard', () => {
  it('loads the queue, then 1 + S sends ticket.status through mutate() and moves the card optimistically', async () => {
    const user = userEvent.setup();
    renderBoard();
    expect(await screen.findByText('Table 9')).toBeTruthy();
    expect(screen.getByTestId('connection-pill').getAttribute('data-status')).toBe('live');

    await user.keyboard('1');
    await user.keyboard('s');
    expect(mutate).toHaveBeenCalledWith('ticket.status', { ticketId: 't1', status: 'preparing' });
    // Optimistic: the card is already "Preparing" before the server answers.
    expect(await screen.findByText('Preparing')).toBeTruthy();
    expect(screen.getByTestId('ticket-card').getAttribute('data-status')).toBe('preparing');
  });
});
