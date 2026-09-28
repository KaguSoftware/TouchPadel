import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { SupplierField, matchSuppliers } from './SupplierField';

// One supplier box (2026-09-27): type any name, or pick from the list under it.
const SUPPLIERS = [
  { id: 's1', name: 'Al-Rafidain Dairy' },
  { id: 's2', name: 'Baghdad Bakery Supply' },
  { id: 's3', name: 'Dairy Farm Co' },
];

function Harness() {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  return (
    <LocaleProvider>
      <label>
        Supplier
        <SupplierField
          suppliers={SUPPLIERS}
          supplierId={id}
          name={name}
          onChange={(i, n) => {
            setId(i);
            setName(n);
          }}
        />
      </label>
      <output data-testid="state">{`${id}|${name}`}</output>
      <button type="button">elsewhere</button>
    </LocaleProvider>
  );
}

const state = () => screen.getByTestId('state').textContent;

describe('SupplierField', () => {
  it('narrows the list as you type, names starting with the text first', () => {
    expect(matchSuppliers(SUPPLIERS, 'dairy').map((s) => s.id)).toEqual(['s3', 's1']);
    expect(matchSuppliers(SUPPLIERS, '')).toHaveLength(3);
  });

  it('picks a supplier from the list in the same box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox', { name: 'Supplier' }), 'bagh');
    await user.click(screen.getByRole('option', { name: 'Baghdad Bakery Supply' }));
    expect(state()).toBe('s2|Baghdad Bakery Supply');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Baghdad Bakery Supply');
  });

  it('keeps a typed name that is on no list, with no supplier id', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'Jameela market');
    expect(screen.getByText(/Not on the list/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(state()).toBe('|Jameela market');
  });

  it('links a typed name that matches a supplier when the box is left', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), '  dairy farm co ');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(state()).toBe('s3|Dairy Farm Co');
  });

  it('picks with the arrow keys and Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'dairy');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(state()).toBe('s1|Al-Rafidain Dairy');
  });
});
