import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { KitchenDisplayScreen, type KitchenDisplayScreenProps } from './KitchenDisplayScreen';
import type { TicketView } from './ticketView';

// The wall board is operated from a keyboard on a shelf under the screen: no
// pointer, no navigation. These tests drive it exactly that way.

const NOW = Date.parse('2026-09-03T10:00:00Z');

function ticket(over: Partial<TicketView> = {}): TicketView {
  return {
    id: 't1',
    status: 'queued',
    source: 'web',
    tag: { kind: 'table', number: '9' },
    createdAt: new Date(NOW - 60_000).toISOString(),
    ageSeconds: 60,
    targetSeconds: 600,
    ageState: 'fresh',
    stale: false,
    actorLabel: null,
    items: [
      { id: 'i1', qty: 1, name: 'Espresso', variant: 'Regular', modifiers: ['Extra shot'], notes: 'no sugar', ready: false },
      { id: 'i2', qty: 2, name: 'Karak', variant: null, modifiers: [], notes: null, ready: true },
    ],
    canMarkItems: true,
    ...over,
  };
}

function renderScreen(over: Partial<KitchenDisplayScreenProps> = {}) {
  const props: KitchenDisplayScreenProps = {
    status: 'ready',
    tickets: [
      ticket(),
      ticket({
        id: 't2',
        status: 'ready',
        source: 'till',
        tag: { kind: 'court', guest: 'Ahmed' },
        ageSeconds: 700,
        ageState: 'late',
        items: [{ id: 'i3', qty: 1, name: 'Club sandwich', variant: null, modifiers: [], notes: null, ready: false }],
      }),
    ],
    connection: 'live',
    staleCount: 0,
    nowMs: NOW,
    degraded: false,
    onStatus: vi.fn(),
    onItemReady: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  };
  render(
    <LocaleProvider>
      <KitchenDisplayScreen {...props} />
    </LocaleProvider>,
  );
  return props;
}

describe('KitchenDisplayScreen states', () => {
  it('loading: a dark skeleton, no list, the legend still on screen', () => {
    renderScreen({ status: 'loading', tickets: [] });
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByTestId('key-legend')).toBeTruthy();
  });

  it('ready: one list in arrival order, each card tagged with source and table or court', () => {
    renderScreen();
    const cards = screen.getAllByTestId('ticket-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('Table 9')).toBeTruthy();
    expect(within(cards[0]!).getByText('Website')).toBeTruthy();
    expect(within(cards[0]!).getByText('On time')).toBeTruthy();
    expect(within(cards[1]!).getByText('Till')).toBeTruthy();
    expect(within(cards[1]!).getByText('Late')).toBeTruthy();
    expect(within(cards[1]!).getByText('Ahmed')).toBeTruthy();
    // Modifiers and notes are on the line; the checkbox is named by its line (e2e anchor).
    expect(screen.getByRole('checkbox', { name: /Espresso/ })).toBeTruthy();
    expect(within(cards[0]!).getByText('Extra shot')).toBeTruthy();
    expect(within(cards[0]!).getByText('no sugar')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /Karak/ }) as HTMLInputElement).checked).toBe(true);
    // Header: open count, clock and the live pill — nothing else.
    expect(screen.getByTestId('open-count').textContent).toBe('2 open');
    expect(screen.getByTestId('connection-pill').getAttribute('data-status')).toBe('live');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('empty: says so in kitchen-size type', () => {
    renderScreen({ status: 'empty', tickets: [] });
    expect(screen.getByText('No active tickets — all caught up')).toBeTruthy();
  });

  it('error: names the failure and retries', async () => {
    const user = userEvent.setup();
    const props = renderScreen({ status: 'error', tickets: [], error: new Error('boom') });
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText('The ticket queue could not be loaded')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('degraded: the LAN notice shows and item marks are off', () => {
    renderScreen({ degraded: true, tickets: [ticket({ canMarkItems: false })] });
    expect(screen.getByText(/arriving from the till over the local network/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Item marks return when the connection is back.')).toBeTruthy();
  });

  it('stale: the banner the e2e suite reads, and the card carries data-stale', () => {
    renderScreen({ staleCount: 2, tickets: [ticket({ stale: true })] });
    const banner = screen.getByTestId('stale-banner');
    expect(banner.textContent).toContain('⚠');
    expect(banner.textContent).toContain('2 tickets need attention');
    expect(screen.getByTestId('ticket-card').getAttribute('data-stale')).toBe('true');
    expect(screen.getByText('Waiting too long')).toBeTruthy();
  });
});

describe('KitchenDisplayScreen keyboard (spec R11)', () => {
  it('digit selects a ticket with a visible focus, S starts it, arrows + Space mark a line', async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    const cards = screen.getAllByTestId('ticket-card');

    await user.keyboard('1');
    expect(cards[0]!.getAttribute('data-selected')).toBe('true');
    expect(document.activeElement).toBe(cards[0]);

    await user.keyboard('s');
    expect(props.onStatus).toHaveBeenCalledWith('t1', 'preparing');

    // C is not a legal move for a queued ticket — nothing fires.
    await user.keyboard('c');
    expect(props.onStatus).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');
    expect(props.onItemReady).toHaveBeenCalledWith('t1', 'i1', true);
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');
    expect(props.onItemReady).toHaveBeenCalledWith('t1', 'i2', false);
  });

  it('arrow keys move between tickets; R and C follow the lifecycle; Esc clears', async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    const cards = screen.getAllByTestId('ticket-card');

    await user.keyboard('{ArrowRight}');
    expect(cards[0]!.getAttribute('data-selected')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(cards[1]!.getAttribute('data-selected')).toBe('true');
    expect(cards[0]!.getAttribute('data-selected')).toBeNull();

    await user.keyboard('c');
    expect(props.onStatus).toHaveBeenCalledWith('t2', 'completed');
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('r');
    expect(props.onStatus).toHaveBeenCalledWith('t1', 'ready');

    await user.keyboard('{Escape}');
    expect(cards.every((c) => c.getAttribute('data-selected') === null)).toBe(true);
  });

  it('the on-screen buttons carry the same keys and still work by pointer', async () => {
    const user = userEvent.setup();
    const props = renderScreen();
    const first = screen.getAllByTestId('ticket-card')[0]!;
    await user.click(within(first).getByRole('button', { name: /Start/ }));
    expect(props.onStatus).toHaveBeenCalledWith('t1', 'preparing');
    await user.click(screen.getByRole('checkbox', { name: /Espresso/ }));
    expect(props.onItemReady).toHaveBeenCalledWith('t1', 'i1', true);
  });
});
