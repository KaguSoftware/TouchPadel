import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { DrillDialog, type DrillRequest } from './DrillDialog';
import type * as AppRpcModule from '../../lib/appRpc';

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<typeof AppRpcModule>()),
  appRpc: vi.fn().mockResolvedValue({ transactions: [] }),
}));

const req = (what: string, key: string): DrillRequest => ({
  what,
  figures: [{ key, label: what }],
  scope: null,
  from: '2026-09-01',
  to: '2026-09-23',
});

/** The screens' shape: one slot, its request swapped in place. */
function Slot() {
  const [drill, setDrill] = useState<DrillRequest | null>(req('No-shows', 'noShows'));
  return (
    <>
      <button type="button" onClick={() => setDrill(req('Venue revenue', 'revenue'))}>
        open revenue
      </button>
      {drill && <DrillDialog request={drill} onClose={() => setDrill(null)} />}
    </>
  );
}

describe('DrillDialog', () => {
  it('a second drill opened while the first is fading out stays open', async () => {
    vi.useFakeTimers();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LocaleProvider>
          <Slot />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    // Close the first (starts its exit fade), then open another inside the fade.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'open revenue' }));
    // The first dialog's exit timer would fire here and used to shut the new one.
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('dialog')?.textContent).toContain('Venue revenue');
    vi.useRealTimers();
  });
});
