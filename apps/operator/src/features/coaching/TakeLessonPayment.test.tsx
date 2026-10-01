import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { LocaleProvider } from '../../lib/i18n';

// Take payment for a lesson sign-up (coaching operator.md §5.10.5): the till's
// PaymentPane over app.lesson_settle, mocked at appRpc.

const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'DESK-1',
}));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { TakeLessonPayment, type LessonPayTarget } from './TakeLessonPayment';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

function Harness({
  target,
  refetchDue,
  onNotice,
}: {
  target: LessonPayTarget;
  refetchDue: () => Promise<number | null>;
  onNotice?: (t: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return open ? (
    <TakeLessonPayment
      target={target}
      method="cash"
      onClose={() => setOpen(false)}
      refetchDue={refetchDue}
      onNotice={onNotice}
    />
  ) : (
    <p>closed</p>
  );
}

function mount(
  target: LessonPayTarget,
  refetchDue: () => Promise<number | null> = async () => null,
  onNotice?: (t: string) => void,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <Harness target={target} refetchDue={refetchDue} onNotice={onNotice} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const TARGET: LessonPayTarget = {
  enrolmentId: 'e1',
  name: 'Ali Hasan',
  course: false,
  dueIqd: 30000,
};

beforeEach(() => {
  rpc.mockReset();
  toast.ok.mockReset();
  localStorage.clear();
});

describe('TakeLessonPayment', () => {
  it('opens at take_iqd with no part payment, and sends lesson_settle with the expected owed, the key and the device', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      duplicate: false,
      payment_id: 'p1',
      amount_iqd: 30000,
      change_iqd: 20000,
    });
    mount(TARGET);
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Ali Hasan's lesson");
    expect(within(pane).getAllByText('30,000 IQD').length).toBeGreaterThan(0);
    expect(within(pane).queryByText('Part payment')).toBeNull();
    await user.type(within(pane).getByRole('textbox', { name: /Tendered/ }), '50000');
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('lesson_settle');
    expect(args).toMatchObject({
      p_enrolment_id: 'e1',
      p_method: 'cash',
      p_expected_owed_iqd: 30000,
      p_tendered_iqd: 50000,
      p_device_id: 'DESK-1',
    });
    expect(String((args as Record<string, unknown>).p_idempotency_key)).toMatch(/^lesson\.settle:/);
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe(
      'Took 30,000 IQD for Ali Hasan. Change 20,000 IQD',
    );
    expect(await screen.findByText('closed')).toBeTruthy();
  });

  it("names a course sign-up as the student's course", async () => {
    mount({ ...TARGET, course: true });
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Ali Hasan's course");
  });

  it('LESSON_OWED_CHANGED re-reads and keeps the pane open on the new due', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(new AppRpcError('LESSON_OWED_CHANGED', 'LESSON_OWED_CHANGED'));
    const refetch = vi.fn(async () => 20000);
    mount(TARGET, refetch);
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    await user.type(within(pane).getByRole('textbox', { name: /Tendered/ }), '30000');
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    expect(
      await within(pane).findByText(
        'What this student owes changed to 20,000 IQD. Check before taking it.',
      ),
    ).toBeTruthy();
    expect(refetch).toHaveBeenCalled();
    expect(within(pane).getAllByText('20,000 IQD').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: 'Cash' })).toBe(pane);
  });

  it('closes with "Nothing left to take" when the new due is 0', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(new AppRpcError('LESSON_OWED_CHANGED', 'LESSON_OWED_CHANGED'));
    const notice = vi.fn();
    mount(TARGET, async () => 0, notice);
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    await user.type(within(pane).getByRole('textbox', { name: /Tendered/ }), '30000');
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('closed')).toBeTruthy();
    expect(notice).toHaveBeenCalledWith('Nothing left to take for this student.');
  });

  it("LESSON_NOT_PAYABLE closes the pane with its detail's line", async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(
      new AppRpcError('LESSON_NOT_PAYABLE', 'LESSON_NOT_PAYABLE', undefined, 'no_show'),
    );
    const notice = vi.fn();
    mount(TARGET, async () => null, notice);
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    await user.type(within(pane).getByRole('textbox', { name: /Tendered/ }), '30000');
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('closed')).toBeTruthy();
    expect(notice).toHaveBeenCalledWith('This student was marked no-show.');
  });
});
