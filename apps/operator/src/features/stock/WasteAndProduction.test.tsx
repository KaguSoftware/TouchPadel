import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Waste and production's "Made today": every batch recorded this business day,
// here or on the kitchen's phones (app.production_log_today), with no cost.

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/mutate', () => ({ mutate: vi.fn() }));
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.order = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => chain }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { WasteAndProduction } from './WasteAndProduction';

const rpc = vi.mocked(appRpc);

function renderScreen(payload: unknown) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'production_log_today') return payload;
    throw new Error(`unexpected ${fn}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <WasteAndProduction />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

// Braces: a function returned from beforeEach is run as a teardown.
beforeEach(() => {
  rpc.mockReset();
});

describe('Made today', () => {
  it('lists the batches with who made them, reading the bigint movement id the server sends', async () => {
    renderScreen({
      rows: [
        // stock_movements.id is a bigint, so the id arrives as a number.
        { movement_id: 186, ingredient_id: 'g', name_en: 'Garlic Sauce', name_ar: 'صوص الثوم', qty: 500, unit: 'ml', staff_name: 'Dev Chef', at: '2026-09-25T03:45:15Z' },
      ],
    });
    const panel = await screen.findByTestId('made-today');
    expect(await within(panel).findByText('Garlic Sauce')).toBeTruthy();
    expect(within(panel).getByText('500 ml')).toBeTruthy();
    expect(within(panel).getByText('Dev Chef')).toBeTruthy();
    // No cost anywhere on the list.
    expect(panel.textContent).not.toMatch(/IQD/);
  });

  it('says so when nothing was made yet', async () => {
    renderScreen({ rows: [] });
    expect(await screen.findByText('Nothing made yet today.')).toBeTruthy();
  });
});
