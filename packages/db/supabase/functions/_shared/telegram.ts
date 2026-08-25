/**
 * telegram — PURE rendering / keyboard / callback helpers for the Telegram
 * staff-group functions (`telegram-send`, `telegram-callback`).
 *
 * No `Deno.*`, no supabase-js, no fetch: this module runs unchanged under
 * Deno (edge functions) and under vitest (tests/telegram-render.test.ts), so
 * the exact message text is unit-tested. The Bot API transport lives in the
 * functions themselves (`tg()` in each index.ts).
 *
 * Templates are VERBATIM from docs/design/cafe-rebuild/db-slice.md "Wave 4"
 * (Arabic-first bilingual). Every user-provided string goes through `esc`.
 * Payload shapes come from migration 0032: app.telegram_order_payload,
 * app.telegram_call_payload and the {sent_by, at} test snapshot.
 */

export type Lang = 'ar' | 'en';
export type OutboxKind = 'order_new' | 'waiter_call' | 'test';
export type Action = 'o:seen' | 'o:served' | 'o:void' | 'w:ack' | 'w:done';
export type ApplyResult = 'applied' | 'duplicate' | 'invalid' | 'not_found' | 'refused';
export type OrderStage = 'new' | 'order_seen' | 'order_final';
export type CallStage = 'new' | 'call_acked' | 'call_final';
export type KeyboardStage = OrderStage | CallStage | 'unchanged';

export interface OrderPayloadModifier {
  name_en: string;
  name_ar: string;
  qty: number;
}
export interface OrderPayloadItem {
  order_item_id?: string;
  qty: number;
  name_en: string;
  name_ar: string;
  variant_en: string | null;
  variant_ar: string | null;
  variant_count: number;
  modifiers: OrderPayloadModifier[] | null;
  notes: string | null;
  line_total_iqd?: number;
  discount_pct?: number;
}
export interface OrderPayload {
  order_id: string;
  short_id: string;
  table_number: string | null;
  placed_at: string;
  source?: string;
  total_iqd: number;
  items: OrderPayloadItem[];
}
export interface CallPayload {
  call_id: string;
  table_number: string | null;
  reason: 'order' | 'bill' | 'water' | 'assistance' | string;
  raised_at: string;
}
export interface TestPayload {
  sent_by: string;
  at: string;
}

/** Telegram inline keyboard (`reply_markup`). */
export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** Hard Bot API limit is 4096 chars; we stay under 4000 to leave room for the status footer. */
export const MESSAGE_BUDGET = 4000;

const RULE = '────────────';
const TABLE_UNKNOWN = '—';

/** HTML-escape for Telegram `parse_mode: 'HTML'` — only `& < >` are significant. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Integer IQD with Latin digits and a `,` thousands separator: 12500 -> "12,500". */
export function fmtIqd(n: number | string | null | undefined): string {
  const v = Math.trunc(Number(n ?? 0));
  if (!Number.isFinite(v)) return '0';
  const sign = v < 0 ? '-' : '';
  const digits = String(Math.abs(v));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `HH:mm` (24h, Latin digits) in the venue timezone. Invalid input -> "--:--". */
export function fmtTime(iso: string | Date | null | undefined, tz = 'Asia/Baghdad'): string {
  const d = iso instanceof Date ? iso : new Date(iso ?? NaN);
  if (Number.isNaN(d.getTime())) return '--:--';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // hourCycle h23 still yields "24" on some ICU builds at midnight; normalise.
  const hh = get('hour') === '24' ? '00' : get('hour');
  return `${hh}:${get('minute')}`;
}

function pick(lang: Lang, ar: string | null | undefined, en: string | null | undefined): string {
  const a = ar ?? '';
  const e = en ?? '';
  return lang === 'en' ? (e || a) : (a || e);
}

function tableLine(table: string | null | undefined): string {
  const t = table ? esc(table) : TABLE_UNKNOWN;
  return `🪑 <b>طاولة ${t}</b> · Table ${t}`;
}

/**
 * One item block: the item line plus an optional `📝 «notes»` line.
 * `{qty}× {name_ar} / {name_en}{ · variant}{ · modifiers}` — the variant only
 * when the item has more than one variant; modifiers with qty>1 as `name ×2`.
 * Item names are always bilingual; variant/modifier fragments follow `lang`.
 */
export function renderItemLine(item: OrderPayloadItem, lang: Lang): string {
  const frags: string[] = [];
  if ((item.variant_count ?? 0) > 1) {
    const v = pick(lang, item.variant_ar, item.variant_en);
    if (v) frags.push(esc(v));
  }
  for (const m of item.modifiers ?? []) {
    const name = esc(pick(lang, m.name_ar, m.name_en));
    frags.push((m.qty ?? 1) > 1 ? `${name} ×${m.qty}` : name);
  }
  let line = `${item.qty}× ${esc(item.name_ar)} / ${esc(item.name_en)}`;
  if (frags.length) line += ' · ' + frags.join(' · ');
  const notes = (item.notes ?? '').trim();
  if (notes) line += `\n   📝 «${esc(notes)}»`;
  return line;
}

/**
 * Keep the joined item lines within `budget` characters. When lines are cut,
 * a bilingual `… و {n} أصناف أخرى / +{n} more` marker is appended.
 */
export function truncateItems(lines: string[], budget: number = MESSAGE_BUDGET): string[] {
  const total = lines.reduce((n, l) => n + l.length + 1, 0) - 1;
  if (lines.length === 0 || total <= budget) return lines;
  const marker = (n: number) => `… و ${n} أصناف أخرى / +${n} more`;
  const kept: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const remaining = lines.length - (i + 1);
    const candidate = used + line.length + 1 + marker(remaining).length + 1;
    if (candidate > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  const dropped = lines.length - kept.length;
  kept.push(marker(dropped));
  return kept;
}

/** `kind = order_new` message (HTML). */
export function renderOrder(payload: OrderPayload, lang: Lang = 'ar'): string {
  const total = fmtIqd(payload.total_iqd);
  const head = [
    `🛎 <b>طلب جديد · New order</b>  #${esc(payload.short_id)}`,
    tableLine(payload.table_number),
    `🕒 ${fmtTime(payload.placed_at)}`,
    RULE,
  ].join('\n');
  const foot = [
    RULE,
    `💰 <b>المجموع: ${total} د.ع</b> · Total ${total} IQD`,
    `💵 الدفع عند الكاشير · Pay at the desk`,
  ].join('\n');
  const lines = (payload.items ?? []).map((it) => renderItemLine(it, lang));
  const budget = MESSAGE_BUDGET - head.length - foot.length - 2;
  const body = truncateItems(lines, budget).join('\n');
  return `${head}\n${body}\n${foot}`;
}

const REASON_LINES: Record<string, string> = {
  order: '🍽 يريد الطلب · Wants to order',
  bill: '💳 الحساب · The bill',
  water: '💧 ماء · Water',
  assistance: '🙋 مساعدة · Assistance',
};

/** `kind = waiter_call` message (HTML). `lang` is accepted for symmetry; the text is bilingual. */
export function renderCall(payload: CallPayload, _lang: Lang = 'ar'): string {
  const reason = REASON_LINES[payload.reason] ?? `🙋 ${esc(payload.reason)}`;
  return [
    `🙋 <b>نداء نادل · Waiter call</b>`,
    tableLine(payload.table_number),
    reason,
    `🕒 ${fmtTime(payload.raised_at)}`,
  ].join('\n');
}

/** `kind = test` message (HTML). */
export function renderTest(payload: TestPayload): string {
  return [
    `🔔 <b>رسالة تجريبية · Test message</b>`,
    `تم ربط تتش كافيه بهذه المجموعة بنجاح ✅`,
    `Touch Cafe is connected to this group.`,
    `🕒 ${fmtTime(payload.at)} · بواسطة ${esc(payload.sent_by)}`,
  ].join('\n');
}

const BTN = {
  seen: '✅ شوهد',
  served: '🍽 تم التقديم',
  void: '❌ إلغاء',
  ack: '✅ أنا قادم',
  done: '✔️ تم',
} as const;

/** Order keyboard per stage; `order_final` -> no keyboard (null). */
export function orderKeyboard(orderId: string, stage: OrderStage = 'new'): InlineKeyboard | null {
  const seen = { text: BTN.seen, callback_data: `o:seen:${orderId}` };
  const served = { text: BTN.served, callback_data: `o:served:${orderId}` };
  const voidBtn = { text: BTN.void, callback_data: `o:void:${orderId}` };
  switch (stage) {
    case 'new':
      return { inline_keyboard: [[seen, served, voidBtn]] };
    case 'order_seen':
      return { inline_keyboard: [[served, voidBtn]] };
    default:
      return null;
  }
}

/** Waiter-call keyboard per stage; `call_final` -> no keyboard (null). */
export function callKeyboard(callId: string, stage: CallStage = 'new'): InlineKeyboard | null {
  const ack = { text: BTN.ack, callback_data: `w:ack:${callId}` };
  const done = { text: BTN.done, callback_data: `w:done:${callId}` };
  switch (stage) {
    case 'new':
      return { inline_keyboard: [[ack, done]] };
    case 'call_acked':
      return { inline_keyboard: [[done]] };
    default:
      return null;
  }
}

const FOOTER_LABEL: Record<Action, string> = {
  'o:seen': '✅ شوهد · Seen',
  'o:served': '🍽 تم التقديم · Served',
  'o:void': '❌ أُلغي · Cancelled',
  'w:ack': '✅ قادم · On the way',
  'w:done': '✔️ تم · Done',
};

/** Status line appended (after a blank line) to the original message by the callback. */
export function statusFooter(action: Action, actorLabel: string, timeHHmm: string): string {
  return `${FOOTER_LABEL[action]} — ${esc(actorLabel)} · ${timeHHmm}`;
}

const CALLBACK_RE = /^(o:(seen|served|void)|w:(ack|done)):([0-9a-f-]{36})$/;

/** `callback_data` -> {action, refId} or null when it does not match the contract. */
export function parseCallbackData(data: unknown): { action: Action; refId: string } | null {
  if (typeof data !== 'string') return null;
  const m = CALLBACK_RE.exec(data);
  if (!m || m[1] === undefined || m[4] === undefined) return null;
  return { action: m[1] as Action, refId: m[4] };
}

const TOASTS: Record<ApplyResult, string> = {
  applied: 'تم ✅',
  duplicate: 'سبق تسجيله',
  invalid: 'غير ممكن الآن',
  not_found: 'غير موجود',
  refused: 'الطلب مدفوع — الإلغاء من الكاشير',
};
export const TOAST_UNKNOWN = 'غير معروف';

/** `answerCallbackQuery` toast for an apply_action result. */
export function toastFor(result: string | null | undefined): string {
  return TOASTS[result as ApplyResult] ?? TOAST_UNKNOWN;
}

/**
 * Keyboard to leave on the message after a tap, from apply_action's
 * `keyboard` field. `unchanged` -> undefined (caller leaves the message alone);
 * a final stage -> null (caller clears the keyboard).
 */
export function keyboardAfter(
  kind: OutboxKind | string,
  keyboardStage: KeyboardStage | string,
  refId: string,
): InlineKeyboard | null | undefined {
  if (keyboardStage === 'unchanged') return undefined;
  if (kind === 'order_new') return orderKeyboard(refId, keyboardStage as OrderStage);
  if (kind === 'waiter_call') return callKeyboard(refId, keyboardStage as CallStage);
  return null;
}

/** Message text for an outbox row, by kind. */
export function renderByKind(kind: OutboxKind | string, payload: unknown, lang: Lang): string {
  switch (kind) {
    case 'order_new':
      return renderOrder(payload as OrderPayload, lang);
    case 'waiter_call':
      return renderCall(payload as CallPayload, lang);
    case 'test':
      return renderTest(payload as TestPayload);
    default:
      throw new Error(`unknown outbox kind ${kind}`);
  }
}

/** Keyboard for a freshly sent outbox row, by kind (test messages carry none). */
export function keyboardByKind(kind: OutboxKind | string, refId: string | null): InlineKeyboard | null {
  if (!refId) return null;
  if (kind === 'order_new') return orderKeyboard(refId, 'new');
  if (kind === 'waiter_call') return callKeyboard(refId, 'new');
  return null;
}
