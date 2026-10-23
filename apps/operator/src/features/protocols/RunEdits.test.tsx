import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StepRow } from '@touch/core/protocols';
import { LocaleProvider } from '../../lib/i18n';

// The owner's own step on ONE running protocol (app.add_run_step), as the
// stepped dialog: Where, Name & who, Checklist, then Review.

const calls: { fn: string; args: Record<string, unknown> }[] = [];
const toasts: string[] = [];

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: (t: string) => toasts.push(t), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { id: 'rs9' };
  }),
}));
vi.mock('./api', () => ({ invalidateProtocols: vi.fn(async () => undefined) }));

import { AddStepDialog } from './RunEdits';

const step = (id: string, position: number, name_en: string, name_ar: string) =>
  ({ id, position, step_key: null, name_en, name_ar, status: 'waiting', round: 1, actor_roles: ['manager'], assigned_to: null, assigned_to_name: null, needs_owner_ok: false, optional: false, after_keys: [], opened_at: null, passed_at: null, skip_note: null, skipped_by_name: null, skipped_at: null, items: [], submissions: [] }) as unknown as StepRow;

function renderDialog(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <AddStepDialog runId="run1" after={[step('s2', 2, 'Open the till', 'فتح الصندوق'), step('s3', 3, 'Check the courts', 'فحص الملاعب')]} onClose={onClose} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
});

describe('AddStepDialog', () => {
  it('places, names and lists a step in three steps, then adds it from Review', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const wiz = screen.getByTestId('protocols.addStep');
    const forward = (name: string) => user.click(within(wiz).getAllByRole('button', { name }).at(-1)!);
    expect(within(wiz).getByText('Step 1 of 3')).toBeTruthy();
    // The last step it may follow is picked; each card says which step it is.
    const after = within(wiz).getByRole('group', { name: 'After' });
    expect(within(after).getByRole('button', { name: /Check the courts/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(after).getByText('Step 2')).toBeTruthy();
    await user.click(within(after).getByRole('button', { name: /Open the till/ }));
    await forward('Name & who');

    await forward('Checklist');
    expect(within(wiz).getByText('Fill in both English and Arabic.')).toBeTruthy();
    await user.type(within(wiz).getByRole('textbox', { name: 'Step name (English)' }), 'Wipe the glass walls');
    await user.type(within(wiz).getByRole('textbox', { name: 'Step name (Arabic)' }), 'مسح الجدران الزجاجية');
    // Done by is many: Manager is on, Court desk joins it.
    const by = within(wiz).getByRole('group', { name: 'Done by' });
    await user.click(within(by).getByRole('button', { name: 'Manager' }));
    await forward('Checklist');
    expect(within(wiz).getByText('Pick who does this step.')).toBeTruthy();
    await user.click(within(by).getByRole('button', { name: 'Court desk' }));
    await user.click(within(by).getByRole('button', { name: 'Manager' }));
    await forward('Checklist');

    // A line needs both languages, said on the line and above the footer.
    await user.click(within(wiz).getByRole('button', { name: 'Add a line' }));
    await user.type(within(wiz).getByRole('textbox', { name: 'Line 1 (English)' }), 'Court 1 glass');
    await forward('Review');
    expect(within(wiz).getAllByText('Fill in both English and Arabic.').length).toBeGreaterThan(0);
    await user.type(within(wiz).getByRole('textbox', { name: 'Line 1 (Arabic)' }), 'زجاج الملعب 1');
    await forward('Review');

    expect(within(wiz).getByText('All 3 steps done')).toBeTruthy();
    expect(within(wiz).getByText('Done by').closest('div')!.textContent).toContain('Court desk, Manager');
    await user.click(within(wiz).getByTestId('protocols.addStep.submit'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      fn: 'add_run_step',
      args: {
        p_run_id: 'run1',
        p_after_run_step_id: 's2',
        p_step: {
          name_en: 'Wipe the glass walls',
          name_ar: 'مسح الجدران الزجاجية',
          actor_roles: ['court_desk', 'manager'],
          needs_owner_ok: false,
          optional: false,
          items: [{ text_en: 'Court 1 glass', text_ar: 'زجاج الملعب 1' }],
        },
      },
    });
    expect(toasts).toEqual(['The step is added.']);
    expect(onClose).toHaveBeenCalled();
  });
});
