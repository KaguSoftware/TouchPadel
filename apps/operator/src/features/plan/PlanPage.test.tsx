import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// The content plan (0362): marketing adds a weekly idea and sends the month;
// the owner reads the list, leaves an idea out and approves; a result for an
// approved idea takes a Google Drive link and nothing else.

let role: 'marketing' | 'owner' = 'marketing';
vi.mock('../../lib/auth', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, useAuth: () => ({ staff: { id: 's', role, displayName: 'S' } }) };
});
// The page's search params as a tiny store: navigate() writes them and the
// page re-renders, as the router would.
let search: Record<string, unknown> = {};
const listeners = new Set<() => void>();
const navigate = vi.fn(async (opts: { search?: unknown }) => {
  if (opts.search && typeof opts.search === 'object') search = opts.search as Record<string, unknown>;
  for (const l of listeners) l();
});
vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    useSearch: () =>
      React.useSyncExternalStore(
        (l: () => void) => {
          listeners.add(l);
          return () => void listeners.delete(l);
        },
        () => search,
      ),
    useNavigate: () => navigate,
  };
});
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }) }) } },
  supabaseUrl: '',
  supabaseAnonKey: '',
}));

const idea = (over: Record<string, unknown>) => ({
  id: 'a',
  day: '2099-11-05',
  title: 'Night padel reel',
  kind: 'reel',
  channel: 'instagram',
  details: 'Slow motion under the lights',
  status: 'proposed',
  drop_note: null,
  created_by_name: 'Rusul',
  decided_at: null,
  result: null,
  ...over,
});
let plan: Record<string, unknown> = {};
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'marketing_plan':
        return plan;
      case 'save_plan_idea':
        return { ids: (args.p_days as string[]).map((_, i) => `n${i}`), plan_id: 'p', plan_status: 'draft' };
      case 'send_marketing_plan':
        return { status: 'waiting', ideas: 1 };
      case 'decide_marketing_plan':
        return { status: 'approved', approved: 1, dropped: 1 };
      case 'submit_content':
        return { id: 'c', version: 1, status: 'waiting' };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { PlanScreen } from './PlanPage';

const base = {
  month: '2099-11-01',
  today: '2099-11-03',
  plan: null,
  ideas: [],
  waiting_months: [],
  can_edit: true,
  can_send: false,
  can_take_back: false,
  can_decide: false,
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <PlanScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  search = { month: '2099-11' };
  navigate.mockClear();
  role = 'marketing';
  plan = { ...base };
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('marketing writes the month', () => {
  it('adds an idea every week from a day, then sends the plan', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/Nothing is planned for this month yet/)).toBeTruthy();
    await user.click(screen.getByTestId('plan.day.2099-11-05'));
    expect(search).toMatchObject({ month: '2099-11', day: '2099-11-05' });
    const panel = await screen.findByTestId('plan.dayPanel');
    await user.click(within(panel).getByTestId('plan.add'));
    const form = screen.getByTestId('plan.form');
    await user.click(within(form).getByTestId('plan.form.submit'));
    expect(within(form).getByText('Write a title.')).toBeTruthy();
    await user.type(within(form).getByTestId('plan.form.title'), 'Thursday ladies night');
    await user.click(within(form).getByTestId('plan.form.weekly'));
    await user.click(within(form).getByTestId('plan.form.submit'));
    const saved = calls.find((c) => c.fn === 'save_plan_idea')?.args;
    expect(saved).toMatchObject({
      p_id: null,
      p_days: ['2099-11-05', '2099-11-12', '2099-11-19', '2099-11-26'],
      p_title: 'Thursday ladies night',
      p_kind: 'post',
      p_channel: 'instagram',
    });
    expect(String(saved?.p_idempotency_key)).toMatch(/^plan\.idea:/);
  });

  it('sends a draft with new ideas', async () => {
    const user = userEvent.setup();
    plan = { ...base, plan: { id: 'p', status: 'draft' }, ideas: [idea({})], can_send: true };
    renderPage();
    expect(await screen.findByText(/New ideas not sent yet: 1/)).toBeTruthy();
    await user.click(screen.getByTestId('plan.send'));
    expect(calls.find((c) => c.fn === 'send_marketing_plan')?.args).toEqual({ p_month: '2099-11-01' });
  });

  it('sends a result for an approved idea with a Google Drive link only', async () => {
    const user = userEvent.setup();
    search = { month: '2099-11', day: '2099-11-05' };
    plan = { ...base, plan: { id: 'p', status: 'approved', decided_by_name: 'Majed', decided_at: '2099-11-01T10:00:00Z' }, ideas: [idea({ status: 'approved', decided_at: '2099-11-01T10:00:00Z' })] };
    renderPage();
    await user.click(await screen.findByTestId('plan.idea.send.a'));
    const form = screen.getByTestId('content.form');
    expect(within(form).getByText('Result for “Night padel reel”')).toBeTruthy();
    expect((within(form).getByTestId('content.form.title') as HTMLInputElement).value).toBe('Night padel reel');
    await user.type(within(form).getByTestId('content.form.body'), 'Lights on, rackets up');
    await user.type(within(form).getByTestId('content.form.link'), 'https://we.tl/abc');
    await user.click(within(form).getByTestId('content.form.submit'));
    expect(within(form).getByText(/Paste a Google Drive link/)).toBeTruthy();
    expect(calls.some((c) => c.fn === 'submit_content')).toBe(false);
    await user.clear(within(form).getByTestId('content.form.link'));
    await user.type(within(form).getByTestId('content.form.link'), 'https://drive.google.com/file/d/xyz/view');
    await user.click(within(form).getByTestId('content.form.submit'));
    expect(calls.find((c) => c.fn === 'submit_content')?.args).toMatchObject({
      p_title: 'Night padel reel',
      p_channel: 'instagram',
      p_planned_for: '2099-11-05',
      p_body: 'Lights on, rackets up',
      p_media_link: 'https://drive.google.com/file/d/xyz/view',
      p_idea_id: 'a',
    });
  });
});

describe('the owner decides', () => {
  it('reads every idea, leaves one out and approves with a note', async () => {
    const user = userEvent.setup();
    role = 'owner';
    plan = {
      ...base,
      plan: { id: 'p', status: 'waiting', sent_by_name: 'Rusul', sent_at: '2099-11-01T09:00:00Z' },
      ideas: [idea({}), idea({ id: 'b', day: '2099-11-08', title: 'Iced latte poster', kind: 'poster' })],
      waiting_months: ['2099-11-01'],
      can_edit: false,
      can_decide: true,
    };
    renderPage();
    // The list is the owner's default while deciding.
    const list = await screen.findByTestId('plan.list');
    expect(within(list).getByText('Night padel reel')).toBeTruthy();
    expect(within(list).getByText('Iced latte poster')).toBeTruthy();
    expect(screen.queryByTestId('plan.add')).toBeNull();
    await user.click(screen.getByTestId('plan.idea.leave.b'));
    expect(screen.getByTestId('plan.decide.summary').textContent).toBe('New ideas this approves: 1. Left out: 1.');
    await user.type(screen.getByTestId('plan.decide.note'), 'The poster can wait');
    await user.click(screen.getByTestId('plan.decide.approve'));
    expect(calls.find((c) => c.fn === 'decide_marketing_plan')?.args).toEqual({
      p_id: 'p',
      p_decision: 'approve',
      p_note: 'The poster can wait',
      p_drop: ['b'],
    });
  });
});
