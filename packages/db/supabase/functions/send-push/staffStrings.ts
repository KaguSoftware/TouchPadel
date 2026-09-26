/**
 * send-push — the staff kinds' copy and message shape. PURE: no imports, no
 * `Deno.*`, no fetch, so it runs unchanged under Deno (index.ts) and under
 * vitest (tests/send-push-staff.test.ts), the same arrangement as
 * staff-admin/role.ts.
 *
 * The booking kinds keep their `(court, when)` copy in index.ts. A staff row
 * (`staff_task`, `staff_decide`, `staff_decided`, `staff_info`, queued only by
 * app.notify_staff) names its copy by `payload.title_key` instead, with
 * `payload.params` = `{step?: {en, ar}, title?, name?}`
 * (docs/design/protocols/build-contracts-2026-09-23.md §2.21). The key lists
 * live in _shared/staff-push.json; the test holds STAFF_STRINGS to them.
 *
 * SOURCE OF TRUTH for the wording is the contracts file above: EN there, AR
 * written here. Keep both languages in step.
 */

export type Lang = 'en' | 'ar';

/**
 * What a body may interpolate, already resolved to the reader's language and
 * bidi-isolated. An absent param is ''. `title` is the run title (hiring runs
 * omit it); `name` is the display name of the person who sent the request,
 * idea, teaching, recipe change or shopping line. Wave 5 (wave5-addendum
 * §2.3) keeps the three: `step` is an incident's kind, `title` a content
 * item's title or, on a guest call, the table's number.
 */
export interface StaffVars {
  step: string;
  title: string;
  name: string;
}

export interface StaffCopy {
  title: string;
  /** '' = send the title alone. */
  body: (v: StaffVars) => string;
}

// "{step}: {title}", or whichever of the two the row carries.
const subject = (v: StaffVars): string =>
  v.step && v.title ? `${v.step}: ${v.title}` : v.step || v.title;
// "{title}", falling back to the step on a run without one.
const named = (v: StaffVars): string => v.title || v.step;
// "{a}: {b}", or whichever of the two the row carries (the role-spec keys).
const pair = (a: string, b: string): string => (a && b ? `${a}: ${b}` : a || b);

const EN = {
  step_open: { title: 'New task', body: subject },
  step_submitted: { title: 'Waiting on you', body: subject },
  step_approved: { title: 'Approved', body: subject },
  step_sent_back: { title: 'Sent back for changes', body: subject },
  step_stopped: { title: 'Stopped', body: named },
  run_stopped: { title: 'Stopped', body: named },
  run_live: { title: 'Launched', body: (v) => (named(v) ? `${named(v)} is on the menu.` : '') },
  launch_not_ready: {
    title: 'Launch postponed',
    body: (v) =>
      named(v) ? `${named(v)} was not ready on the date. Open it to fix and launch again.` : '',
  },
  apply_not_ready: {
    title: 'Change postponed',
    body: (v) => (named(v) ? `${named(v)} could not be applied on the date.` : ''),
  },
  review_ready: { title: '30-day review ready', body: named },
  request_submitted: {
    title: 'Staff request',
    body: (v) => (v.name ? `${v.name} sent a request.` : ''),
  },
  request_approved: { title: 'Request approved', body: () => '' },
  request_rejected: { title: 'Request declined', body: () => '' },
  shopping_new: { title: 'Shopping list', body: () => 'New items to buy.' },
  purchase_to_receive: {
    title: 'Purchase to receive',
    body: () => 'Receive it in Stock ▸ Goods in on the operator.',
  },
  // Role spec (2026-09-25, §2.21): eleven keys, no new kind or route. `title`
  // is the idea's name, the teaching's title or the request's title; `step`
  // is the item's or prepared ingredient's name on a recipe change.
  idea_submitted: { title: 'New item idea', body: (v) => pair(v.name, v.title) },
  idea_started: {
    title: 'Idea started',
    body: (v) => (named(v) ? `${named(v)} is now a new-item proposal.` : ''),
  },
  idea_declined: { title: 'Idea declined', body: named },
  teaching_new: { title: 'New teaching', body: (v) => pair(v.name, v.title) },
  recipe_change_submitted: { title: 'Recipe change', body: (v) => pair(v.name, v.step) },
  recipe_change_approved: { title: 'Recipe change approved', body: (v) => v.step },
  recipe_change_declined: { title: 'Recipe change declined', body: (v) => v.step },
  shopping_to_approve: {
    title: 'Shopping list',
    body: (v) => (v.name ? `${v.name} added items for your OK.` : ''),
  },
  shopping_declined: { title: 'Shopping list', body: () => 'An item you added was declined.' },
  marketing_request_new: { title: 'Marketing request', body: (v) => pair(v.name, v.title) },
  marketing_request_answered: { title: 'Marketing answered', body: named },
  // Wave 5 (wave5-addendum-2026-09-25 §2.3): eleven keys, no new kind or
  // route. No body carries an amount, a reason, a description or the name of
  // the person a deduction is against: `name` is the proposer, reporter or
  // author, `step` an incident's kind, `title` a content item's title or the
  // table's number on a guest call.
  deduction_proposed: {
    title: 'Pay deduction',
    body: (v) => (v.name ? `${v.name} proposed a deduction.` : ''),
  },
  deduction_approved: { title: 'Deduction approved', body: () => 'Your proposal was approved.' },
  deduction_declined: { title: 'Deduction declined', body: () => 'Your proposal was declined.' },
  deduction_recorded: {
    title: 'Pay deduction',
    body: () => 'A deduction was added to your record.',
  },
  incident_reported: { title: 'Incident report', body: (v) => pair(v.name, v.step) },
  incident_reviewed: { title: 'Incident reviewed', body: (v) => v.step },
  content_submitted: { title: 'Content for approval', body: (v) => pair(v.name, v.title) },
  content_approved: { title: 'Content approved', body: (v) => v.title },
  content_changes: { title: 'Changes asked', body: (v) => v.title },
  content_declined: { title: 'Content declined', body: (v) => v.title },
  waiter_call_new: { title: 'Guest call', body: (v) => (v.title ? `Table ${v.title}` : '') },
} satisfies Record<string, StaffCopy>;

export type StaffTitleKey = keyof typeof EN;

// Typed by EN's keys, so a missing or extra Arabic entry fails typecheck.
const AR: Record<StaffTitleKey, StaffCopy> = {
  step_open: { title: 'مهمة جديدة', body: subject },
  step_submitted: { title: 'بانتظارك', body: subject },
  step_approved: { title: 'تمت الموافقة', body: subject },
  step_sent_back: { title: 'أُعيد للتعديل', body: subject },
  step_stopped: { title: 'تم الإيقاف', body: named },
  run_stopped: { title: 'تم الإيقاف', body: named },
  run_live: {
    title: 'تم الإطلاق',
    body: (v) => (named(v) ? `${named(v)} متوفر الآن في القائمة.` : ''),
  },
  launch_not_ready: {
    title: 'تأجّل الإطلاق',
    body: (v) =>
      named(v) ? `لم يكن ${named(v)} جاهزًا في الموعد. افتحه لإصلاحه ثم أطلقه من جديد.` : '',
  },
  apply_not_ready: {
    title: 'تأجّل التغيير',
    body: (v) => (named(v) ? `تعذّر تطبيق ${named(v)} في الموعد.` : ''),
  },
  review_ready: { title: 'مراجعة الثلاثين يومًا جاهزة', body: named },
  request_submitted: { title: 'طلب من موظف', body: (v) => (v.name ? `أرسل ${v.name} طلبًا.` : '') },
  request_approved: { title: 'تمت الموافقة على الطلب', body: () => '' },
  request_rejected: { title: 'رُفض الطلب', body: () => '' },
  shopping_new: { title: 'قائمة المشتريات', body: () => 'أغراض جديدة للشراء.' },
  purchase_to_receive: {
    title: 'مشتريات بانتظار الاستلام',
    body: () => 'استلمها من المخزون ← استلام البضائع في تطبيق التشغيل.',
  },
  idea_submitted: { title: 'فكرة صنف جديد', body: (v) => pair(v.name, v.title) },
  idea_started: {
    title: 'بدأت الفكرة',
    body: (v) => (named(v) ? `${named(v)} أصبح الآن اقتراح صنف جديد.` : ''),
  },
  idea_declined: { title: 'رُفضت الفكرة', body: named },
  teaching_new: { title: 'درس جديد', body: (v) => pair(v.name, v.title) },
  recipe_change_submitted: { title: 'تغيير وصفة', body: (v) => pair(v.name, v.step) },
  recipe_change_approved: { title: 'تمت الموافقة على تغيير الوصفة', body: (v) => v.step },
  recipe_change_declined: { title: 'رُفض تغيير الوصفة', body: (v) => v.step },
  shopping_to_approve: {
    title: 'قائمة المشتريات',
    body: (v) => (v.name ? `أضاف ${v.name} أغراضًا بانتظار موافقتك.` : ''),
  },
  shopping_declined: { title: 'قائمة المشتريات', body: () => 'رُفض غرض أضفته.' },
  marketing_request_new: { title: 'طلب تسويق', body: (v) => pair(v.name, v.title) },
  marketing_request_answered: { title: 'ردّ التسويق', body: named },
  deduction_proposed: {
    title: 'خصم من الراتب',
    body: (v) => (v.name ? `اقترح ${v.name} خصمًا.` : ''),
  },
  deduction_approved: { title: 'تمت الموافقة على الخصم', body: () => 'تمت الموافقة على اقتراحك.' },
  deduction_declined: { title: 'رُفض الخصم', body: () => 'رُفض اقتراحك.' },
  deduction_recorded: { title: 'خصم من الراتب', body: () => 'أُضيف خصم إلى سجلّك.' },
  incident_reported: { title: 'بلاغ حادثة', body: (v) => pair(v.name, v.step) },
  incident_reviewed: { title: 'تمت مراجعة البلاغ', body: (v) => v.step },
  content_submitted: { title: 'محتوى بانتظار الموافقة', body: (v) => pair(v.name, v.title) },
  content_approved: { title: 'تمت الموافقة على المحتوى', body: (v) => v.title },
  content_changes: { title: 'طُلبت تعديلات', body: (v) => v.title },
  content_declined: { title: 'رُفض المحتوى', body: (v) => v.title },
  waiter_call_new: { title: 'نداء زبون', body: (v) => (v.title ? `طاولة ${v.title}` : '') },
};

export const STAFF_STRINGS: Record<Lang, Record<StaffTitleKey, StaffCopy>> = { en: EN, ar: AR };

// FSI … PDI, as @touch/i18n `isolate`: typed text keeps its own direction
// inside a sentence of the other language.
const isolate = (s: string): string => `\u2068${s}\u2069`;

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The step name in the reader's language, else the other one. */
function stepName(step: unknown, lang: Lang): string {
  if (!step || typeof step !== 'object') return '';
  const s = step as { en?: unknown; ar?: unknown };
  const other: Lang = lang === 'ar' ? 'en' : 'ar';
  return text(s[lang]) || text(s[other]);
}

export type StaffMessage =
  | { ok: true; title: string; body: string; data: Record<string, string> }
  | { ok: false; error: string };

/**
 * The Expo title, body and `data` for one staff outbox row, or the terminal
 * error to record. `data` is `{kind, route, id}` (§2.21): the route only when
 * it is one the phone knows, the id only when it is a string.
 */
export function staffMessage(
  lang: Lang,
  kind: string,
  payload: { title_key?: unknown; route?: unknown; id?: unknown; params?: unknown },
  routes: ReadonlySet<string>,
): StaffMessage {
  const key = typeof payload.title_key === 'string' ? payload.title_key : '';
  const copy = Object.hasOwn(STAFF_STRINGS[lang], key)
    ? STAFF_STRINGS[lang][key as StaffTitleKey]
    : undefined;
  if (!copy) return { ok: false, error: `UNKNOWN_TITLE_KEY:${key || String(payload.title_key)}` };

  const p = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as {
    step?: unknown;
    title?: unknown;
    name?: unknown;
  };
  const wrap = (s: string) => (s ? isolate(s) : '');
  const body = copy.body({
    step: wrap(stepName(p.step, lang)),
    title: wrap(text(p.title)),
    name: wrap(text(p.name)),
  });

  const data: Record<string, string> = { kind };
  if (typeof payload.route === 'string' && routes.has(payload.route)) data.route = payload.route;
  if (typeof payload.id === 'string' && payload.id) data.id = payload.id;
  return { ok: true, title: copy.title, body, data };
}
