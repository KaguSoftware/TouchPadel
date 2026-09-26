import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// /incidents (wave5-addendum-2026-09-25 §2.6, §5.2): the desk and the till get
// the report form with their own reports beside it; management gets the review
// queue, a sheet with the photos and a required note, and the owner alone
// redacts. A redacted report never shows the stored marker.

let role: StaffRole = 'court_desk';
const signed = vi.hoisted(() => vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null })));
vi.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (path: string) => signed(path) }) } },
  supabaseUrl: '',
  supabaseAnonKey: '',
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'me', displayName: 'Hussein', role } }),
}));
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchActiveCourts: vi.fn(async () => [
    { id: 'c1', name_en: 'Court 1', name_ar: 'الملعب 1', duration_options: [60], sort_order: 1 },
    { id: 'c3', name_en: 'Court 3', name_ar: 'الملعب 3', duration_options: [60], sort_order: 3 },
  ]),
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  kind: 'injury',
  occurred_at: '2026-09-26T08:10:00Z',
  place: 'court',
  court_id: 'c3',
  court_name_en: 'Court 3',
  court_name_ar: 'الملعب 3',
  place_detail: null,
  description: 'A player twisted an ankle.',
  people_involved: 'One guest',
  photos: ['v1/incidents/a.webp'],
  status: 'open',
  reviewed_by_name: null,
  reviewed_at: null,
  review_note: null,
  redacted: false,
  reported_by_name: 'Hussein',
  reported_by_role: 'court_desk',
  reported_at: '2026-09-26T08:20:00Z',
  can_review: true,
  can_redact: false,
  ...over,
});

let queue: Record<string, unknown>[] = [];
let mine: Record<string, unknown>[] = [];
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'my_incidents':
        return { incidents: mine };
      case 'incidents_page':
        return { incidents: queue, open_count: queue.filter((r) => r.status === 'open').length, total: queue.length };
      case 'submit_incident':
        return { id: 'inew' };
      case 'review_incident':
        return { status: 'reviewed', reviewed_at: '2026-09-26T10:00:00Z' };
      case 'redact_incident':
        return { text_purged_at: '2026-09-26T10:00:00Z' };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { IncidentsPageScreen } from './IncidentsPage';

function renderPage(as: StaffRole, locale: 'en' | 'ar' = 'en') {
  role = as;
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <IncidentsPageScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queue = [row()];
  mine = [];
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('IncidentsPageScreen at the desk', () => {
  it('is the report form with the privacy line, and sends what the reporter filled in', async () => {
    const user = userEvent.setup();
    renderPage('court_desk');
    const form = screen.getByTestId('incidents.form');
    expect(within(form).getByTestId('incidents.form.privacy').textContent).toBe('Write only what is needed. Do not add phone numbers.');
    // The desk never reads management's queue (app.incidents_page refuses it).
    expect(calls.some((c) => c.fn === 'incidents_page')).toBe(false);

    await user.click(within(form).getByTestId('incidents.form.submit'));
    expect(within(form).getAllByText('Fill this in.').length).toBeGreaterThanOrEqual(3);
    expect(calls.some((c) => c.fn === 'submit_incident')).toBe(false);

    await user.click(within(screen.getByRole('group', { name: 'What kind' })).getByRole('button', { name: 'Injury' }));
    await user.click(within(screen.getByRole('group', { name: 'Where' })).getByRole('button', { name: 'Court' }));
    await user.click(await screen.findByRole('combobox', { name: 'Which court' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Court 3' }));
    await user.type(within(form).getByTestId('incidents.form.description'), 'A player twisted an ankle.');
    await user.click(within(form).getByTestId('incidents.form.submit'));

    const sent = calls.find((c) => c.fn === 'submit_incident')?.args;
    expect(sent).toMatchObject({ p_kind: 'injury', p_place: 'court', p_court_id: 'c3', p_description: 'A player twisted an ankle.', p_place_detail: null, p_people_involved: null, p_photos: [] });
    expect(String(sent?.p_idempotency_key)).toMatch(/^incident\.submit:/);
    expect(Number.isNaN(Date.parse(String(sent?.p_occurred_at)))).toBe(false);
  });

  it('lists the reporter’s own reports with the manager’s note, and never the redaction marker', async () => {
    mine = [
      row({ id: 'm1', status: 'reviewed', reviewed_by_name: 'Omar', reviewed_at: '2026-09-26T09:00:00Z', review_note: 'Called the guest, all fine.' }),
      row({ id: 'm2', kind: 'fight', place: 'cafe', court_id: null, redacted: true, description: '[deleted after 365 days]', photos: [] }),
    ];
    renderPage('cashier');
    const first = await screen.findByTestId('incidents.mine.m1');
    expect(within(first).getByText('Called the guest, all fine.')).toBeTruthy();
    expect(within(first).getByText(/Reviewed by .?Omar/)).toBeTruthy();
    const second = screen.getByTestId('incidents.mine.m2');
    // The 365-day purge and a redaction read the same: the text was deleted, not by whom.
    expect(within(second).getByText('This report’s text was deleted.')).toBeTruthy();
    expect(screen.queryByText('[deleted after 365 days]')).toBeNull();
  });

  it('says what the list is for while it is empty', async () => {
    renderPage('court_desk');
    expect(await screen.findByText(/You have not reported anything/)).toBeTruthy();
  });
});

describe('IncidentsPageScreen for management', () => {
  it('lists what waits for review and marks a report reviewed with the note the reporter reads', async () => {
    const user = userEvent.setup();
    renderPage('manager');
    expect(await screen.findByRole('button', { name: 'To review (1)' })).toBeTruthy();
    await user.click(await screen.findByTestId('incidents.open.i1'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('A player twisted an ankle.')).toBeTruthy();
    expect(within(sheet).getByText('One guest')).toBeTruthy();
    expect(within(sheet).getByRole('img', { name: 'Photo 1' })).toBeTruthy();
    // A manager does not redact.
    expect(within(sheet).queryByTestId('incidents.redact')).toBeNull();
    await user.click(within(sheet).getByTestId('incidents.review.confirm'));
    expect(within(sheet).getByText('Write a note for the reporter.')).toBeTruthy();
    expect(calls.some((c) => c.fn === 'review_incident')).toBe(false);
    await user.type(within(sheet).getByTestId('incidents.review.note'), 'Spoke to the guest.');
    await user.click(within(sheet).getByTestId('incidents.review.confirm'));
    expect(calls.find((c) => c.fn === 'review_incident')?.args).toEqual({ p_id: 'i1', p_note: 'Spoke to the guest.' });
  });

  it('does not offer a review of one’s own report', async () => {
    const user = userEvent.setup();
    queue = [row({ can_review: false })];
    renderPage('manager');
    await user.click(await screen.findByTestId('incidents.open.i1'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('You reported this. Another manager or the owner reviews it.')).toBeTruthy();
    expect(within(sheet).queryByTestId('incidents.review.confirm')).toBeNull();
  });

  it('lets the owner redact a report after saying what goes and what stays', async () => {
    const user = userEvent.setup();
    queue = [row({ status: 'reviewed', can_review: false, can_redact: true, reviewed_by_name: 'Omar', reviewed_at: '2026-09-26T09:00:00Z', review_note: 'Done' })];
    renderPage('owner');
    await user.click(await screen.findByRole('button', { name: 'Reviewed' }));
    await user.click(await screen.findByTestId('incidents.open.i1'));
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByTestId('incidents.redact'));
    expect(within(sheet).getByText(/This cannot be undone/)).toBeTruthy();
    expect(calls.some((c) => c.fn === 'redact_incident')).toBe(false);
    await user.click(within(sheet).getByTestId('incidents.redact.confirm'));
    expect(calls.find((c) => c.fn === 'redact_incident')?.args).toEqual({ p_id: 'i1' });
  });

  it('opens the report form above the queue for a manager who reports too', async () => {
    const user = userEvent.setup();
    renderPage('manager');
    await user.click(await screen.findByTestId('incidents.report.open'));
    expect(screen.getByTestId('incidents.form')).toBeTruthy();
    expect(screen.getByTestId('incidents.form.privacy')).toBeTruthy();
  });

  it('reads in Arabic', async () => {
    renderPage('manager', 'ar');
    expect(screen.getByRole('heading', { level: 1, name: 'الحوادث' })).toBeTruthy();
    expect(await screen.findByText('إصابة')).toBeTruthy();
  });
});
