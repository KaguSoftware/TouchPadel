/**
 * "Pin to Analytics" (plan §5.4 pinned components, DECIDE 13).
 *
 * A chat answer becomes a card: its question, the tools that answered it and
 * one fixed schema — a paragraph plus the figures it reported, each with a
 * label, a value and the page route it comes from. The card then regenerates
 * for whatever range the analytics page is on, through the same cache as the
 * built-ins. The button in the chat is the chat owner's; this is the call it
 * makes.
 */
import { appRpc } from '../../../lib/appRpc';
import type { ComponentScope } from './params';
import type { PinnedComponentRow } from './useAssistantComponent';

export interface PinFigure {
  label: string;
  value: string | number;
  route?: string | null;
}

export type PinTool = string | { name: string; args?: Record<string, unknown> | null };

export interface PinAnswerInput {
  /** The owner's question, as typed. */
  question: string;
  /** The tools the answer used (the sources row); range-like arguments are dropped, the rest become fixed arguments. */
  tools: readonly PinTool[];
  /** The figures the answer reported; their labels are written into the question so the card keeps reporting them. */
  figures: readonly PinFigure[];
  /** Which tab the card belongs to when it has one; both tabs render cards without a scope. */
  scope?: ComponentScope | null;
  /** Override the derived key (a stable slug of the question). */
  key?: string;
}

/** The schema every pinned card answers: the figures it reported, then one paragraph. */
export const PINNED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['figures', 'paragraph'],
  properties: {
    figures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value', 'route'],
        properties: { label: { type: 'string' }, value: { type: 'string' }, route: { type: 'string' } },
      },
    },
    paragraph: { type: 'string' },
  },
} as const;

/** Arguments the card supplies from the page; a pinned tool must not freeze them. */
const PAGE_ARGS = new Set(['from', 'to', 'compare', 'court', 'lang']);

const KEY_MAX = 64;

/** A 32-bit FNV-1a hash as 6 base-36 chars: enough to keep two similar questions apart. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, '0').slice(-6);
}

/** `pin_<first words>_<hash>`: lowercase letters, digits and underscores, ≤ 64 chars, as the RPC demands. */
export function pinKeyFor(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('_');
  const stem = words ? `pin_${words}` : 'pin';
  const hash = shortHash(question.trim().toLowerCase());
  return `${stem.slice(0, KEY_MAX - hash.length - 1)}_${hash}`.replace(/_+/g, '_');
}

/** `assistant_components.tools` entries: `name` or `name {"fixed":"args"}` with the page's arguments removed. */
export function toolEntries(tools: readonly PinTool[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    const name = typeof t === 'string' ? t : t.name;
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) continue;
    const args = typeof t === 'string' ? null : t.args ?? null;
    const fixed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args ?? {})) {
      if (PAGE_ARGS.has(k) || v === undefined || v === null) continue;
      fixed[k] = v;
    }
    const entry = Object.keys(fixed).length ? `${name} ${JSON.stringify(fixed)}` : name;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.slice(0, 12);
}

/** The stored question: the owner's words, then the figures the card must keep reporting. */
export function pinnedQuestion(question: string, figures: readonly PinFigure[]): string {
  const labels = [...new Set(figures.map((f) => f.label.trim()).filter(Boolean))].slice(0, 12);
  const q = question.trim();
  if (!labels.length) return `${q}\n\nAnswer for the range given, in one short paragraph, and list the figures you used with their page routes.`;
  return `${q}\n\nAnswer for the range given, in one short paragraph. Report these figures, each with its value and page route: ${labels.join('; ')}.`;
}

/** Store the pin (owner RPC). Re-pinning the same question replaces the card and revives it if archived. */
export async function pinAnswer(input: PinAnswerInput): Promise<PinnedComponentRow> {
  const tools = toolEntries(input.tools);
  if (!tools.length) throw new Error('PIN_NO_TOOLS');
  const row = await appRpc<PinnedComponentRow>('assistant_pin_component', {
    p_key: input.key ?? pinKeyFor(input.question),
    p_question: pinnedQuestion(input.question, input.figures),
    p_tools: tools,
    p_output_schema: PINNED_SCHEMA,
    p_default_params: input.scope ? { scope: input.scope } : {},
  });
  return row;
}

/** Remove a pinned card from the page (owner RPC; the chat answer is untouched). */
export function archivePinned(key: string): Promise<PinnedComponentRow> {
  return appRpc<PinnedComponentRow>('assistant_archive_component', { p_key: key });
}
