import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { OpenTabsBoard, ageLabel, filterBoardRows, type BoardRow } from './OpenTabs';

const NOW = Date.parse('2026-09-03T12:00:00Z');

const rows: BoardRow[] = [
  {
    id: 'a',
    label: 'Table T8',
    table: 'T8',
    court: null,
    guest: null,
    status: 'open',
    openedAt: '2026-09-03T11:35:00Z',
    total: 8000,
    stamped: false,
    web: false,
    blocker: null,
  },
  {
    id: 'b',
    label: 'Ali',
    table: null,
    court: 'Court 1',
    guest: 'Ali',
    status: 'awaiting_payment',
    openedAt: '2026-09-03T09:50:00Z',
    total: 25000,
    stamped: false,
    web: true,
    blocker: 'settling',
  },
];

function renderBoard(over: Partial<Parameters<typeof OpenTabsBoard>[0]>) {
  const props: Parameters<typeof OpenTabsBoard>[0] = {
    status: 'ready',
    rows,
    filter: 'table',
    query: '',
    now: NOW,
    onFilter: vi.fn(),
    onQuery: vi.fn(),
    onSelect: vi.fn(),
    onMerge: vi.fn(),
    onOpenTab: vi.fn(),
    onRetry: vi.fn(),
    onRemoveTab: vi.fn(),
    onDismissRemoveError: vi.fn(),
    ...over,
  };
  render(
    <LocaleProvider>
      <OpenTabsBoard {...props} />
    </LocaleProvider>,
  );
  return props;
}

describe('OpenTabsBoard — four states', () => {
  it('loading: a skeleton, no table', () => {
    renderBoard({ status: 'loading', rows: [] });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Open tabs' })).toBeTruthy();
  });

  it('ready: every open tab with status, source, age and total', () => {
    renderBoard({});
    expect(screen.getByText('Table T8')).toBeTruthy();
    expect(screen.getByText('Ali')).toBeTruthy();
    expect(screen.getByText('Awaiting payment')).toBeTruthy();
    expect(screen.getByText('Web order')).toBeTruthy();
    expect(screen.getByText('25 min')).toBeTruthy();
    expect(screen.getByText('2 h 10 min')).toBeTruthy();
    expect(screen.getByText('8,000 IQD')).toBeTruthy();
  });

  it('empty: teaches the next action', async () => {
    const user = userEvent.setup();
    const props = renderBoard({ status: 'empty', rows: [] });
    expect(screen.getByText('No open tabs on the floor.')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Open tab' })[1]!);
    expect(props.onOpenTab).toHaveBeenCalled();
  });

  it('error: says so and retries', async () => {
    const user = userEvent.setup();
    const props = renderBoard({ status: 'error', rows: [], error: new TypeError('fetch failed') });
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText('This could not be loaded.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('selecting a row and merging emit the tab id', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(screen.getAllByRole('button', { name: 'Open on the till' })[0]!);
    expect(props.onSelect).toHaveBeenCalledWith('a');
    await user.click(screen.getAllByRole('button', { name: 'Merge tables' })[1]!);
    expect(props.onMerge).toHaveBeenCalledWith('b');
  });

  it('a filter with no matches keeps the table and says so', () => {
    renderBoard({ query: 'zzz' });
    expect(screen.getByText('No open tabs match this filter.')).toBeTruthy();
  });
});

describe('removing an empty tab from the status badge', () => {
  /** The badge doubles as the control, so it is addressed by its status text. */
  const badge = (name: RegExp) => screen.getByRole('button', { name });

  it('arms on the first press, then asks WHY before it emits the id', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull();

    await user.click(badge(/^Open —/));
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    // The confirm opens the reason picker; nothing has been removed yet.
    expect(props.onRemoveTab).not.toHaveBeenCalled();
    expect(screen.getByText('Reason required')).toBeTruthy();
    // …and it names what is about to happen to THIS tab.
    expect(screen.getByText(/Table T8 will be closed as cancelled/)).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: 'Duplicate entry' }));
    await user.type(screen.getByLabelText('Note (optional)'), 'opened on the wrong table');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onRemoveTab).toHaveBeenCalledOnce();
    expect(props.onRemoveTab).toHaveBeenCalledWith('a', 'duplicate: opened on the wrong table');
  });

  it('the reason is the code alone when no note is typed', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(badge(/^Open —/));
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onRemoveTab).toHaveBeenCalledWith('a', 'staff_error');
  });

  it('backing out of the reason keeps the tab and the confirm', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(badge(/^Open —/));
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Reason required')).toBeNull();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeTruthy();
  });

  it('does not remove anything until the confirm is pressed', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(badge(/^Open —/));
    expect(screen.getByText('Remove?')).toBeTruthy();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
    // …and 'Keep' backs out without touching the tab.
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
  });

  it('arming the row does not also open it on the till', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(badge(/^Open —/));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('a tab with money on it is refused in place, with no confirm offered', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(badge(/^Awaiting payment —/));
    expect(screen.getByText('This tab is being settled — finish taking the payment instead.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
  });

  it('names the thing that actually holds the tab, one sentence per cause', async () => {
    // The whole set used to collapse into "a payment is to be made", which is
    // wrong for four of the five and sends the cashier after money that is not
    // owed.
    const user = userEvent.setup();
    const held: BoardRow[] = (['orders', 'adjustments', 'reservation'] as const).map((blocker, i) => ({
      ...rows[0]!,
      id: `held-${blocker}`,
      label: `Table H${i}`,
      table: `H${i}`,
      blocker,
    }));
    renderBoard({ rows: held });
    // Arm each in turn; each names its own cause and offers no confirm.
    const expected = [
      'Something has been ordered on this tab. Settle it, or void the lines first.',
      'A discount or charge is recorded on this tab. Settle it instead.',
      'This tab belongs to a booking, and the court fee is owed on it. Settle it instead.',
    ];
    const badges = screen.getAllByRole('button', { name: /^Open —/ });
    for (const [i, sentence] of expected.entries()) {
      await user.click(badges[i]!);
      expect(screen.getByText(sentence)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull();
    }
  });

  it('arming a second row disarms the first', async () => {
    const user = userEvent.setup();
    renderBoard({});
    await user.click(badge(/^Open —/));
    expect(screen.getByText('Remove?')).toBeTruthy();
    await user.click(badge(/^Awaiting payment —/));
    expect(screen.queryByText('Remove?')).toBeNull();
  });

  it('a server refusal lands on the row it belongs to', () => {
    // The board's rows are a cached read, so a tab can gain an order between
    // the render and the press; the answer must appear where the press was.
    renderBoard({ removeError: { id: 'a', error: new AppRpcError('TAB_NOT_EMPTY', 'TAB_NOT_EMPTY', undefined, 'orders') } });
    // …and it is the server's OWN branch that is named: `detail` says which of
    // the four guards fired, so the answer after the press matches the one the
    // board gives before it.
    expect(screen.getByText('Something has been ordered on this tab. Settle it, or void the lines first.')).toBeTruthy();
  });

  it('a refusal with no detail still says something true', () => {
    renderBoard({ removeError: { id: 'a', error: new AppRpcError('NO_OPEN_DAY', 'NO_OPEN_DAY') } });
    expect(screen.getByText('No business day is open.')).toBeTruthy();
  });

  it('arming a row drops a refusal that belonged to an earlier press', async () => {
    // A refusal answers one press against one snapshot. Left standing it read
    // as the board's permanent opinion of the tab.
    const user = userEvent.setup();
    const props = renderBoard({ removeError: { id: 'a', error: new AppRpcError('TAB_NOT_EMPTY', 'TAB_NOT_EMPTY') } });
    await user.click(badge(/^Open —/));
    expect(props.onDismissRemoveError).toHaveBeenCalled();
  });

  it('a refusal is still visible on the row that is mid-confirm', async () => {
    // The state a refusal is ACTUALLY seen in: the press leaves the row armed
    // and removable, so the confirm branch is what re-renders — and it used to
    // drop the message, which is why a refused removal looked like a dead
    // button.
    const user = userEvent.setup();
    renderBoard({ removeError: { id: 'a', error: new AppRpcError('TAB_DAY_MISMATCH', 'TAB_DAY_MISMATCH') } });
    await user.click(badge(/^Open —/));
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeTruthy();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});

describe('filterBoardRows', () => {
  it('matches within the chosen facet and sorts rows with that facet first', () => {
    expect(filterBoardRows(rows, 'table', 't8').map((r) => r.id)).toEqual(['a']);
    expect(filterBoardRows(rows, 'court', 'court').map((r) => r.id)).toEqual(['b']);
    expect(filterBoardRows(rows, 'name', 'ali').map((r) => r.id)).toEqual(['b']);
    expect(filterBoardRows(rows, 'court', '').map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('also matches the label so a table search finds a by-name tab typed in full', () => {
    expect(filterBoardRows(rows, 'table', 'Ali').map((r) => r.id)).toEqual(['b']);
  });
  it('counts table numbers instead of spelling them', () => {
    // table_number is text, so the board used to read 1, 10, 11, 12, 2.
    const numbered = ['2', '10', '1', 'T10', '12', 'T2', '11'].map((table, i) => ({
      ...rows[0]!,
      id: table,
      table,
      label: `Table ${table}`,
      openedAt: new Date(NOW - i * 60_000).toISOString(),
    }));
    expect(filterBoardRows(numbered, 'table', '').map((r) => r.table)).toEqual(['1', '2', '10', '11', '12', 'T2', 'T10']);
  });
});

describe('ageLabel', () => {
  const tr = (k: string, p?: Record<string, string | number>) => `${k}:${JSON.stringify(p ?? {})}`;
  it('renders now / minutes / hours', () => {
    expect(ageLabel(new Date(NOW - 20_000).toISOString(), NOW, tr as never)).toContain('ageNow');
    expect(ageLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW, tr as never)).toContain('"minutes":5');
    expect(ageLabel(new Date(NOW - 125 * 60_000).toISOString(), NOW, tr as never)).toContain('"hours":2,"minutes":5');
  });
});
