/**
 * Answer reuse (reuse.ts, 2026-10-09): which question matches, which stored
 * reply may be shown again. The I/O (finding the chat, re-running the tools,
 * comparing figures) is assistant-chat's; these are the pure decisions.
 */
import { describe, it, expect } from 'vitest';
import { normalizeQuestion, planReuse, reusableQuestion, reuseNote, type StoredReply, type ToolClass } from '../supabase/functions/_shared/assistant/reuse';
import { previousTurnOf } from '../supabase/functions/_shared/assistant/turnPolicy';

const TZ = 'Asia/Baghdad';
const TODAY = '2026-10-09';
const classify = (name: string): ToolClass => (name === 'panel_headline' || name === 'report_revenue' ? 'data' : name === 'search' ? 'knowledge' : null);
const reply = (over: Partial<StoredReply> = {}): StoredReply => ({
  content: [{ type: 'text', text: 'Shit week. 12,450,000 IQD (panel_headline).' }],
  sources: [{ call_id: 'a', name: 'panel_headline', args: { from: '2026-10-02', to: '2026-10-09' }, row_count: 22, ms: 10, route: '/panel', stats: null }],
  gate: { status: 'ok', unverified: [], checked: 1, numbers: [12450000], sig: 'x' },
  tokens: { cost_micros: 1000 },
  created_at: '2026-10-09T08:00:00Z',
  ...over,
});
const plan = (r: StoredReply) => planReuse(r, { today: TODAY, tz: TZ, classify });

describe('normalizeQuestion', () => {
  it('ignores case, punctuation and spacing; keeps Arabic', () => {
    expect(normalizeQuestion('  How MUCH did we make today?! ')).toBe('how much did we make today');
    expect(normalizeQuestion('how much did we make today')).toBe(normalizeQuestion('How much did we make today?'));
    expect(normalizeQuestion('كم ربحنا اليوم؟')).toBe('كم ربحنا اليوم');
  });
  it('a very short question is never matched', () => {
    expect(reusableQuestion('hi')).toBe(false);
    expect(reusableQuestion('revenue?')).toBe(true);
  });
});

describe('planReuse', () => {
  it('a whole, gated, same-day answer on data tools is reusable and lists the tools to re-run', () => {
    const p = plan(reply());
    expect(p).not.toBeNull();
    expect(p!.rerun).toEqual([{ name: 'panel_headline', args: { from: '2026-10-02', to: '2026-10-09' } }]);
    expect(p!.numbers).toEqual([12450000]);
    expect(p!.text).toContain('12,450,000');
  });
  it('knowledge tools are shown again but not re-run', () => {
    const p = plan(reply({ sources: [{ call_id: 's', name: 'search', args: { query: 'x' }, row_count: 3, ms: 1, route: null, stats: null }] }));
    expect(p).not.toBeNull();
    expect(p!.rerun).toEqual([]);
  });
  it('refuses yesterday, a cost-capped turn, an error placeholder and a scope refusal', () => {
    expect(plan(reply({ created_at: '2026-10-08T08:00:00Z' }))).toBeNull();
    expect(plan(reply({ tokens: { cost_capped: true } }))).toBeNull();
    expect(plan(reply({ content: [{ type: 'text', text: '[TIMEOUT] The answer took too long.' }] }))).toBeNull();
    expect(plan(reply({ content: [{ type: 'text', text: 'Money context is off for this chat.' }] }))).toBeNull();
  });
  it('refuses an unverified gate, a missing figure baseline and no tools at all', () => {
    expect(plan(reply({ gate: { status: 'unverified', unverified: [{ raw: '9', value: 9 }], checked: 1, numbers: [1] } }))).toBeNull();
    expect(plan(reply({ gate: { status: 'ok', unverified: [], checked: 0 } }))).toBeNull();
    expect(plan(reply({ gate: null }))).toBeNull();
    expect(plan(reply({ sources: [] }))).toBeNull();
  });
  it('refuses an answer resting on a web search, a job proposal, an unknown tool or a failed call', () => {
    const src = (name: string, extra: object = {}) => ({ call_id: 'a', name, args: {}, row_count: null, ms: 1, route: null, stats: null, ...extra });
    expect(plan(reply({ sources: [src('panel_headline'), src('web_search')] }))).toBeNull();
    expect(plan(reply({ sources: [src('propose_job')] }))).toBeNull();
    expect(plan(reply({ sources: [src('mystery_tool')] }))).toBeNull();
    expect(plan(reply({ sources: [src('panel_headline', { error: 'boom' })] }))).toBeNull();
  });
});

describe('reuse note and warm cache', () => {
  it('the note names the time written and says the figures were checked again, in the owner language', () => {
    expect(reuseNote('en', new Date('2026-10-09T11:05:00Z'), TZ)).toContain('14:05');
    expect(reuseNote('ar', new Date('2026-10-09T11:05:00Z'), TZ)).toContain('14:05');
  });
  it('a reused answer warmed no cache: previousTurnOf ignores it', () => {
    const t = { model: 'claude-sonnet-5-5', effort: 'low' };
    expect(previousTurnOf({ tokens: t, created_at: '2026-10-09T08:00:00Z' })).not.toBeNull();
    expect(previousTurnOf({ tokens: { ...t, reused_from: 'abc' }, created_at: '2026-10-09T08:00:00Z' })).toBeNull();
  });
});
