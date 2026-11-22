import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { callEdge, EdgeError } from '../../../lib/edge';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import { useState } from 'react';

// 0448: a customer saved by name alone is picked like any other, says
// Incomplete, and takes the number that completes the account right there.

vi.mock('../../../lib/edge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callEdge: vi.fn(),
}));
vi.mock('../../../lib/appRpc', () => ({ appRpc: vi.fn(async () => []) }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const edge = vi.mocked(callEdge);
const draft: PickedCustomer = { id: 'draft-1', name: 'Ali', phone: null, flags: [], gender: null, incomplete: true };

function Harness({ seen }: { seen: (c: PickedCustomer | null) => void }) {
  const [value, setValue] = useState<PickedCustomer | null>(draft);
  return (
    <CustomerPicker
      value={value}
      onChange={(next) => {
        setValue(next);
        seen(next);
      }}
    />
  );
}

function mount() {
  const seen = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <Harness seen={seen} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { seen };
}

// A block body: vitest would run a returned mock as the test's cleanup.
beforeEach(() => {
  edge.mockReset();
});

describe('a picked customer with no number', () => {
  it('says Incomplete and saves the number that completes the account', async () => {
    edge.mockResolvedValue({ id: 'draft-1', completed: true, customer: { full_name: 'Ali', phone: '0770 123 4567', gender: null } });
    const user = userEvent.setup();
    const { seen } = mount();
    expect(screen.getByText('Incomplete')).toBeTruthy();
    const save = screen.getByTestId('complete-phone.save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByTestId('complete-phone.input'), '0770 123 4567');
    await user.click(save);
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ ...draft, phone: '0770 123 4567', incomplete: false }));
    expect(edge).toHaveBeenCalledWith('desk-customer-create', { customerId: 'draft-1', phone: '0770 123 4567', ifExists: 'return' }, expect.anything());
    // Whole now: the box and the badge are gone, the number shows.
    expect(screen.queryByTestId('complete-phone')).toBeNull();
    expect(screen.queryByText('Incomplete')).toBeNull();
    expect(screen.getByText('0770 123 4567')).toBeTruthy();
  });

  it('a number that already has its customer names them and offers them instead', async () => {
    edge.mockRejectedValue(
      new EdgeError(409, 'UNKNOWN', 'dup', 'DUPLICATE_PHONE', {
        error: 'DUPLICATE_PHONE',
        id: 'old-1',
        customer: { id: 'old-1', full_name: 'Ali Hassan', phone: '07701234567', gender: 'male' },
      }),
    );
    const user = userEvent.setup();
    const { seen } = mount();
    await user.type(screen.getByTestId('complete-phone.input'), '07701234567');
    await user.click(screen.getByTestId('complete-phone.save'));
    expect((await screen.findByRole('alert')).textContent).toContain('This number already belongs to');
    await user.click(screen.getByTestId('complete-phone.use-holder'));
    expect(seen).toHaveBeenLastCalledWith({ id: 'old-1', name: 'Ali Hassan', phone: '07701234567', flags: [], gender: 'male' });
  });

  it('says so when the account is not the desk\'s to complete, or the call fails', async () => {
    edge.mockRejectedValue(new EdgeError(409, 'UNKNOWN', 'no', 'CUSTOMER_NOT_INCOMPLETE', { error: 'CUSTOMER_NOT_INCOMPLETE' }));
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByTestId('complete-phone.input'), '07701234567');
    await user.click(screen.getByTestId('complete-phone.save'));
    expect((await screen.findByRole('alert')).textContent).toBe('This account already has a number, or its owner adds it in the app.');
    edge.mockRejectedValue(new Error('down'));
    await user.click(screen.getByTestId('complete-phone.save'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The number was not saved. Try again.'));
  });
});
