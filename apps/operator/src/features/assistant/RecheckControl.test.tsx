import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { Message } from './Message';
import { hasRecheckableTools, rawsForValues } from './RecheckControl';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

// The control talks to the chat function through the data layer; no session in a unit test.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recheckMessage: vi.fn(),
}));

import { recheckMessage } from './api';

const recheck = vi.mocked(recheckMessage);

const TOOLS = [{ call_id: 'c1', name: 'panel_headline', args: { from: '2026-09-01', to: '2026-09-07' }, row_count: 14, ms: 120, route: '/panel' }];
const KNOWLEDGE_ONLY = [{ call_id: 'c1', name: 'page_lookup', args: { route: '/admin' }, row_count: 1, ms: 5, route: null }];

function renderIn(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

/** The result line wraps numbers in bidi isolates; strip them so the sentence can be read as text. */
function plain(el: Element | null): string {
  return (el?.textContent ?? '').replace(/[\u2068\u2069]/g, '');
}

describe('RecheckControl', () => {
  it('re-runs the tools on press and marks the changed figures in the text', async () => {
    recheck.mockResolvedValue({
      message_id: 'm1',
      checked_at: '2026-09-20T10:00:00Z',
      tools: [{ name: 'panel_headline', args: {}, row_count: 14, ms: 90 }],
      changed: [{ value_then: 228_000, value_now: 231_500 }, { value_then: 12.5 }],
      unchanged: 1,
      baseline: true,
    });
    renderIn(<Message role="assistant" messageId="m1" text="Revenue 228,000 IQD from 300 orders; margin 12.5%." tools={TOOLS} />);
    expect(document.querySelector('mark')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check figures still hold' }));
    await waitFor(() => expect(document.querySelector('[data-recheck-result]')).toBeTruthy());
    expect(recheck).toHaveBeenCalledWith('m1');
    const line = plain(document.querySelector('[data-recheck-result="changed"]'));
    expect(line).toContain('2 figures changed since this was written');
    expect(line).toContain('228,000 → 231,500');
    expect(line).toContain('12.5 (no longer in the data)');
    const marks = [...document.querySelectorAll('mark[data-changed]')];
    expect(marks.map((m) => m.textContent)).toEqual(['228,000', '12.5%']);
    expect(marks[0]!.getAttribute('title')).toBe('This figure has changed since this answer was written.');
    expect(document.querySelector('mark[data-unverified]')).toBeNull();
    // 300 held: not marked.
    expect(screen.getByText(/from 300 orders/)).toBeTruthy();
  });

  it('says every figure holds when nothing changed', async () => {
    recheck.mockResolvedValue({ message_id: 'm2', checked_at: '2026-09-20T10:00:00Z', tools: [], changed: [], unchanged: 6, baseline: true });
    renderIn(<Message role="assistant" messageId="m2" text="Cash 800." tools={TOOLS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check figures still hold' }));
    await waitFor(() => expect(document.querySelector('[data-recheck-result="hold"]')).toBeTruthy());
    expect(plain(document.querySelector('[data-recheck-result]'))).toContain('All 6 figures still hold.');
    expect(document.querySelector('mark')).toBeNull();
  });

  it('explains a message saved before figures were recorded and names a tool that failed', async () => {
    recheck.mockResolvedValue({
      message_id: 'm3',
      checked_at: '2026-09-20T10:00:00Z',
      tools: [{ name: 'panel_headline', args: {}, row_count: null, ms: 10, error: '42501: forbidden' }],
      changed: [],
      unchanged: 0,
      baseline: false,
    });
    renderIn(<Message role="assistant" messageId="m3" text="Cash 800." tools={TOOLS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check figures still hold' }));
    await waitFor(() => expect(document.querySelector('[data-recheck-result]')).toBeTruthy());
    const line = plain(document.querySelector('[data-recheck-result]'));
    expect(line).toContain('saved before figures were recorded');
    expect(line).toContain('panel_headline could not be re-read.');
  });

  it('shows the failure sentence when the call itself fails', async () => {
    recheck.mockRejectedValue(new Error('boom'));
    renderIn(<Message role="assistant" messageId="m4" text="Cash 800." tools={TOOLS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check figures still hold' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('could not be re-checked');
  });

  it('is absent without a stored id, while streaming, or when only knowledge tools ran', () => {
    renderIn(<Message role="assistant" text="Cash 800." tools={TOOLS} />);
    renderIn(<Message role="assistant" messageId="m5" text="Cash 800." tools={TOOLS} streaming />);
    renderIn(<Message role="assistant" messageId="m6" text="It is under Admin." tools={KNOWLEDGE_ONLY} />);
    expect(screen.queryByRole('button', { name: 'Check figures still hold' })).toBeNull();
  });
});

describe('hasRecheckableTools', () => {
  it('needs one successful business read', () => {
    expect(hasRecheckableTools(TOOLS)).toBe(true);
    expect(hasRecheckableTools(KNOWLEDGE_ONLY)).toBe(false);
    expect(hasRecheckableTools([{ ...TOOLS[0]!, error: 'Scope "money" is off for this chat' }])).toBe(false);
    expect(hasRecheckableTools([{ call_id: 'p', name: 'posthog', args: { template: 'funnel', from: '2026-09-01', to: '2026-09-07' }, row_count: 4, ms: 300, route: '/analytics/cafe' }])).toBe(true);
  });
});

describe('rawsForValues', () => {
  it('finds the printed token for a value, in either digit set, and not its substrings', () => {
    expect(rawsForValues('Total 228,000 IQD and 1,228,000 later; ٢٢٨٬٠٠٠ again', [228_000])).toEqual(['228,000', '٢٢٨٬٠٠٠']);
    expect(rawsForValues('Margin 12.5% on 12 items', [12.5])).toEqual(['12.5%']);
    expect(rawsForValues('r12 and phone#3', [12, 3])).toEqual([]);
  });
});
