import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { Message } from './Message';
import { hasPinnableTools, scopeForPin } from './PinControl';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

// The pin is an owner RPC through the analytics components' helper; no session in a unit test.
vi.mock('../analytics/components/pin', () => ({ pinAnswer: vi.fn() }));

import { pinAnswer } from '../analytics/components/pin';

const pin = vi.mocked(pinAnswer);

const TOOLS = [
  { call_id: 'c1', name: 'panel_headline', args: { from: '2026-09-01', to: '2026-09-07', compare: 'previousPeriod' }, row_count: 13, ms: 12, route: '/panel' },
  { call_id: 'c2', name: 'page_lookup', args: { route: '/panel' }, row_count: 1, ms: 2, route: null },
  { call_id: 'c3', name: 'report_cafe', args: { from: '2026-09-01', to: '2026-09-07' }, row_count: 0, ms: 9, route: '/reports/cafe', error: 'timeout' },
];
const KNOWLEDGE_ONLY = [{ call_id: 'c1', name: 'search', args: { query: 'x' }, row_count: 3, ms: 5, route: null }];

function renderIn(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe('PinControl', () => {
  it('pins the question with the successful business tools and the cafe scope', async () => {
    pin.mockResolvedValue({ key: 'pin_x' } as never);
    renderIn(<Message role="assistant" messageId="m1" question="How much did the cafe make last week?" text="Cafe made 48,000 IQD." tools={TOOLS} scopes={['cafe', 'howto']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin to Analytics' }));
    await waitFor(() => expect(document.querySelector('[data-pin-result="done"]')).toBeTruthy());
    expect(pin).toHaveBeenCalledTimes(1);
    const input = pin.mock.calls[0]![0];
    expect(input.question).toBe('How much did the cafe make last week?');
    // The failed report_cafe call is left out; the knowledge lookup is passed through (pin.ts drops non-business names itself).
    expect(input.tools.map((t) => (typeof t === 'string' ? t : t.name))).toEqual(['panel_headline', 'page_lookup']);
    expect(input.scope).toBe('cafe');
    expect((screen.getByRole('button', { name: 'Pinned' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the pin fails, and stays pressable', async () => {
    pin.mockRejectedValue(new Error('PIN_NO_TOOLS'));
    renderIn(<Message role="assistant" messageId="m1" question="q" text="t" tools={TOOLS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin to Analytics' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Pin to Analytics' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('is absent without a question, on a job answer, while streaming, or with knowledge-only tools', () => {
    renderIn(<Message role="assistant" messageId="m1" text="t" tools={TOOLS} />);
    expect(screen.queryByRole('button', { name: 'Pin to Analytics' })).toBeNull();
    renderIn(<Message role="assistant" messageId="m2" question="q" fromJob text="t" tools={TOOLS} />);
    expect(screen.queryByRole('button', { name: 'Pin to Analytics' })).toBeNull();
    renderIn(<Message role="assistant" messageId="m3" question="q" streaming text="t" tools={TOOLS} />);
    expect(screen.queryByRole('button', { name: 'Pin to Analytics' })).toBeNull();
    renderIn(<Message role="assistant" messageId="m4" question="q" text="t" tools={KNOWLEDGE_ONLY} />);
    expect(screen.queryByRole('button', { name: 'Pin to Analytics' })).toBeNull();
  });

  it('helpers: pinnable needs one successful business read; the scope follows the side the answer read', () => {
    expect(hasPinnableTools(TOOLS)).toBe(true);
    expect(hasPinnableTools(KNOWLEDGE_ONLY)).toBe(false);
    expect(hasPinnableTools([TOOLS[2]!])).toBe(false);
    expect(scopeForPin(['cafe'])).toBe('cafe');
    expect(scopeForPin(['courts', 'howto'])).toBe('courts');
    expect(scopeForPin(['cafe', 'courts'])).toBeNull();
    expect(scopeForPin(null)).toBeNull();
  });
});
