import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
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
});

describe('ageLabel', () => {
  const tr = (k: string, p?: Record<string, string | number>) => `${k}:${JSON.stringify(p ?? {})}`;
  it('renders now / minutes / hours', () => {
    expect(ageLabel(new Date(NOW - 20_000).toISOString(), NOW, tr as never)).toContain('ageNow');
    expect(ageLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW, tr as never)).toContain('"minutes":5');
    expect(ageLabel(new Date(NOW - 125 * 60_000).toISOString(), NOW, tr as never)).toContain('"hours":2,"minutes":5');
  });
});
