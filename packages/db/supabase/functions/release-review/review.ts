/**
 * release-review, the pure half (build-contracts-2026-09-23 §2.20, §2.10; plan
 * §5.1 "Post-launch"): the day-30 review of a released item, written from
 * app.release_review_input and nothing else.
 *
 * Taken from analytics-insights, and only this: the number gate (a sentence
 * citing an IQD amount the input does not contain is dropped,
 * `collectAmounts` + `dropUncitedAmounts`), the templated fallback when there
 * is no model or no budget, and the metering (index.ts). The model follows
 * the venue's llm_default_model (Q13), through `_shared/assistant/provider.ts`.
 *
 *   thin      fewer than MIN_ITEM_UNITS units: the template says there is not
 *             enough data yet; no model call.
 *   written   the model's {en, ar}, gated; a campaign effect is claimed only
 *             when the launch campaign carried a promotion.
 *   fallback  no key, the cap reached, the model failing, or a write-up the
 *             gate emptied: the template.
 *   failed    the input could not be read or the save failed; nothing is
 *             saved as done, so the next day's tick tries again.
 *
 * No Deno, no I/O: the DB vitest suite runs it (tests/release-review.test.ts).
 */
import { MIN_ITEM_UNITS } from '../_shared/insightsContract.ts';
import { collectAmounts } from '../_shared/insightsGate.ts';
import { dropUncitedAmounts } from '../_shared/insightsText.ts';

export { MIN_ITEM_UNITS };

export interface BoughtWith {
  item_id: string;
  name_en: string;
  name_ar: string;
  count: number;
}

export interface ReviewNumbers {
  units: number;
  revenue_iqd: number;
  margin_iqd: number | null;
  margin_pct: number | null;
  category_share_pct: number | null;
  days_sold: number;
  bought_with: BoughtWith[];
  from: string;
  to: string;
}

/** app.release_review_input, as it crosses the wire. */
export interface ReviewInput {
  item: { name_en: string; name_ar: string };
  numbers: ReviewNumbers;
  notes: string[];
  marketing_take: string[];
  campaign_has_promotion: boolean;
}

export interface WriteUp {
  en: string;
  ar: string;
}

export type ReviewStatus = 'written' | 'thin' | 'fallback' | 'failed';

export const REVIEW_MAX_TOKENS = 1500;
/** Characters per language kept from the model. */
export const WRITE_UP_MAX = 2000;
export const REVIEW_SURFACE = 'release_review';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

/** The input, read defensively: a key missing from the JSON never throws here. */
export function readInput(raw: unknown): ReviewInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (r.numbers ?? null) as Record<string, unknown> | null;
  if (!n || typeof n !== 'object') return null;
  const item = (r.item ?? {}) as Record<string, unknown>;
  return {
    item: { name_en: str(item.name_en), name_ar: str(item.name_ar) },
    numbers: {
      units: num(n.units),
      revenue_iqd: num(n.revenue_iqd),
      margin_iqd: numOrNull(n.margin_iqd),
      margin_pct: numOrNull(n.margin_pct),
      category_share_pct: numOrNull(n.category_share_pct),
      days_sold: num(n.days_sold),
      bought_with: (Array.isArray(n.bought_with) ? n.bought_with : []).flatMap((b) => {
        const x = (b ?? {}) as Record<string, unknown>;
        return typeof x.item_id === 'string'
          ? [{ item_id: x.item_id, name_en: str(x.name_en), name_ar: str(x.name_ar), count: num(x.count) }]
          : [];
      }),
      from: str(n.from),
      to: str(n.to),
    },
    notes: texts(r.notes),
    marketing_take: texts(r.marketing_take),
    campaign_has_promotion: r.campaign_has_promotion === true,
  };
}

export function isThin(input: ReviewInput): boolean {
  return input.numbers.units < MIN_ITEM_UNITS;
}

// Latin digits in both languages; IQD has no decimals.
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
const nameEn = (i: ReviewInput) => i.item.name_en || i.item.name_ar || 'The new item';
const nameAr = (i: ReviewInput) => i.item.name_ar || i.item.name_en || 'الصنف الجديد';

/** The review from the numbers alone: the thin notice, or the fallback when the model is not used. */
export function templateWriteUp(input: ReviewInput, thin: boolean): WriteUp {
  const n = input.numbers;
  if (thin) {
    return {
      en:
        `${nameEn(input)} sold ${fmt(n.units)} in its first 30 days. ` +
        `That is not enough data yet for a review: it needs at least ${MIN_ITEM_UNITS} sold.`,
      ar:
        `باع ${nameAr(input)} ${fmt(n.units)} في أول 30 يوماً. ` +
        `هذه بيانات غير كافية بعد للمراجعة: تحتاج إلى ${MIN_ITEM_UNITS} على الأقل.`,
    };
  }
  const en: string[] = [
    `${nameEn(input)} sold ${fmt(n.units)} in its first 30 days (${n.from} to ${n.to}), on ${fmt(n.days_sold)} days, for ${fmt(n.revenue_iqd)} IQD.`,
  ];
  const ar: string[] = [
    `باع ${nameAr(input)} ${fmt(n.units)} في أول 30 يوماً (${n.from} إلى ${n.to})، في ${fmt(n.days_sold)} يوماً، بإيراد ${fmt(n.revenue_iqd)} د.ع.`,
  ];
  if (n.margin_iqd !== null) {
    const pct = n.margin_pct !== null ? ` (${n.margin_pct}%)` : '';
    en.push(`Its margin was ${fmt(n.margin_iqd)} IQD${pct}.`);
    ar.push(`بلغ هامشه ${fmt(n.margin_iqd)} د.ع${pct}.`);
  } else {
    en.push('Its cost is not known yet, so there is no margin to report.');
    ar.push('كلفته غير معروفة بعد، لذلك لا يوجد هامش لعرضه.');
  }
  if (n.category_share_pct !== null) {
    en.push(`That is ${n.category_share_pct}% of the units sold in its category.`);
    ar.push(`وهذا ${n.category_share_pct}% من الوحدات المباعة في فئته.`);
  }
  const pair = n.bought_with[0];
  if (pair && pair.count > 0) {
    en.push(`It was bought most often with ${pair.name_en || pair.name_ar} (${fmt(pair.count)} orders).`);
    ar.push(`وأكثر ما طُلب معه ${pair.name_ar || pair.name_en} (${fmt(pair.count)} طلبات).`);
  }
  const notes = input.notes.length + input.marketing_take.length;
  if (notes > 0) {
    en.push(`Staff and marketing left ${fmt(notes)} notes on it; read them on the run.`);
    ar.push(`ترك الموظفون والتسويق ${fmt(notes)} ملاحظات عليه؛ اقرأها في صفحة البروتوكول.`);
  }
  return { en: en.join(' '), ar: ar.join(' ') };
}

export const REVIEW_SYSTEM = [
  'You write the day-30 review of a new menu item for the owner and the managers of a cafe.',
  'You receive one JSON object and nothing else: the item names (item), the figures of its first 30 days on sale (numbers),',
  'notes staff wrote about it (notes, each one person’s remark, sometimes quoting customers), marketing’s own take',
  '(marketing_take), and campaign_has_promotion.',
  'Write a short review of 3 to 6 sentences in English (en) and the same review in Arabic (ar).',
  'Rules:',
  '- Use only figures that appear in numbers, exactly as given. Never compute a new figure: no totals, per-day averages,',
  '  projections, or percentages that are not given. Write money as digits followed by IQD (en) or د.ع (ar).',
  '- Say how it sold (units, days_sold), what it earned (revenue_iqd, and margin_iqd with margin_pct when they are not null;',
  '  when margin_iqd is null say the cost is not known yet), how it compares with its category (category_share_pct),',
  '  and what it sells with (bought_with).',
  '- Summarise what the notes and marketing’s take say, in your own words. Never name or describe a person.',
  '- Claim an effect of a marketing campaign only when campaign_has_promotion is true.',
  '- Answer with the JSON object {"en": ..., "ar": ...} only.',
].join('\n');

/** The one user turn: the input, as JSON. Nothing else reaches the model. */
export function reviewUserTurn(input: ReviewInput): string {
  return JSON.stringify(input);
}

/** The structured output the model returns. */
export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { en: { type: 'string' }, ar: { type: 'string' } },
  required: ['en', 'ar'],
  additionalProperties: false,
};

export function parseWriteUp(raw: string): WriteUp | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try {
      v = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const en = typeof o.en === 'string' ? o.en.trim() : '';
  const ar = typeof o.ar === 'string' ? o.ar.trim() : '';
  return en && ar ? { en: en.slice(0, WRITE_UP_MAX), ar: ar.slice(0, WRITE_UP_MAX) } : null;
}

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?؟])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const CAMPAIGN_CLAIM = /\bcampaign|\bpromotion|\bpromo\b|حمل[ةت]|الحمل[ةت]|ترويج|العرض الترويجي/iu;

/**
 * The gate. Every sentence citing an IQD amount the input does not contain is
 * dropped (analytics-insights' rule), and so is a campaign claim when the
 * launch campaign carried no promotion. A language left empty fails the
 * write-up, and the caller falls back to the template.
 */
export function gateWriteUp(w: WriteUp, input: ReviewInput): { writeUp: WriteUp | null; dropped: number } {
  const amounts = collectAmounts(input);
  let dropped = 0;
  const gate = (text: string): string => {
    const all = sentencesOf(text);
    let kept = dropUncitedAmounts(all, amounts).kept;
    if (!input.campaign_has_promotion) kept = kept.filter((s) => !CAMPAIGN_CLAIM.test(s));
    dropped += all.length - kept.length;
    return kept.join(' ');
  };
  const en = gate(w.en);
  const ar = gate(w.ar);
  return { writeUp: en && ar ? { en, ar } : null, dropped };
}

export interface Usage {
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
}

export interface ReviewWriter {
  model: string;
  write(system: string, user: string): Promise<{ raw: string; usage: Usage; stop_reason: string }>;
}

export interface DueReview {
  run_id: string;
  venue_id: string;
}

export interface ReviewPorts {
  dueReviews(): Promise<DueReview[]>;
  /** app.release_review_input (service role). */
  input(runId: string): Promise<unknown>;
  /** The run venue's llm_default_model, venue-qualified. */
  modelFor(venueId: string): Promise<string | null>;
  /** The provider for that model; null when its vendor has no key. */
  writer(model: string | null): ReviewWriter | null;
  /** app.llm_begin_request: throws LLM_DAILY_QUOTA / LLM_MONTHLY_CAP. */
  beginRequest(): Promise<void>;
  recordUsage(model: string, usage: Usage): Promise<void>;
  /** app.release_review_save. Throws on a refusal. */
  save(runId: string, numbers: ReviewNumbers, writeUp: WriteUp | null, status: ReviewStatus, model: string | null): Promise<void>;
  log(message: string): void;
}

export interface ReviewTickResult {
  written: number;
  thin: number;
  fallback: number;
  failed: number;
}

/** One review: thin, written or fallback; what it saved. */
export async function reviewOne(due: DueReview, ports: ReviewPorts): Promise<Exclude<ReviewStatus, 'failed'>> {
  const input = readInput(await ports.input(due.run_id));
  if (!input) throw new Error('release_review_input returned no numbers');

  if (isThin(input)) {
    await ports.save(due.run_id, input.numbers, templateWriteUp(input, true), 'thin', null);
    return 'thin';
  }

  const writer = ports.writer(await ports.modelFor(due.venue_id));
  let writeUp: WriteUp | null = null;
  let model: string | null = null;
  if (writer) {
    let usage: Usage | null = null;
    try {
      await ports.beginRequest();
      const answer = await writer.write(REVIEW_SYSTEM, reviewUserTurn(input));
      usage = answer.usage;
      const parsed = answer.stop_reason === 'refusal' ? null : parseWriteUp(answer.raw);
      const gated = parsed ? gateWriteUp(parsed, input) : { writeUp: null, dropped: 0 };
      if (gated.dropped > 0) ports.log(`review ${due.run_id}: the gate dropped ${gated.dropped} sentence(s)`);
      if (gated.writeUp) {
        writeUp = gated.writeUp;
        model = writer.model;
      }
    } catch (e) {
      ports.log(`review ${due.run_id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Spent is spent: a call that answered badly still counts under the cap.
      if (usage) await ports.recordUsage(writer.model, usage);
    }
  }

  const status = writeUp ? 'written' : 'fallback';
  await ports.save(due.run_id, input.numbers, writeUp ?? templateWriteUp(input, false), status, model);
  return status;
}

/** The daily tick: every due review, one at a time; one bad run never stops the others. */
export async function reviewTick(ports: ReviewPorts): Promise<ReviewTickResult> {
  const out: ReviewTickResult = { written: 0, thin: 0, fallback: 0, failed: 0 };
  for (const due of await ports.dueReviews()) {
    try {
      out[await reviewOne(due, ports)] += 1;
    } catch (e) {
      out.failed += 1;
      ports.log(`review ${due.run_id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
