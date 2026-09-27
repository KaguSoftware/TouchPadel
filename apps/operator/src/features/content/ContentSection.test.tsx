import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Content for approval (wave5-addendum-2026-09-25 §2.7, §5.2): the owner reads
// every version and approves, asks for changes or declines (the last two with
// a reason) and never edits the text; marketing sends, revises and withdraws
// from /tasks. A decision names the version the owner read.

const signed = vi.hoisted(() => vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null })));
vi.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (path: string) => signed(path) }) } },
  supabaseUrl: '',
  supabaseAnonKey: '',
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

const header = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  title: 'Friday night padel',
  channel: 'instagram',
  planned_for: '2099-10-02',
  status: 'waiting',
  current_version: 2,
  author_name: 'Hanan',
  submitted_at: '2026-09-26T08:00:00Z',
  cover_image: 'v1/campaigns/a.webp',
  menu_item_id: null,
  item_name_en: null,
  item_name_ar: null,
  campaign_id: null,
  campaign_name_en: null,
  campaign_name_ar: null,
  decided_by_name: null,
  decided_at: null,
  updated_at: '2026-09-26T08:00:00Z',
  ...over,
});
const versions = [
  { version: 2, body: 'Shorter caption', images: ['v1/campaigns/a.webp'], media_link: 'https://example.com/reel', note: null, submitted_by_name: 'Hanan', submitted_at: '2026-09-26T08:00:00Z', superseded_at: null, decision: null, decided_by_name: null, decided_at: null, decision_note: null },
  { version: 1, body: 'First caption', images: ['v1/campaigns/a.webp', 'v1/campaigns/b.webp'], media_link: null, note: 'Draft', submitted_by_name: 'Hanan', submitted_at: '2026-09-25T08:00:00Z', superseded_at: null, decision: 'changes', decided_by_name: 'Majed', decided_at: '2026-09-25T20:00:00Z', decision_note: 'Shorter, please' },
];

let detailCan = { can_decide: true, can_revise: false, can_withdraw: false };
let item = header();
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'content_page': {
        const rows = args.p_filter === 'all' || args.p_filter === item.status ? [item] : [];
        return { content: rows, waiting_count: item.status === 'waiting' ? 1 : 0, total: rows.length };
      }
      case 'content_detail':
        return { content: item, versions, ...detailCan };
      case 'decide_content':
        return { status: 'approved', version: args.p_version, decided_at: '2026-09-26T10:00:00Z' };
      case 'submit_content':
        return { id: 'knew', version: 1, status: 'waiting' };
      case 'revise_content':
        return { id: 'k1', version: 3, status: 'waiting' };
      case 'withdraw_content':
        return { status: 'withdrawn' };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { ContentApprovalPanel, MarketingContentPanel } from './ContentSection';

function renderPanel(which: 'owner' | 'marketing', locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>{which === 'owner' ? <ContentApprovalPanel /> : <MarketingContentPanel />}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  item = header();
  detailCan = { can_decide: true, can_revise: false, can_withdraw: false };
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('the owner’s Content for approval', () => {
  it('opens a post with every version, the link as text, and approves the version it shows', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    expect(await screen.findByRole('button', { name: 'Waiting (1)' })).toBeTruthy();
    await user.click(await screen.findByTestId('content.item.k1'));
    const sheet = screen.getByRole('dialog');
    expect(await within(sheet).findByText('Shorter caption')).toBeTruthy();
    // The link is text with Copy, never a link the shell would follow.
    expect(within(sheet).getByText('https://example.com/reel').closest('a')).toBeNull();
    expect(within(sheet).getByTestId('content.copy.2')).toBeTruthy();
    // The earlier round, folded, with what the owner asked then.
    expect(within(sheet).getByText('Earlier versions (1)')).toBeTruthy();
    // No edit control: the owner never changes the text.
    expect(within(sheet).queryByRole('textbox')).toBeNull();
    expect(within(sheet).queryByTestId('content.revise')).toBeNull();
    // Approval is final, so the button names the version it freezes.
    expect(within(sheet).getByTestId('content.decide.approve').textContent).toContain('Approve version 2');
    await user.click(within(sheet).getByTestId('content.decide.approve'));
    expect(calls.find((c) => c.fn === 'decide_content')?.args).toEqual({ p_id: 'k1', p_version: 2, p_decision: 'approve', p_note: null });
  });

  it('asks for a reason before sending a post back, and before declining it', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await user.click(await screen.findByTestId('content.item.k1'));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByText('Shorter caption');
    await user.click(within(sheet).getByTestId('content.decide.changes'));
    await user.click(within(sheet).getByTestId('content.decide.confirm'));
    expect(within(sheet).getByText('A reason is required.')).toBeTruthy();
    expect(calls.some((c) => c.fn === 'decide_content')).toBe(false);
    await user.type(within(sheet).getByTestId('content.decide.note'), 'Use the new logo');
    await user.click(within(sheet).getByTestId('content.decide.confirm'));
    expect(calls.find((c) => c.fn === 'decide_content')?.args).toEqual({ p_id: 'k1', p_version: 2, p_decision: 'changes', p_note: 'Use the new logo' });
  });

  it('declines with a red confirm', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await user.click(await screen.findByTestId('content.item.k1'));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByText('Shorter caption');
    await user.click(within(sheet).getByTestId('content.decide.decline'));
    await user.type(within(sheet).getByTestId('content.decide.note'), 'Off brand');
    const confirm = within(sheet).getByTestId('content.decide.confirm');
    expect(confirm.textContent).toContain('Decline post');
    await user.click(confirm);
    expect(calls.find((c) => c.fn === 'decide_content')?.args).toMatchObject({ p_decision: 'decline', p_note: 'Off brand' });
  });

  it('says so when nothing waits', async () => {
    item = header({ status: 'approved' });
    renderPanel('owner');
    expect(await screen.findByText('Nothing waiting for approval.')).toBeTruthy();
  });

  it('reads in Arabic', async () => {
    renderPanel('owner', 'ar');
    expect(await screen.findByText('محتوى بانتظار الموافقة')).toBeTruthy();
    expect(await screen.findByText('إنستغرام', { exact: false })).toBeTruthy();
  });
});

describe('marketing’s Content on /tasks', () => {
  it('sends a new post with a key minted when the form opened', async () => {
    const user = userEvent.setup();
    renderPanel('marketing');
    await user.click(await screen.findByTestId('content.new'));
    const form = screen.getByTestId('content.form');
    await user.click(within(form).getByTestId('content.form.submit'));
    expect(within(form).getAllByText('Fill this in.').length).toBeGreaterThanOrEqual(3);
    expect(calls.some((c) => c.fn === 'submit_content')).toBe(false);
    await user.type(within(form).getByTestId('content.form.title'), 'Ladies night');
    await user.click(within(form).getByRole('combobox', { name: 'Channel' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'TikTok' }));
    const day = within(form).getByLabelText(/Planned for/) as HTMLInputElement;
    await user.type(day, '2099-12-01');
    await user.type(within(form).getByTestId('content.form.body'), 'Every Thursday from 8');
    expect(within(form).getByText('Ask anyone recognisable in a photo before it is posted.')).toBeTruthy();
    await user.click(within(form).getByTestId('content.form.submit'));
    const sent = calls.find((c) => c.fn === 'submit_content')?.args;
    expect(sent).toMatchObject({ p_title: 'Ladies night', p_channel: 'tiktok', p_planned_for: '2099-12-01', p_body: 'Every Thursday from 8', p_images: [], p_media_link: null, p_note: null });
    expect(String(sent?.p_idempotency_key)).toMatch(/^content\.submit:/);
  });

  it('revises a post the owner sent back, sending only the header fields that changed', async () => {
    const user = userEvent.setup();
    item = header({ status: 'changes' });
    detailCan = { can_decide: false, can_revise: true, can_withdraw: true };
    renderPanel('marketing');
    // What waits on marketing leads: the section opens on Changes asked, with its count.
    expect(await screen.findByRole('button', { name: 'Changes asked (1)' })).toBeTruthy();
    await user.click(await screen.findByTestId('content.item.k1'));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByText('Shorter caption');
    expect(within(sheet).queryByTestId('content.decide.approve')).toBeNull();
    await user.click(within(sheet).getByTestId('content.revise'));
    const form = screen.getByTestId('content.form');
    expect((within(form).getByTestId('content.form.body') as HTMLTextAreaElement).value).toBe('Shorter caption');
    await user.type(within(form).getByTestId('content.form.body'), ' with the new logo');
    await user.click(within(form).getByTestId('content.form.submit'));
    const sent = calls.find((c) => c.fn === 'revise_content')?.args;
    expect(sent).toMatchObject({ p_id: 'k1', p_body: 'Shorter caption with the new logo', p_images: ['v1/campaigns/a.webp'], p_media_link: 'https://example.com/reel', p_title: null, p_channel: null, p_planned_for: null });
    expect(String(sent?.p_idempotency_key)).toMatch(/^content\.revise:/);
  });

  it('withdraws a post only after a red confirm', async () => {
    const user = userEvent.setup();
    detailCan = { can_decide: false, can_revise: true, can_withdraw: true };
    renderPanel('marketing');
    await user.click(await screen.findByTestId('content.item.k1'));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByText('Shorter caption');
    await user.click(within(sheet).getByTestId('content.withdraw'));
    expect(calls.some((c) => c.fn === 'withdraw_content')).toBe(false);
    await user.click(within(sheet).getByTestId('content.withdraw.confirm'));
    expect(calls.find((c) => c.fn === 'withdraw_content')?.args).toEqual({ p_id: 'k1' });
  });

  it('sends a closed post again as a new one, without its photos or its day', async () => {
    const user = userEvent.setup();
    item = header({ status: 'declined' });
    detailCan = { can_decide: false, can_revise: false, can_withdraw: false };
    renderPanel('marketing');
    await user.click(await screen.findByTestId('content.item.k1'));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findByText('Shorter caption');
    await user.click(within(sheet).getByTestId('content.again'));
    const form = screen.getByTestId('content.form');
    expect((within(form).getByTestId('content.form.title') as HTMLInputElement).value).toBe('Friday night padel');
    expect((within(form).getByLabelText(/Planned for/) as HTMLInputElement).value).toBe('');
  });
});
