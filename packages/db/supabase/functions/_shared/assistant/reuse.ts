/**
 * Answer reuse (owner call 2026-10-09, cost): a question the owner already got
 * an answer to today is answered again without the model when nothing it
 * rested on has moved.
 *
 * The chat function (assistant-chat) does the I/O; this file decides, purely:
 *
 *   which question   the same words (normalizeQuestion), asked as the FIRST
 *                    message of a chat that was itself started by the same
 *                    words, with the same scopes and branch in scope: a
 *                    follow-up ("and yesterday?") means something only beside
 *                    its history, so it is never matched;
 *   which answer     planReuse: the stored reply is from today's business day
 *                    (venue clock), whole (not cost-capped, not an error
 *                    placeholder, not a refused scope), its gate verdict was ok
 *                    and it kept a figure baseline, and every tool behind it
 *                    is a known read-only one (no web search, no job proposal,
 *                    no failed call);
 *   still true       the chat re-runs those tools (the re-check, recheck.ts
 *                    diffNumbers): a figure the answer printed that is no
 *                    longer in the data, or any tool that failed, means a
 *                    normal turn with the model.
 *
 * Pure: no Deno, no npm.
 */
import { localDate } from './scopes.ts';

/** A question shorter than this (after normalising) is never matched. */
export const REUSE_MIN_CHARS = 6;

/** The question's words, case- and punctuation-free, one space between: two askings of the same thing compare equal. */
export function normalizeQuestion(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function reusableQuestion(text: string): boolean {
  return normalizeQuestion(text).length >= REUSE_MIN_CHARS;
}

export interface StoredReply {
  content: unknown;
  sources: unknown;
  gate: unknown;
  tokens: unknown;
  created_at: unknown;
}

export interface ReuseItem {
  name: string;
  args: Record<string, unknown>;
}

export interface ReusePlan {
  /** The stored answer's text, as the owner read it. */
  text: string;
  /** Every stored source row, shown again beside the reused answer. */
  sources: Record<string, unknown>[];
  /** The data tools to run again (knowledge tools carry no figures). */
  rerun: ReuseItem[];
  /** The stored figure baseline (gate.numbers). */
  numbers: number[];
  /** The stored gate verdict. */
  gate: { status: 'ok' | 'unverified'; unverified: { raw: string; value: number }[]; checked: number };
}

/** The tools a reused answer may rest on, by kind; anything else (web_search, propose_job, unknown) refuses reuse. */
export type ToolClass = 'data' | 'knowledge' | null;

function textOf(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as { type?: string; text?: unknown }[]) : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function sourceRows(sources: unknown): Record<string, unknown>[] {
  const list = Array.isArray(sources) ? sources : sources && typeof sources === 'object' && Array.isArray((sources as { items?: unknown }).items) ? (sources as { items: unknown[] }).items : [];
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' && !('job_id' in (x as object)));
}

/** Null when this reply may not be reused; otherwise what to re-run and what to show. */
export function planReuse(reply: StoredReply, o: { today: string; tz: string; classify: (toolName: string) => ToolClass }): ReusePlan | null {
  const created = typeof reply.created_at === 'string' ? Date.parse(reply.created_at) : Number.NaN;
  if (!Number.isFinite(created)) return null;
  if (localDate(new Date(created), o.tz) !== o.today) return null;

  const tokens = reply.tokens && typeof reply.tokens === 'object' ? (reply.tokens as { cost_capped?: unknown }) : {};
  if (tokens.cost_capped === true) return null;

  const text = textOf(reply.content).trim();
  // An error placeholder is stored as "[CODE] message"; a scope refusal says the context is off.
  if (!text || text.startsWith('[') || /context is off for this chat|مغلق لهذ/i.test(text)) return null;

  const gate = reply.gate && typeof reply.gate === 'object' ? (reply.gate as { status?: unknown; unverified?: unknown; checked?: unknown; numbers?: unknown }) : null;
  if (!gate || gate.status !== 'ok' || !Array.isArray(gate.numbers)) return null;
  const numbers = gate.numbers.filter((n): n is number => typeof n === 'number');

  const rows = sourceRows(reply.sources);
  if (rows.length === 0) return null;
  const rerun: ReuseItem[] = [];
  for (const r of rows) {
    if (typeof r.error === 'string' && r.error) return null;
    const cls = o.classify(String(r.name));
    if (cls === null) return null;
    if (cls === 'data') rerun.push({ name: String(r.name), args: r.args && typeof r.args === 'object' && !Array.isArray(r.args) ? (r.args as Record<string, unknown>) : {} });
  }
  return {
    text,
    sources: rows,
    rerun,
    numbers,
    gate: { status: 'ok', unverified: [], checked: typeof gate.checked === 'number' ? gate.checked : 0 },
  };
}

/** The line appended to a reused answer: when it was written and that the figures were checked again. */
export function reuseNote(lang: 'en' | 'ar', writtenAt: Date, tz: string): string {
  let hhmm = '';
  try {
    hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(writtenAt);
  } catch {
    hhmm = writtenAt.toISOString().slice(11, 16);
  }
  return lang === 'ar' ? `\n\n(نفس الأرقام من ${hhmm}، وتم التحقق منها الآن.)` : `\n\n(Same figures as at ${hhmm}, checked again just now.)`;
}
