import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';

// One of my steps on /tasks (build-contracts-2026-09-23 §5.4): the form for its
// step key, what was said the last time, and the buttons its `can` allows.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'me', displayName: 'Maha', role: 'cashier' } }),
}));

const RUN = 'aaaaaaaa-0000-4000-8000-00000000000a';
const STEP = 'aaaaaaaa-0000-4000-8000-00000000000b';

function detail(over: { step?: Record<string, unknown>; run?: Record<string, unknown>; can?: Record<string, unknown> } = {}) {
  return {
    run: { id: RUN, kind: 'product_release', variant: null, title_en: 'Date cake', title_ar: null, status: 'active', ...over.run },
    step: {
      id: STEP,
      step_key: null,
      name_en: 'Photograph the display',
      name_ar: 'صوّر العرض',
      status: 'open',
      round: 2,
      assigned_to_name: null,
      items: [{ id: 'it1', text_en: 'Front shelf', text_ar: 'الرف الأمامي', done_by_name: null, done_at: null }],
      submissions: [
        {
          id: 'sub1',
          round: 1,
          submitted_by_name: 'Maha',
          submitted_at: '2026-09-24T10:00:00Z',
          record: { note: 'Done' },
          photos: [],
          withdrawn_at: null,
          superseded_at: null,
          decision: 'send_back',
          decided_by_name: 'Omar',
          decided_at: '2026-09-24T11:00:00Z',
          decision_note: 'Too dark, take it again',
        },
      ],
      ...over.step,
    },
    can: { submit: true, withdraw_submission_id: null, tick: true, withdraw_run: false, ...over.can },
    def: null,
  };
}

let payload: unknown = detail();
let submitError: Error | null = null;
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'protocol_step_detail') return payload;
    if (fn === 'submit_step') {
      if (submitError) throw submitError;
      return { submission_id: 'sub2', auto: false, step_status: 'submitted', run_status: 'active', opened_step_ids: [] };
    }
    if (fn === 'tick_run_item') return {};
    if (fn === 'tournament_context') {
      return {
        name_en: 'Autumn Open',
        name_ar: 'بطولة الخريف',
        class: 'B',
        format: null,
        capacity: { unit: 'pairs', count: 16 },
        ranges: [{ court_names: [{ en: 'Court 1', ar: 'الملعب 1' }], from: '2026-10-10T14:00:00Z', to: '2026-10-10T20:00:00Z' }],
        blocked: [],
      };
    }
    throw new Error(`unexpected ${fn}`);
  }),
}));

import { StepSheet } from './StepSheet';

function renderSheet(onClose = vi.fn(), client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ConfirmProvider>
          <StepSheet runStepId={STEP} onClose={onClose} />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  payload = detail();
  submitError = null;
  calls.length = 0;
  navigate.mockClear();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('StepSheet', () => {
  it('says why it came back, starts from what was sent, and sends it again with a key', async () => {
    const onClose = renderSheet();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Omar.? sent this back: .?Too dark, take it again/)).toBeTruthy();
    const note = within(dialog).getByTestId('field.note') as HTMLTextAreaElement;
    expect(note.value).toBe('Done');
    await userEvent.clear(note);
    await userEvent.type(note, 'Retaken in daylight');
    await userEvent.click(within(dialog).getByTestId('step.submit'));
    const submit = calls.find((c) => c.fn === 'submit_step')!;
    expect(submit.args.p_run_step_id).toBe(STEP);
    expect(submit.args.p_record).toEqual({ note: 'Retaken in daylight' });
    expect(submit.args.p_photos).toEqual([]);
    expect(String(submit.args.p_idempotency_key)).toMatch(/^protocol\.submit:[0-9a-f-]{36}$/);
    expect(onClose).toHaveBeenCalled();
  });

  it('sends again under a new key once a send that landed unseen was withdrawn', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    submitError = new TypeError('Failed to fetch');
    renderSheet(vi.fn(), client);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByTestId('step.submit'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'submit_step')).toHaveLength(1));
    const first = calls.find((c) => c.fn === 'submit_step')!.args.p_idempotency_key;

    // It had landed: the step shows it, withdrawn since, and is open again in the same round.
    const base = detail();
    payload = {
      ...base,
      step: {
        ...base.step,
        submissions: [
          ...base.step.submissions,
          { ...base.step.submissions[0], id: 'sub2', round: 2, decision: null, decided_by_name: null, decided_at: null, decision_note: null, withdrawn_at: '2026-09-25T12:00:00Z' },
        ],
      },
    };
    submitError = null;
    await client.invalidateQueries();
    await waitFor(() => expect(calls.filter((c) => c.fn === 'protocol_step_detail').length).toBeGreaterThan(1));
    await userEvent.click(within(dialog).getByTestId('step.submit'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'submit_step')).toHaveLength(2));
    expect(calls.filter((c) => c.fn === 'submit_step')[1]!.args.p_idempotency_key).not.toBe(first);
  });

  it('ticks the step’s checklist through tick_run_item', async () => {
    renderSheet();
    await userEvent.click(await screen.findByTestId('item.it1'));
    expect(calls.find((c) => c.fn === 'tick_run_item')?.args).toEqual({ p_item_id: 'it1', p_done: true });
  });

  it('sends the desk to its own screen for the courts step', async () => {
    payload = detail({ run: { kind: 'tournament', variant: 'type1' }, step: { step_key: 'courts', name_en: 'Courts', submissions: [], items: [] } });
    renderSheet();
    await userEvent.click(await screen.findByTestId('step.courts'));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/block', search: { run: RUN, step: STEP } });
    expect(screen.queryByTestId('step.submit')).toBeNull();
  });

  it('shows marketing the tournament plan its step is about, read through tournament_context (§5.4)', async () => {
    payload = detail({
      run: { kind: 'tournament', variant: 'type1', title_en: 'Autumn Open' },
      step: { step_key: 'marketing', name_en: 'Marketing', status: 'open', round: 1, submissions: [], items: [] },
    });
    renderSheet();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('The plan: Autumn Open')).toBeTruthy();
    expect(within(dialog).getByText(/Class B/)).toBeTruthy();
    expect(calls.find((c) => c.fn === 'tournament_context')?.args).toEqual({ p_run_step_id: STEP });
    // The management reads stay off on /tasks.
    expect(calls.some((c) => c.fn === 'tournament_feasibility' || c.fn === 'release_cost' || c.fn === 'price_promo_numbers')).toBe(false);
  });

  it('offers no form when the step is not the caller’s to send', async () => {
    payload = detail({ step: { status: 'submitted' }, can: { submit: false, tick: false } });
    renderSheet();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Sent. It is waiting for a decision.')).toBeTruthy();
    expect(within(dialog).queryByTestId('step.submit')).toBeNull();
    expect((within(dialog).getByTestId('item.it1') as HTMLInputElement).disabled).toBe(true);
  });
});
