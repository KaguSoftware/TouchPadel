import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';

// 0353: a gender is a must on every new customer. No default; Create waits for
// Woman or Man, and the choice goes to desk-customer-create as `gender`.

const callEdge = vi.hoisted(() => vi.fn(async () => ({ id: 'new-guest' })));
vi.mock('../../../lib/edge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callEdge,
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

import { CustomerCreateScreen } from './CustomerCreate';

describe('CustomerCreateScreen gender', () => {
  it('keeps Create disabled until Woman or Man is chosen, then sends it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <ToastProvider>
            <CustomerCreateScreen />
          </ToastProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText('Full name'), 'Sara Ali');
    await userEvent.type(screen.getByLabelText('Phone'), '07700000001');
    const create = screen.getByRole('button', { name: 'Create customer' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await userEvent.click(screen.getByTestId('customer-gender-female'));
    expect(create.disabled).toBe(false);
    await userEvent.click(create);
    expect(callEdge).toHaveBeenCalledWith(
      'desk-customer-create',
      expect.objectContaining({ fullName: 'Sara Ali', phone: '07700000001', gender: 'female' }),
      expect.anything(),
    );
  });
});
