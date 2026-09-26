import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { OpenTabsBoard, ageLabel, boardSummary, courtTotals, filterBoardRows, type BoardRow } from './OpenTabs';

const NOW = Date.parse('2026-09-03T12:00:00Z');

const rows: BoardRow[] = [
  {
    id: 'a',
    label: 'Table T8',
    table: 'T8',
    court: null,
    courtId: null,
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
    courtId: 'c1',
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

  it('ready: every open tab with its age and running total, and the floor in the subtitle', () => {
    renderBoard({});
    expect(screen.getByText('Table T8')).toBeTruthy();
    expect(screen.getByText('Ali')).toBeTruthy();
    expect(screen.getByText('Awaiting payment')).toBeTruthy();
    expect(screen.getByText('Web order')).toBeTruthy();
    expect(screen.getByText('25 min')).toBeTruthy();
    expect(screen.getByText('2 h 10 min')).toBeTruthy();
    expect(screen.getByText('8,000 IQD')).toBeTruthy();
    // The situation, not a description of the screen — and said once.
    expect(screen.getByText('Open: 2 · Waiting for payment: 1')).toBeTruthy();
    expect(screen.queryByText('2 open')).toBeNull();
  });

  it('ready: no column that reads the same on every row', () => {
    renderBoard({});
    // Every row on this board is open, and most came from the till: a Status
    // column of "Open" and a Source column of "Till" said nothing.
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Source' })).toBeNull();
    expect(screen.queryByText('Open', { selector: 'span' })).toBeNull();
    expect(screen.queryByText('Till')).toBeNull();
  });

  it('says when court fees are missing from the totals, only when a booking tab is listed', () => {
    renderBoard({});
    expect(screen.getByText(/Court fees are not in these totals/)).toBeTruthy();
  });

  it('does not mention court fees when no booking tab is on the board', () => {
    renderBoard({ rows: [rows[0]!] });
    expect(screen.queryByText(/Court fees are not in these totals/)).toBeNull();
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

  it('opening a row and merging emit the tab id', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(props.onSelect).toHaveBeenCalledWith('a');
    await user.click(screen.getAllByRole('button', { name: 'Merge' })[1]!);
    expect(props.onMerge).toHaveBeenCalledWith('b');
  });

  it('only one primary button on the page — the rows are not a column of blue', () => {
    const { container } = render(
      <LocaleProvider>
        <OpenTabsBoard
          status="ready"
          rows={rows}
          filter="table"
          query=""
          now={NOW}
          onFilter={vi.fn()}
          onQuery={vi.fn()}
          onSelect={vi.fn()}
          onMerge={vi.fn()}
          onOpenTab={vi.fn()}
          onRetry={vi.fn()}
          onRemoveTab={vi.fn()}
          onDismissRemoveError={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(container.querySelectorAll('[data-kind="primary"]').length).toBe(1);
  });

  it('a search with no matches keeps the table and says so', () => {
    renderBoard({ query: 'zzz' });
    expect(screen.getByText('No open tabs match this search.')).toBeTruthy();
  });
});

describe('removing an empty tab', () => {
  const remove = () => screen.getByRole('button', { name: 'Remove' });

  it('is offered on exactly the tabs that can be removed, which say they are empty', () => {
    renderBoard({});
    // Row a has nothing on it; row b is being settled.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getAllByText('Nothing on it yet')).toHaveLength(1);
  });

  it('arms on the first press, then asks WHY before it emits the id', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull();

    await user.click(remove());
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
    await user.click(remove());
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onRemoveTab).toHaveBeenCalledWith('a', 'staff_error');
  });

  it('backing out of the reason keeps the tab and the confirm', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(remove());
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Reason required')).toBeNull();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeTruthy();
  });

  it('does not remove anything until the confirm is pressed, and Keep backs out', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(remove());
    expect(screen.getByText('Remove?')).toBeTruthy();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull();
    expect(props.onRemoveTab).not.toHaveBeenCalled();
  });

  it('arming the row does not also open it on the till', async () => {
    const user = userEvent.setup();
    const props = renderBoard({});
    await user.click(remove());
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('a held tab offers no remove at all, whatever holds it', () => {
    const held: BoardRow[] = (['orders', 'payments', 'adjustments', 'reservation', 'settling', 'unknown'] as const).map((blocker, i) => ({
      ...rows[0]!,
      id: `held-${blocker}`,
      label: `Table H${i}`,
      table: `H${i}`,
      blocker,
    }));
    renderBoard({ rows: held });
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByText('Nothing on it yet')).toBeNull();
  });

  it('arming a second row disarms the first', async () => {
    const user = userEvent.setup();
    const two: BoardRow[] = [rows[0]!, { ...rows[0]!, id: 'c', label: 'Table T9', table: 'T9' }];
    renderBoard({ rows: two });
    const [first, second] = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(first!);
    expect(screen.getAllByText('Remove?')).toHaveLength(1);
    await user.click(second!);
    expect(screen.getAllByText('Remove?')).toHaveLength(1);
    // The first row is back to its resting controls.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  it('a server refusal lands on the row it belongs to, naming what holds it', () => {
    // The board's rows are a cached read, so a tab can gain an order between
    // the render and the press; the answer must appear where the press was.
    renderBoard({ removeError: { id: 'a', error: new AppRpcError('TAB_NOT_EMPTY', 'TAB_NOT_EMPTY', undefined, 'orders') } });
    expect(screen.getByText('Something has been ordered on this tab. Settle it, or void the lines first.')).toBeTruthy();
  });

  it('a refusal still shows after the refetch made the row un-removable', () => {
    // The race's other ending: by the time the refusal arrives, the refetch
    // has the order too, and the row no longer offers Remove.
    renderBoard({
      rows: [{ ...rows[0]!, blocker: 'orders' }],
      removeError: { id: 'a', error: new AppRpcError('TAB_NOT_EMPTY', 'TAB_NOT_EMPTY', undefined, 'orders') },
    });
    expect(screen.getByText('Something has been ordered on this tab. Settle it, or void the lines first.')).toBeTruthy();
  });

  it('a refusal with no detail still says something true', () => {
    renderBoard({ removeError: { id: 'a', error: new AppRpcError('NO_OPEN_DAY', 'NO_OPEN_DAY') } });
    expect(screen.getByText('No business day is open.')).toBeTruthy();
  });

  it('arming a row drops a refusal that belonged to an earlier press', async () => {
    const user = userEvent.setup();
    const props = renderBoard({ removeError: { id: 'a', error: new AppRpcError('TAB_NOT_EMPTY', 'TAB_NOT_EMPTY') } });
    await user.click(remove());
    expect(props.onDismissRemoveError).toHaveBeenCalled();
  });

  it('a refusal is still visible on the row that is mid-confirm', async () => {
    // A refused removal leaves the row armed and removable, so the confirm
    // branch is what re-renders — it must carry the message too.
    const user = userEvent.setup();
    renderBoard({ removeError: { id: 'a', error: new AppRpcError('TAB_DAY_MISMATCH', 'TAB_DAY_MISMATCH') } });
    await user.click(remove());
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeTruthy();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});

describe('filterBoardRows', () => {
  it('the search matches table, court, guest and name whatever the sort', () => {
    for (const sort of ['table', 'court', 'name'] as const) {
      expect(filterBoardRows(rows, sort, 't8').map((r) => r.id)).toEqual(['a']);
      expect(filterBoardRows(rows, sort, 'court').map((r) => r.id)).toEqual(['b']);
      expect(filterBoardRows(rows, sort, 'ali').map((r) => r.id)).toEqual(['b']);
    }
  });
  it('sorts rows that have the chosen key first', () => {
    expect(filterBoardRows(rows, 'court', '').map((r) => r.id)).toEqual(['b', 'a']);
    expect(filterBoardRows(rows, 'table', '').map((r) => r.id)).toEqual(['a', 'b']);
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

describe('boardSummary', () => {
  const tr = (k: string, p?: Record<string, string | number>) => `${k.split('.').pop()}=${p?.count}`;
  it('names waiting-for-payment only when there is some', () => {
    expect(boardSummary(rows, tr as never, 'en')).toBe('summaryOpen=2 · summaryAwaiting=1');
    expect(boardSummary([rows[0]!], tr as never, 'en')).toBe('summaryOpen=1');
  });
});

describe('ageLabel', () => {
  const tr = (k: string, p?: Record<string, string | number>) => `${k}:${JSON.stringify(p ?? {})}`;
  it('renders now / minutes / hours / days', () => {
    expect(ageLabel(new Date(NOW - 20_000).toISOString(), NOW, tr as never)).toContain('ageNow');
    expect(ageLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW, tr as never)).toContain('"minutes":5');
    expect(ageLabel(new Date(NOW - 125 * 60_000).toISOString(), NOW, tr as never)).toContain('"hours":2,"minutes":5');
    // "29 h 44 min" wrapped onto three lines of a narrow column.
    expect(ageLabel(new Date(NOW - (29 * 60 + 44) * 60_000).toISOString(), NOW, tr as never)).toContain('"days":1,"hours":5');
  });
});

describe('courtTotals', () => {
  const on = (id: string, courtId: string | null, total: number): BoardRow => ({
    ...rows[1]!,
    id,
    courtId,
    court: courtId === null ? null : `Court ${courtId.slice(1)}`,
    total,
  });

  it('adds up every tab on a court that has more than one', () => {
    const got = courtTotals([on('a', 'c1', 25000), on('b', 'c1', 8000)]);
    expect(got.get('c1')).toEqual({ total: 33000, count: 2 });
  });

  it('leaves a court with a single tab alone', () => {
    // Nothing to add up, and a heading would only repeat the row beneath it.
    expect(courtTotals([on('a', 'c1', 25000)]).size).toBe(0);
  });

  it('ignores tabs with no court at all', () => {
    expect(courtTotals([on('a', null, 8000), on('b', null, 3000)]).size).toBe(0);
  });

  it('keeps courts apart and sums each on its own', () => {
    const got = courtTotals([
      on('a', 'c1', 25000),
      on('b', 'c2', 5000),
      on('c', 'c1', 8000),
      on('d', 'c2', 7000),
      on('e', null, 100),
    ]);
    expect(got.get('c1')).toEqual({ total: 33000, count: 2 });
    expect(got.get('c2')).toEqual({ total: 12000, count: 2 });
    expect(got.size).toBe(2);
  });

  it('sums tabs on one court even when they are not adjacent', () => {
    // The board can be sorted by name, which scatters a court's tabs.
    const got = courtTotals([on('a', 'c1', 25000), on('b', 'c2', 5000), on('c', 'c1', 8000)]);
    expect(got.get('c1')).toEqual({ total: 33000, count: 2 });
  });
});

describe('OpenTabsBoard court grouping', () => {
  it('shows one combined figure for a court carrying two tabs', () => {
    const two: BoardRow[] = [
      { ...rows[1]!, id: 'x', courtId: 'c1', court: 'Court 1', total: 25000, blocker: null },
      { ...rows[1]!, id: 'y', courtId: 'c1', court: 'Court 1', total: 8000, blocker: null },
    ];
    renderBoard({ rows: two });
    // The heading names the court and how many bills it carries...
    expect(screen.getByText('Court 1 · 2 bills')).toBeTruthy();
    // ...and the combined total appears exactly once, alongside the two rows.
    expect(screen.getAllByText('33,000 IQD')).toHaveLength(1);
  });

  it('does not group a court with a single tab', () => {
    renderBoard({ rows });
    expect(screen.queryByText(/· 1 bills?$/)).toBeNull();
  });
});
