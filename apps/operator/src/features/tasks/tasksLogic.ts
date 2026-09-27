/**
 * Pure helpers for My tasks (/tasks; build-contracts-2026-09-23 §5.1, §5.4):
 * the caller's protocol work, which starts their role offers, and the
 * read-only copy of the pages they work on the phone. Every reader takes an
 * RPC payload as returned and reads it defensively.
 */
import type { MessageKey, TParams } from '@touch/i18n';
import { formatDate, formatDateTime, formatIQD, formatNumber, isolate } from '@touch/i18n';
import { PROTOCOL_KINDS, type ProtocolKind, type TournamentVariant } from '@touch/core/protocols';
import { can, type StaffRole } from '../../lib/auth';
import type { AppFunctionName } from '../../lib/appRpc';
import type { Tone } from '../../components/kit';
import { campaignTone } from '../marketing/marketingTypes';
import { bilingual, isObject, list, num, str } from '../roleExtras/roleExtrasLogic';
import type { TaskStart } from './search';
import { dayLabel } from '../deductions/venueDate';

type Tr = (key: MessageKey, params?: TParams) => string;
type Locale = 'en' | 'ar';

// ---------------------------------------------------------------------------
// My protocol work (app.my_protocol_work)
// ---------------------------------------------------------------------------

export interface WorkItem {
  runStepId: string;
  runId: string;
  kind: ProtocolKind;
  variant: TournamentVariant | null;
  titleEn: string | null;
  titleAr: string | null;
  stepKey: string | null;
  stepEn: string;
  stepAr: string;
  /** When the step opened (To do) or the submission was sent (Waiting, Decided). */
  at: string | null;
  round: number;
  submissionId: string | null;
  decision: 'approve' | 'send_back' | 'stop' | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
}

export interface MyWork {
  todo: WorkItem[];
  waiting: WorkItem[];
  decided: WorkItem[];
}

const kindOf = (v: unknown): ProtocolKind => ((PROTOCOL_KINDS as readonly unknown[]).includes(v) ? (v as ProtocolKind) : 'product_release');
const DECISIONS = ['approve', 'send_back', 'stop'] as const;

function workItem(r: Record<string, unknown>, at: unknown): WorkItem {
  return {
    runStepId: str(r.run_step_id) ?? '',
    runId: str(r.run_id) ?? '',
    kind: kindOf(r.kind),
    variant: r.variant === 'type1' || r.variant === 'type2' || r.variant === 'type3' ? r.variant : null,
    titleEn: str(r.title_en),
    titleAr: str(r.title_ar),
    stepKey: str(r.step_key),
    stepEn: str(r.name_en) ?? '',
    stepAr: str(r.name_ar) ?? '',
    at: str(at),
    round: num(r.round) ?? 1,
    submissionId: str(r.submission_id),
    decision: (DECISIONS as readonly unknown[]).includes(r.decision) ? (r.decision as WorkItem['decision']) : null,
    decisionNote: str(r.decision_note),
    decidedAt: str(r.decided_at),
    decidedByName: str(r.decided_by_name),
  };
}

export function readMyWork(payload: unknown): MyWork {
  const p = isObject(payload) ? payload : {};
  const rows = (key: string, at: string) =>
    list(p[key])
      .filter((r) => typeof r.run_step_id === 'string')
      .map((r) => workItem(r, r[at]));
  return { todo: rows('todo', 'opened_at'), waiting: rows('waiting', 'submitted_at'), decided: rows('decided', 'decided_at') };
}

/** The kitchen board's My tasks count: steps to do, plus the ideas a head has to review (§5.4). */
export function kitchenTaskCount(work: unknown, ideas: number): number {
  const p = isObject(work) ? work : {};
  const counts = isObject(p.counts) ? p.counts : {};
  const todo = num(counts.todo) ?? list(p.todo).length;
  return todo + ideas;
}

/** A run's title in the reader's language, falling back to the other one, then to its kind (§4). */
export function runTitle(item: { titleEn: string | null; titleAr: string | null; kind: ProtocolKind }, locale: Locale, tr: Tr): string {
  return bilingual(locale, item.titleEn, item.titleAr) || tr(`work.protocol.kind.${item.kind}`);
}

// ---------------------------------------------------------------------------
// Starts
// ---------------------------------------------------------------------------

/**
 * The starts a role gets on /tasks, in the page's order. Management never
 * opens /tasks (its starts are on /protocols), so these are the head roles'
 * "Propose a new item", marketing's "Price or promo change" and the desk's
 * "Start a tournament" (§5.1). The capability matrix decides; no role here.
 */
export function taskStarts(role: StaffRole | undefined): TaskStart[] {
  const out: TaskStart[] = [];
  if (can(role, 'startProtocolRelease')) out.push('product_release');
  if (can(role, 'startProtocolPriceChange')) out.push('price_promo');
  if (can(role, 'startProtocolTournament')) out.push('tournament');
  return out;
}

// ---------------------------------------------------------------------------
// On your phone: read-only copies (§5.4)
// ---------------------------------------------------------------------------

export const PHONE_SECTIONS = [
  'checklists',
  'production',
  'shopping',
  'purchases',
  'marketingTake',
  'campaignDrafts',
  'results',
  'marketingRequests',
  'teachings',
  'stock',
  // Wave 5 (wave5-addendum-2026-09-25 M2): the day's moves, additions and counts.
  'storeToday',
  'recipes',
  'myRecipeChanges',
  'myIdeas',
  'requests',
  'itemNotes',
  'mySuggestions',
  // Wave 5 (wave5-addendum-2026-09-25 §5.1): a head's own deduction proposals.
  'myDeductionProposals',
] as const;
export type PhoneSection = (typeof PHONE_SECTIONS)[number];

/**
 * Which copies a role sees, checklists first ("Checklists sit at the top of
 * To do for every role", §6.1). Each follows the capability of the read behind
 * it (CAPABILITY_ROLES, which mirrors that RPC's guard, §2.14-§2.17, §2.24),
 * so a section is never offered to a role its read refuses. The ones every
 * /tasks role reads (its checklists, requests, notes and suggestions, its own
 * requests to marketing) need none.
 */
export function phoneSectionsFor(role: StaffRole | undefined): PhoneSection[] {
  if (!role) return [];
  const marketing = can(role, 'marketingWork');
  const on: Record<PhoneSection, boolean> = {
    checklists: true,
    production: can(role, 'readProduction'),
    shopping: can(role, 'readShoppingList'),
    purchases: can(role, 'readPurchases'),
    marketingTake: marketing,
    campaignDrafts: marketing,
    results: marketing,
    marketingRequests: true,
    teachings: can(role, 'readTeachings'),
    stock: can(role, 'readStaffStock'),
    storeToday: can(role, 'readStoreToday'),
    recipes: can(role, 'readRecipes'),
    myRecipeChanges: can(role, 'requestRecipeChanges'),
    myIdeas: can(role, 'sendIdeas'),
    requests: true,
    itemNotes: true,
    mySuggestions: true,
    myDeductionProposals: can(role, 'proposeDeductions'),
  };
  return PHONE_SECTIONS.filter((s) => on[s]);
}

/** The read behind one copy. Marketing's requests are its inbox; everyone else's are their own. */
export function phoneRead(section: PhoneSection, role: StaffRole | undefined): { fn: AppFunctionName; args: Record<string, unknown> } {
  switch (section) {
    case 'checklists':
      return { fn: 'my_checklists_today', args: {} };
    case 'production':
      return { fn: 'production_today', args: {} };
    case 'shopping':
      return { fn: 'shopping_list', args: { p_status: 'open' } };
    case 'purchases':
      return { fn: 'my_purchases', args: {} };
    case 'marketingTake':
      return { fn: 'my_marketing_notes', args: {} };
    case 'campaignDrafts':
      return { fn: 'my_campaign_drafts', args: {} };
    case 'results':
      return { fn: 'marketing_campaign_results', args: {} };
    case 'marketingRequests':
      return can(role, 'marketingWork')
        ? { fn: 'marketing_requests_page', args: { p_filter: 'open' } }
        : { fn: 'my_marketing_requests', args: {} };
    case 'teachings':
      return { fn: 'teachings_for_me', args: {} };
    case 'stock':
      return { fn: 'staff_stock_view', args: {} };
    case 'storeToday':
      return { fn: 'stock_today', args: {} };
    case 'recipes':
      return { fn: 'recipe_view', args: {} };
    case 'myRecipeChanges':
      return { fn: 'my_recipe_changes', args: {} };
    case 'myIdeas':
      return { fn: 'my_release_ideas', args: {} };
    case 'requests':
      return { fn: 'staff_requests_page', args: { p_status: null, p_limit: 30, p_offset: 0 } };
    case 'itemNotes':
      return { fn: 'release_notes_for_me', args: {} };
    case 'mySuggestions':
      return { fn: 'my_suggestions', args: {} };
    case 'myDeductionProposals':
      return { fn: 'my_deduction_proposals', args: {} };
  }
}

/** One line of a phone copy: a title, what it says, and a status where there is one. */
export interface PhoneRow {
  id: string;
  title: string;
  detail?: string;
  /** Staff free text, shown as typed (a suggestion, a teaching, an answer). */
  body?: string;
  /** Sub-lines: a list's open items, a recipe's ingredients. */
  lines?: string[];
  status?: { label: string; tone: Tone };
}

interface RowCtx {
  tr: Tr;
  locale: Locale;
  /** "2,000 g" in the stock screens' words. */
  qty: (n: number, unit: string) => string;
}

const when = (iso: string | null, locale: Locale) => (iso ? formatDateTime(new Date(iso), locale) : '');
const name = (r: Record<string, unknown>, locale: Locale, en = 'name_en', ar = 'name_ar') => bilingual(locale, str(r[en]), str(r[ar]));

const STATUS_TONE: Record<string, Tone> = {
  open: 'warn',
  waiting: 'warn',
  pending: 'warn',
  to_receive: 'warn',
  done: 'success',
  approved: 'success',
  started: 'success',
  received: 'success',
  bought: 'success',
  declined: 'danger',
  rejected: 'danger',
  cancelled: 'neutral',
  withdrawn: 'neutral',
  acknowledged: 'neutral',
};
const tone = (status: string): Tone => STATUS_TONE[status] ?? 'neutral';

/** The rows of one copy, in the order the RPC returns them. */
export function phoneRows(section: PhoneSection, payload: unknown, ctx: RowCtx): PhoneRow[] {
  const { tr, locale } = ctx;
  const p = isObject(payload) ? payload : {};
  const n = (v: number) => formatNumber(v, locale);
  // A recipe's ingredient names (never a quantity, #72), or that it has none yet.
  const ingredients = (lines: unknown) => list(lines).map((l) => name(l, locale)).join(', ') || tr('ws.rolePages.phone.recipes.noLines');
  switch (section) {
    case 'checklists':
      return list(p.lists).map((l) => {
        const done = num(l.done) ?? 0;
        const total = num(l.total) ?? 0;
        const slot = l.slot === 'close' ? 'close' : 'open';
        return {
          id: str(l.run_id) ?? `${str(l.role)}:${slot}`,
          title: name(l, locale) || tr(`work.checklist.slot.${slot}`),
          detail: tr('ws.rolePages.phone.checklists.progress', { done: n(done), total: n(total) }),
          lines: list(l.items)
            .filter((i) => !i.done_at)
            .map((i) => bilingual(locale, str(i.text_en), str(i.text_ar)) + (i.photo_required === true ? ` · ${tr('ws.rolePages.phone.checklists.needsPhoto')}` : '')),
          status: total > 0 && done === total ? { label: tr('ws.rolePages.phone.checklists.finished'), tone: 'success' } : undefined,
        };
      });
    case 'production':
      return list(p.items).map((i) => {
        const unit = str(i.unit) ?? '';
        const onHand = num(i.on_hand) ?? 0;
        return {
          id: str(i.ingredient_id) ?? name(i, locale),
          title: name(i, locale),
          detail: tr('ws.rolePages.phone.production.line', {
            onHand: ctx.qty(onHand, unit),
            made: ctx.qty(num(i.made_today) ?? 0, unit),
          }),
          status: i.below_par === true ? { label: tr('ws.rolePages.phone.production.belowPar'), tone: 'warn' } : undefined,
        };
      });
    case 'shopping': {
      // A chef assistant's lines wait for the head chef's OK, on the phone,
      // before the driver sees them (#66); the open list carries their count.
      const pending = num(p.pending_count) ?? 0;
      const waiting: PhoneRow[] =
        pending > 0 ? [{ id: 'pending', title: tr('ws.rolePages.phone.shopping.pending', { count: n(pending) }) }] : [];
      return [...waiting, ...list(p.items).map((i): PhoneRow => {
        const status = str(i.status) ?? 'open';
        const unit = str(i.unit) ?? '';
        const q = num(i.qty);
        return {
          id: str(i.id) ?? '',
          title: name(i, locale) || str(i.label) || '—',
          detail: [q === null ? null : unit === 'pack' ? tr('ws.rolePages.phone.shopping.packs', { qty: n(q) }) : ctx.qty(q, unit), str(i.requested_by_name)].filter(Boolean).join(' · '),
          body: str(i.note) ?? undefined,
          status: { label: tr(`work.shopping.status.${status as 'open'}`), tone: tone(status) },
        };
      })];
    }
    case 'purchases':
      return list(p.purchases).map((pu) => {
        const status = str(pu.status) === 'done' ? 'done' : 'to_receive';
        return {
          id: str(pu.id) ?? '',
          title: str(pu.shop_name) || tr('ws.rolePages.phone.purchases.noShop'),
          detail: [when(str(pu.bought_at), locale), formatIQD(num(pu.total_iqd) ?? 0, locale)].filter(Boolean).join(' · '),
          lines: str(pu.delivered_at)
            ? [tr('ws.rolePages.phone.purchases.delivered', { time: when(str(pu.delivered_at), locale) })]
            : [tr('ws.rolePages.phone.purchases.notDelivered')],
          status: { label: tr(`work.purchase.status.${status}`), tone: tone(status) },
        };
      });
    case 'marketingTake':
      return list(p.notes).map((m) => ({
        id: str(m.id) ?? '',
        title: name(m, locale, 'subject_name_en', 'subject_name_ar') || tr('ws.rolePages.phone.marketingTake.noSubject'),
        detail: when(str(m.created_at), locale),
        body: str(m.body) ?? undefined,
      }));
    case 'campaignDrafts':
      return list(p.drafts).map((d) => {
        const status = str(d.status) ?? 'draft';
        const channel = str(d.channel);
        return {
          id: str(d.id) ?? '',
          title: name(d, locale) || '—',
          detail: [channel === 'telegram' || channel === 'guest_site' || channel === 'in_venue' ? tr(`ws.owner.marketing.channels.${channel}`) : channel, when(str(d.suggested_at), locale)]
            .filter(Boolean)
            .join(' · '),
          status:
            status === 'draft' || status === 'scheduled' || status === 'live' || status === 'ended' || status === 'cancelled'
              ? { label: tr(`ws.owner.marketing.statuses.${status}`), tone: campaignTone(status) }
              : undefined,
        };
      });
    case 'results':
      return list(p.campaigns).map((c) => ({
        id: str(c.campaign_id) ?? '',
        title: name(c, locale) || '—',
        detail: tr('ws.rolePages.phone.results.line', {
          sent: n(num(c.sends) ?? 0),
          delivered: n(num(c.delivered) ?? 0),
          used: n(num(c.redemptions) ?? 0),
        }),
        status:
          c.attributable === false
            ? { label: tr('ws.rolePages.phone.results.notMeasurable'), tone: 'neutral' }
            : undefined,
      }));
    case 'marketingRequests':
      return list(p.requests).map((r) => {
        const status = str(r.status) ?? 'open';
        const who = str(r.requested_by_name);
        return {
          id: str(r.id) ?? '',
          title: str(r.title) ?? '—',
          detail: [who, when(str(r.created_at), locale), str(r.want_by) ? tr('ws.rolePages.phone.marketingRequests.wantBy', { date: formatDate(new Date(`${str(r.want_by)}T12:00:00`), locale) }) : null]
            .filter(Boolean)
            .join(' · '),
          body: str(r.answer) ?? str(r.body) ?? undefined,
          status: { label: tr(`work.marketingRequest.status.${status as 'open'}`), tone: tone(status) },
        };
      });
    case 'teachings':
      return list(p.teachings).map((t) => ({
        id: str(t.id) ?? '',
        title: str(t.title) ?? '—',
        detail: [str(t.author_name), when(str(t.created_at), locale)].filter(Boolean).join(' · '),
        body: str(t.body) ?? undefined,
      }));
    case 'stock':
      return list(p.items).map((i) => {
        const unit = str(i.unit) ?? '';
        const product = isObject(i.product) ? i.product : null;
        // Wave 5: where it is, once the bakery store holds any (staff_stock_view's by_location).
        const at = isObject(i.by_location) ? i.by_location : null;
        const bakery = at ? (num(at.bakery) ?? 0) : 0;
        return {
          id: str(i.ingredient_id) ?? '',
          title: product ? bilingual(locale, str(product.name_en), str(product.name_ar)) || name(i, locale) : name(i, locale),
          detail:
            at && bakery > 0
              ? `${ctx.qty(num(i.on_hand) ?? 0, unit)} · ${tr('ws.stores.stockByStore', { cafe: ctx.qty(num(at.cafe) ?? 0, unit), bakery: ctx.qty(bakery, unit) })}`
              : ctx.qty(num(i.on_hand) ?? 0, unit),
          status: i.low === true
            ? { label: tr('ws.rolePages.phone.stock.low'), tone: 'danger' }
            : i.below_par === true
              ? { label: tr('ws.rolePages.phone.stock.belowPar'), tone: 'warn' }
              : undefined,
        };
      });
    case 'storeToday':
      return storeTodayRows(p, ctx);
    case 'recipes':
      return [
        ...list(p.items).map((i) => ({
          id: str(i.menu_item_id) ?? '',
          title: name(i, locale),
          detail: bilingual(locale, str(i.category_name_en), str(i.category_name_ar)),
          lines: list(i.sizes).map((s) => {
            const lines = ingredients(s.lines);
            const size = name(s, locale);
            return size ? `${size}: ${lines}` : lines;
          }),
        })),
        ...list(p.prepared).map((i) => ({
          id: str(i.ingredient_id) ?? '',
          title: name(i, locale),
          detail: tr('ws.rolePages.phone.recipes.prepared'),
          lines: [ingredients(i.lines)],
        })),
      ];
    case 'myRecipeChanges':
      return list(p.requests).map((r) => {
        const status = str(r.status) ?? 'waiting';
        const item = bilingual(locale, str(r.item_name_en), str(r.item_name_ar));
        const size = bilingual(locale, str(r.size_name_en), str(r.size_name_ar));
        return {
          id: str(r.id) ?? '',
          title: size ? `${item} · ${size}` : item,
          detail: when(str(r.requested_at), locale),
          body: str(r.decline_reason) ?? undefined,
          status: { label: tr(`work.recipeChange.status.${status as 'waiting'}`), tone: tone(status) },
        };
      });
    case 'myIdeas':
      return list(p.ideas).map((i) => {
        const status = str(i.status) ?? 'waiting';
        const record = isObject(i.record) ? i.record : {};
        const run = isObject(i.run) ? i.run : null;
        return {
          id: str(i.id) ?? '',
          title: bilingual(locale, str(record.name_en), str(record.name_ar)) || tr('ws.rolePages.ideas.untitled'),
          detail: when(str(i.submitted_at), locale),
          body: str(i.decline_reason) ?? undefined,
          lines: run ? list(run.current_steps).map((s) => `${name(s, locale)} · ${tr(`work.protocol.stepStatus.${(str(s.status) ?? 'open') as 'open'}`)}`) : undefined,
          status: { label: tr(`work.idea.status.${status as 'waiting'}`), tone: tone(status) },
        };
      });
    case 'requests':
      return list(p.requests).map((r) => {
        const status = str(r.status) ?? 'pending';
        const kind = str(r.kind);
        return {
          id: str(r.id) ?? '',
          title: kind === 'leave' || kind === 'shift_swap' || kind === 'advance' || kind === 'correction' ? tr(`ws.owner.requests.kinds.${kind}`) : (kind ?? '—'),
          detail: [str(r.from_date) ? formatDate(new Date(`${str(r.from_date)}T12:00:00`), locale) : null, when(str(r.created_at), locale)].filter(Boolean).join(' · '),
          body: str(r.decision_note) ?? undefined,
          status:
            status === 'pending' || status === 'approved' || status === 'rejected' || status === 'withdrawn'
              ? { label: tr(`ws.owner.requests.statuses.${status}`), tone: tone(status) }
              : undefined,
        };
      });
    case 'itemNotes':
      return list(p.items).map((i) => ({
        id: str(i.menu_item_id) ?? '',
        title: name(i, locale),
        detail: tr('ws.rolePages.phone.itemNotes.line', {
          notes: n(num(i.notes) ?? 0),
          mine: n(num(i.my_notes) ?? 0),
          until: str(i.window_ends_at) ? formatDate(new Date(str(i.window_ends_at)!), locale) : '—',
        }),
      }));
    case 'mySuggestions':
      return list(p.suggestions).map((s) => ({
        id: str(s.id) ?? '',
        title: when(str(s.created_at), locale),
        body: str(s.body) ?? undefined,
        status: s.seen === true
          ? { label: tr('ws.rolePages.phone.mySuggestions.seen'), tone: 'success' }
          : { label: tr('ws.rolePages.phone.mySuggestions.notSeen'), tone: 'neutral' },
      }));
    case 'myDeductionProposals':
      // The head proposed each of these, so the amount is theirs to see; the
      // decider's note comes back to them, the person's own view never does.
      return list(p.proposals).map((d) => {
        const status = str(d.status) ?? 'waiting';
        const date = str(d.deduction_date);
        return {
          id: str(d.id) ?? '',
          title: str(d.staff_name) ?? '—',
          detail: [formatIQD(num(d.amount_iqd) ?? 0, locale), date ? dayLabel(date, locale) : null].filter(Boolean).join(' · '),
          body: str(d.reason) ?? undefined,
          lines: str(d.decision_note) ? [tr('ws.deductions.noteLine', { note: isolate(str(d.decision_note)!) })] : undefined,
          status:
            status === 'waiting' || status === 'approved' || status === 'declined' || status === 'withdrawn' || status === 'cancelled'
              ? { label: tr(`work.deduction.status.${status}`), tone: tone(status) }
              : undefined,
        };
      });
  }
}

// ---------------------------------------------------------------------------
// Today in the stores (app.stock_today; wave5-addendum-2026-09-25 §2.8.5, M2)
// ---------------------------------------------------------------------------

/** A section's title and empty sentence: the role-spec copies in ws.rolePages, the stores' in ws.stores. */
export function phoneSectionKeys(section: PhoneSection): { tab: MessageKey; empty: MessageKey } {
  if (section === 'storeToday') return { tab: 'ws.stores.today.tab', empty: 'ws.stores.today.empty' };
  if (section === 'myDeductionProposals') return { tab: 'ws.deductions.phone.tab', empty: 'ws.deductions.phone.empty' };
  return { tab: `ws.rolePages.phone.${section}.tab`, empty: `ws.rolePages.phone.${section}.empty` };
}

const storeKey = (v: unknown): 'cafe' | 'bakery' => (v === 'bakery' ? 'bakery' : 'cafe');

/**
 * The day in the stores as the phone shows it, read-only: the driver's
 * deliveries still waiting for a manager first (so nobody adds them twice),
 * then the moves, what was added and the phone counts, each section present
 * only for the roles its RPC gives it. No cost, no theoretical quantity.
 */
function storeTodayRows(p: Record<string, unknown>, ctx: RowCtx): PhoneRow[] {
  const { tr, locale } = ctx;
  const n = (v: number) => formatNumber(v, locale);
  const lineOf = (l: Record<string, unknown>, qtyKey: string) => `${name(l, locale)} ${ctx.qty(num(l[qtyKey]) ?? 0, str(l.unit) ?? '')}`;
  const rows: PhoneRow[] = [];
  const waiting = num(p.driver_deliveries_waiting) ?? 0;
  if (waiting > 0) rows.push({ id: 'driverWaiting', title: tr('ws.stores.today.driverWaiting', { count: n(waiting) }) });
  for (const t of list(p.transfers)) {
    rows.push({
      id: str(t.transfer_id) ?? '',
      title: tr(storeKey(t.from) === 'cafe' ? 'ws.stores.today.moved.cafe_to_bakery' : 'ws.stores.today.moved.bakery_to_cafe'),
      detail: [str(t.moved_by_name), when(str(t.moved_at), locale)].filter(Boolean).join(' · '),
      lines: list(t.lines).map((l) => lineOf(l, 'qty')),
    });
  }
  for (const d of list(p.logs)) {
    const added = tr(`ws.stores.today.added.${storeKey(d.location)}`);
    rows.push({
      id: str(d.delivery_id) ?? '',
      title: str(d.source) === 'goods_in' ? `${added} · ${tr('ws.stores.today.goodsIn')}` : added,
      detail: [str(d.received_by_name), when(str(d.received_at), locale)].filter(Boolean).join(' · '),
      lines: list(d.lines).map((l) => lineOf(l, 'qty')),
    });
  }
  for (const c of list(p.counts)) {
    const applied = str(c.status) === 'applied';
    rows.push({
      id: str(c.count_id) ?? '',
      title: tr(`ws.stores.today.counted.${storeKey(c.location)}`),
      detail: [str(c.counted_by_name), when(str(c.submitted_at), locale)].filter(Boolean).join(' · '),
      lines: list(c.lines).map((l) => lineOf(l, 'counted_qty')),
      status: applied ? { label: tr('ws.stores.today.countStatus.applied'), tone: 'success' } : { label: tr('ws.stores.today.countStatus.waiting'), tone: 'warn' },
    });
  }
  return rows;
}
