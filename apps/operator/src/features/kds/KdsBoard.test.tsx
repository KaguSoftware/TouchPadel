import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { mutate } from '../../lib/mutate';
import { appRpc } from '../../lib/appRpc';
import { KdsBoard } from './KdsBoard';
import type { TicketRow } from './ticketView';
import type { WorkspaceKey } from '../../lib/workspaces';

// The container: a real query client over a mocked app.kitchen_board read,
// the single write path mocked at `mutate()`. The alarms hook is stubbed so no
// realtime channel or WebAudio is touched.

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

vi.mock('../../lib/mutate', () => ({
  mutate: vi.fn(async (_type: string, payload: { ticketId: string; status: TicketRow['status'] }) => {
    serverRows = serverRows.map((r) => (r.id === payload.ticketId ? { ...r, status: payload.status } : r));
    return { queued: false, localId: '', idempotencyKey: '', result: null };
  }),
  isElectron: () => false,
}));
vi.mock('../../lib/appRpc', () => ({
  appRpc: vi.fn(async (fn: string) => (fn === 'kitchen_board' ? { tickets: serverRows } : null)),
}));
vi.mock('./useKdsAlarms', () => ({
  useKdsAlarms: () => ({ stale: new Set<string>(), unseen: 0, status: 'live' }),
}));

// The exit button's two collaborators: the router and the shell's workspace
// context. Mocked rather than mounted because the whole point of the control
// is which workspace it leaves the shell in, and that is a call, not a render.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
let workspaceCtx: { active: WorkspaceKey; available: readonly WorkspaceKey[]; setActive: (k: WorkspaceKey) => void } | null =
  null;
vi.mock('../../routes/__root', () => ({ useWorkspaceOrNull: () => workspaceCtx }));

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
  workspaceCtx = null;
  navigate.mockClear();
  vi.mocked(mutate).mockClear();
  vi.mocked(appRpc).mockClear();
  // The browser-mode bridge mock warns on every cache miss; expected here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('KdsBoard', () => {
  it('loads the queue, then 1 + S sends ticket.status through mutate() and moves the card optimistically', async () => {
    const user = userEvent.setup();
    renderBoard();
    expect(await screen.findByText('Table 9')).toBeTruthy();
    expect(screen.getByTestId('connection-pill').getAttribute('data-status')).toBe('live');
    // The venue and nothing else: the completed window is the server's.
    expect(appRpc).toHaveBeenCalledWith('kitchen_board', { p_venue_id: null });

    await user.keyboard('1');
    await user.keyboard('s');
    expect(mutate).toHaveBeenCalledWith('ticket.status', { ticketId: 't1', status: 'preparing' });
    // Optimistic: the card is already "Preparing" before the server answers.
    expect(await screen.findByText('Preparing')).toBeTruthy();
    expect(screen.getByTestId('ticket-card').getAttribute('data-status')).toBe('preparing');
  });
});

describe('KdsBoard exit', () => {
  const setActive = vi.fn();

  beforeEach(() => setActive.mockClear());

  it('a prep-only station gets no exit control at all', async () => {
    workspaceCtx = { active: 'prep', available: ['prep'], setActive };
    renderBoard();
    expect(await screen.findByText('Table 9')).toBeTruthy();
    expect(screen.queryByTestId('kds-exit')).toBeNull();
  });

  it('one other workspace: leaves the prep workspace AND lands on its home', async () => {
    workspaceCtx = { active: 'prep', available: ['prep', 'cashier'], setActive };
    renderBoard();
    await userEvent.click(await screen.findByTestId('kds-exit'));
    // Both halves matter. Navigating without setActive left the destination
    // rendering under [data-workspace='prep'] — the dark board theme, on a
    // light screen.
    expect(setActive).toHaveBeenCalledWith('cashier');
    expect(navigate).toHaveBeenCalledWith({ to: '/till' });
  });

  it('several: asks via the switcher, having already left prep for the account\u2019s own workspace', async () => {
    workspaceCtx = { active: 'prep', available: ['owner', 'manager', 'courtDesk', 'cashier', 'prep'], setActive };
    renderBoard();
    await userEvent.click(await screen.findByTestId('kds-exit'));
    // 'owner' because workspacesForRole puts the role's own workspace first,
    // so the switcher opens in the right palette with the right tile current.
    expect(setActive).toHaveBeenCalledWith('owner');
    expect(navigate).toHaveBeenCalledWith({ to: '/workspaces' });
  });
});
