import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../lib/i18n';
import { DataTable, SegmentedControl, type Column } from './kit';

// The table and segmented-button pass (Sait, 2026-10-19): a group column with
// one cell beside each group's rows, and a segmented control whose chosen
// segment stays a pressed button whatever paints it.

type Row = { id: string; day: string | null; name: string };
const rows: Row[] = [
  { id: 'a', day: 'mon', name: 'Ali' },
  { id: 'b', day: 'mon', name: 'Hasan' },
  { id: 'c', day: 'tue', name: 'Zainab' },
  { id: 'd', day: null, name: 'Loose' },
];
const columns: Column<Row>[] = [{ key: 'name', header: 'Name' }];

function renderTable() {
  return render(
    <LocaleProvider>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        groupBy={(r) => r.day}
        groupColumn={{ header: 'Day', render: (key, groupRows) => `${key} (${groupRows.length})` }}
        footer={
          <tr>
            <td colSpan={2}>Total</td>
          </tr>
        }
      />
    </LocaleProvider>,
  );
}

describe('DataTable groupColumn', () => {
  it('adds the column header before the others', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Day', 'Name']);
  });

  it('gives each group one cell spanning its rows, and marks where groups start and end', () => {
    const { container } = renderTable();
    const cells = [...container.querySelectorAll('td[data-group-cell]')];
    expect(cells.map((c) => [c.textContent, c.getAttribute('rowspan')])).toEqual([
      ['mon (2)', '2'],
      ['tue (1)', '1'],
      ['', '1'],
    ]);
    const body = [...container.querySelectorAll('tbody tr')];
    expect(body.map((r) => [r.getAttribute('data-group-start'), r.getAttribute('data-group-end')])).toEqual([
      ['true', null],
      [null, 'true'],
      ['true', 'true'],
      ['true', 'true'],
    ]);
  });

  it('puts the total row in the footer', () => {
    const { container } = renderTable();
    expect(container.querySelector('tfoot')?.textContent).toBe('Total');
  });
});

describe('SegmentedControl', () => {
  it('marks the chosen segment pressed and reports a new choice', () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider>
        <SegmentedControl
          aria-label="Period"
          value="week"
          onChange={onChange}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
          ]}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });
});
