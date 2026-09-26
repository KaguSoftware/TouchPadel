/**
 * send-push, staff kinds (build-contracts-2026-09-23 §2.21). Pure: no stack,
 * no network. The copy and the message shape live in
 * supabase/functions/send-push/staffStrings.ts so they run here unchanged; the
 * one list of kinds, title keys and routes is _shared/staff-push.json, which
 * app.notify_staff checks too (tests/staff-push.test.ts holds the database to
 * it) and the phone's pushRoutes.ts test reads for `routes`.
 *
 * This file ships in the send-push commit, which deploys before the staff_push
 * migration (§1.6 step 2), so nothing here may need that migration. The role
 * spec's eleven title keys (§2.24.1) shipped their copy the same way, one
 * commit ahead of staff_push_keys, which lists them in the JSON and in
 * app.notify_staff: from there the copy and the list are equal again. Wave
 * 5's eleven (wave5-addendum-2026-09-25 §2.3) ship their copy the same way,
 * one commit ahead of staff_push_keys_wave5: until then every JSON key has
 * copy, and so does each of the eleven.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import staffPush from '../supabase/functions/_shared/staff-push.json';
import {
  STAFF_STRINGS,
  staffMessage,
  type Lang,
} from '../supabase/functions/send-push/staffStrings.ts';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(resolve(here, '../supabase/functions/send-push/index.ts'), 'utf8');

const ROUTES = new Set(staffPush.routes);
/** The role spec's eleven title keys (§2.21, §2.24.1), last in the JSON, in this order. */
const ROLE_SPEC_KEYS = [
  'idea_submitted',
  'idea_started',
  'idea_declined',
  'teaching_new',
  'recipe_change_submitted',
  'recipe_change_approved',
  'recipe_change_declined',
  'shopping_to_approve',
  'shopping_declined',
  'marketing_request_new',
  'marketing_request_answered',
];
/** Wave 5's eleven title keys (wave5-addendum §2.3); staff_push_keys_wave5 adds them to the JSON, in this order. */
const WAVE5_KEYS = [
  'deduction_proposed',
  'deduction_approved',
  'deduction_declined',
  'deduction_recorded',
  'incident_reported',
  'incident_reviewed',
  'content_submitted',
  'content_approved',
  'content_changes',
  'content_declined',
  'waiter_call_new',
];
const FSI = '\u2068';
const PDI = '\u2069';
const iso = (s: string) => `${FSI}${s}${PDI}`;

const STEP = { en: 'Price', ar: 'السعر' };
const payload = (title_key: string, params: Record<string, unknown> = {}) => ({
  route: 'staff-step',
  id: '11111111-2222-4333-8444-555555555555',
  title_key,
  params,
});

function msg(lang: Lang, key: string, params: Record<string, unknown> = {}) {
  const m = staffMessage(lang, 'staff_task', payload(key, params), ROUTES);
  if (!m.ok) throw new Error(m.error);
  return m;
}

describe('staff-push.json', () => {
  it('lists the four staff kinds, twenty-six title keys and seven routes, each once', () => {
    expect(staffPush.kinds).toEqual(['staff_task', 'staff_decide', 'staff_decided', 'staff_info']);
    expect(staffPush.title_keys).toHaveLength(26);
    expect(new Set(staffPush.title_keys).size).toBe(staffPush.title_keys.length);
    expect(staffPush.title_keys.slice(15)).toEqual(ROLE_SPEC_KEYS);
    expect(staffPush.routes).toEqual([
      'staff',
      'staff-step',
      'staff-run',
      'staff-request',
      'staff-shopping',
      'staff-checklist',
      'staff-notes',
    ]);
  });

  // Until staff_push_keys_wave5 lists wave 5's eleven keys in the JSON (§2.3):
  // every JSON key has copy, and so does each of the eleven.
  it('has copy in both languages for every title key and each wave-5 key', () => {
    for (const lang of ['en', 'ar'] as const) {
      expect(Object.keys(STAFF_STRINGS[lang]).sort()).toEqual(
        [...staffPush.title_keys, ...WAVE5_KEYS].sort(),
      );
      for (const key of [...staffPush.title_keys, ...WAVE5_KEYS]) {
        expect(
          STAFF_STRINGS[lang][key as keyof (typeof STAFF_STRINGS)['en']].title.trim(),
        ).not.toBe('');
      }
    }
  });

  it('writes every Arabic title in Arabic', () => {
    for (const key of [...staffPush.title_keys, ...WAVE5_KEYS]) {
      const ar = STAFF_STRINGS.ar[key as keyof (typeof STAFF_STRINGS)['ar']].title;
      expect(ar).toMatch(/[\u0600-\u06FF]/);
      expect(ar).not.toBe(STAFF_STRINGS.en[key as keyof (typeof STAFF_STRINGS)['en']].title);
    }
  });
});

describe('staffMessage — the EN copy of §2.21', () => {
  const full = { step: STEP, title: 'Matcha latte' };
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ['step_open', full, 'New task', `${iso('Price')}: ${iso('Matcha latte')}`],
    ['step_submitted', full, 'Waiting on you', `${iso('Price')}: ${iso('Matcha latte')}`],
    ['step_approved', full, 'Approved', `${iso('Price')}: ${iso('Matcha latte')}`],
    ['step_sent_back', full, 'Sent back for changes', `${iso('Price')}: ${iso('Matcha latte')}`],
    ['step_stopped', full, 'Stopped', iso('Matcha latte')],
    ['run_stopped', { title: 'Matcha latte' }, 'Stopped', iso('Matcha latte')],
    ['run_live', { title: 'Matcha latte' }, 'Launched', `${iso('Matcha latte')} is on the menu.`],
    [
      'launch_not_ready',
      full,
      'Launch postponed',
      `${iso('Matcha latte')} was not ready on the date. Open it to fix and launch again.`,
    ],
    [
      'apply_not_ready',
      full,
      'Change postponed',
      `${iso('Matcha latte')} could not be applied on the date.`,
    ],
    ['review_ready', { title: 'Matcha latte' }, '30-day review ready', iso('Matcha latte')],
    ['request_submitted', { name: 'Sara' }, 'Staff request', `${iso('Sara')} sent a request.`],
    ['request_approved', {}, 'Request approved', ''],
    ['request_rejected', {}, 'Request declined', ''],
    ['shopping_new', {}, 'Shopping list', 'New items to buy.'],
    [
      'purchase_to_receive',
      {},
      'Purchase to receive',
      'Receive it in Stock ▸ Goods in on the operator.',
    ],
    // Role spec (§2.21).
    [
      'idea_submitted',
      { name: 'Yusuf', title: 'Rose latte' },
      'New item idea',
      `${iso('Yusuf')}: ${iso('Rose latte')}`,
    ],
    [
      'idea_started',
      { title: 'Rose latte' },
      'Idea started',
      `${iso('Rose latte')} is now a new-item proposal.`,
    ],
    ['idea_declined', { title: 'Rose latte' }, 'Idea declined', iso('Rose latte')],
    [
      'teaching_new',
      { name: 'Bareq', title: 'Milk texture' },
      'New teaching',
      `${iso('Bareq')}: ${iso('Milk texture')}`,
    ],
    [
      'recipe_change_submitted',
      { name: 'Rusul', step: { en: 'Brownie', ar: 'براوني' } },
      'Recipe change',
      `${iso('Rusul')}: ${iso('Brownie')}`,
    ],
    [
      'recipe_change_approved',
      { step: { en: 'Brownie', ar: 'براوني' } },
      'Recipe change approved',
      iso('Brownie'),
    ],
    [
      'recipe_change_declined',
      { step: { en: 'Brownie', ar: 'براوني' } },
      'Recipe change declined',
      iso('Brownie'),
    ],
    [
      'shopping_to_approve',
      { name: 'Tiba' },
      'Shopping list',
      `${iso('Tiba')} added items for your OK.`,
    ],
    ['shopping_declined', {}, 'Shopping list', 'An item you added was declined.'],
    [
      'marketing_request_new',
      { name: 'Hasan', title: 'Poster' },
      'Marketing request',
      `${iso('Hasan')}: ${iso('Poster')}`,
    ],
    ['marketing_request_answered', { title: 'Poster' }, 'Marketing answered', iso('Poster')],
    // Wave 5 (wave5-addendum §2.3): no amount, reason or target on any of them.
    ['deduction_proposed', { name: 'Bareq' }, 'Pay deduction', `${iso('Bareq')} proposed a deduction.`],
    ['deduction_approved', {}, 'Deduction approved', 'Your proposal was approved.'],
    ['deduction_declined', {}, 'Deduction declined', 'Your proposal was declined.'],
    ['deduction_recorded', {}, 'Pay deduction', 'A deduction was added to your record.'],
    [
      'incident_reported',
      { name: 'Hussein', step: { en: 'Injury', ar: 'إصابة' } },
      'Incident report',
      `${iso('Hussein')}: ${iso('Injury')}`,
    ],
    ['incident_reviewed', { step: { en: 'Injury', ar: 'إصابة' } }, 'Incident reviewed', iso('Injury')],
    [
      'content_submitted',
      { name: 'Hasan', title: 'Friday reel' },
      'Content for approval',
      `${iso('Hasan')}: ${iso('Friday reel')}`,
    ],
    ['content_approved', { title: 'Friday reel' }, 'Content approved', iso('Friday reel')],
    ['content_changes', { title: 'Friday reel' }, 'Changes asked', iso('Friday reel')],
    ['content_declined', { title: 'Friday reel' }, 'Content declined', iso('Friday reel')],
    ['waiter_call_new', { title: 'T12' }, 'Guest call', `Table ${iso('T12')}`],
  ];

  it.each(cases)('%s', (key, params, title, body) => {
    const m = msg('en', key, params);
    expect(m.title).toBe(title);
    expect(m.body).toBe(body);
  });

  it('covers every title key in the list, and each wave-5 key', () => {
    expect(cases.map(([k]) => k).sort()).toEqual([...staffPush.title_keys, ...WAVE5_KEYS].sort());
  });
});

describe('staffMessage — params', () => {
  it('sends the step alone when the run has no title (hiring)', () => {
    expect(msg('en', 'step_open', { step: STEP }).body).toBe(iso('Price'));
    expect(msg('en', 'step_stopped', { step: STEP }).body).toBe(iso('Price'));
  });

  it('names the step in the reader’s language, falling back to the other', () => {
    expect(msg('ar', 'step_open', { step: STEP, title: 'لاتيه' }).body).toBe(
      `${iso('السعر')}: ${iso('لاتيه')}`,
    );
    expect(msg('ar', 'step_open', { step: { en: 'Price' } }).body).toBe(iso('Price'));
    expect(msg('en', 'step_open', { step: { ar: 'السعر', en: '  ' } }).body).toBe(iso('السعر'));
  });

  it('sends the title alone when a sentence has nothing to name', () => {
    expect(msg('en', 'run_live').body).toBe('');
    expect(msg('ar', 'request_submitted').body).toBe('');
    expect(msg('en', 'step_open', { step: 42, title: ['x'] }).body).toBe('');
  });

  it('isolates typed text inside an Arabic sentence', () => {
    expect(msg('ar', 'run_live', { title: 'Matcha latte' }).body).toBe(
      `${iso('Matcha latte')} متوفر الآن في القائمة.`,
    );
    expect(msg('ar', 'shopping_to_approve', { name: 'Tiba' }).body).toBe(
      `أضاف ${iso('Tiba')} أغراضًا بانتظار موافقتك.`,
    );
  });

  it('sends one half of a role-spec pair when the other is missing', () => {
    expect(msg('en', 'idea_submitted', { title: 'Rose latte' }).body).toBe(iso('Rose latte'));
    expect(msg('en', 'teaching_new', { name: 'Bareq' }).body).toBe(iso('Bareq'));
    expect(msg('ar', 'recipe_change_submitted', { name: 'Rusul' }).body).toBe(iso('Rusul'));
    expect(msg('en', 'recipe_change_approved').body).toBe('');
    expect(msg('ar', 'idea_started').body).toBe('');
  });

  it('names no amount on a deduction, and sends the title alone without a name or table', () => {
    // The params are closed to {step, title, name} (app.notify_staff), so an
    // amount can only arrive as one of those; the deduction copy reads none but name.
    expect(msg('en', 'deduction_approved', { title: '50000', step: { en: '50000' } }).body).toBe(
      'Your proposal was approved.',
    );
    expect(msg('ar', 'deduction_recorded', { name: 'Yusuf' }).body).toBe('أُضيف خصم إلى سجلّك.');
    expect(msg('en', 'deduction_proposed').body).toBe('');
    expect(msg('ar', 'waiter_call_new').body).toBe('');
    expect(msg('ar', 'waiter_call_new', { title: 'T12' }).body).toBe(`طاولة ${iso('T12')}`);
    expect(msg('ar', 'incident_reported', { name: 'Hussein', step: { en: 'Injury', ar: 'إصابة' } }).body).toBe(
      `${iso('Hussein')}: ${iso('إصابة')}`,
    );
  });
});

describe('staffMessage — data and refusals', () => {
  it('carries {kind, route, id} and nothing else', () => {
    const m = staffMessage(
      'en',
      'staff_decide',
      { ...payload('step_submitted', { title: 'x', name: 'y' }), dedupe: 'd' } as never,
      ROUTES,
    );
    expect(m.ok && m.data).toEqual({
      kind: 'staff_decide',
      route: 'staff-step',
      id: '11111111-2222-4333-8444-555555555555',
    });
  });

  it('drops a route the phone does not know, and a non-string id', () => {
    const m = staffMessage(
      'en',
      'staff_task',
      { title_key: 'shopping_new', route: 'booking', id: 7 },
      ROUTES,
    );
    expect(m.ok && m.data).toEqual({ kind: 'staff_task' });
  });

  it('refuses an unknown or missing title key with UNKNOWN_TITLE_KEY', () => {
    expect(staffMessage('en', 'staff_task', payload('step_exploded'), ROUTES)).toEqual({
      ok: false,
      error: 'UNKNOWN_TITLE_KEY:step_exploded',
    });
    expect(staffMessage('ar', 'staff_task', { route: 'staff' }, ROUTES)).toEqual({
      ok: false,
      error: 'UNKNOWN_TITLE_KEY:undefined',
    });
    // Inherited names are not copy.
    expect(staffMessage('en', 'staff_task', payload('toString'), ROUTES).ok).toBe(false);
  });
});

describe('send-push/index.ts wiring', () => {
  it('reads the staff kinds and routes from the shared list and the copy from staffStrings.ts', () => {
    expect(INDEX).toMatch(
      /import staffPush from '\.\.\/_shared\/staff-push\.json' with \{ type: 'json' \};/,
    );
    expect(INDEX).toMatch(/import \{ staffMessage \} from '\.\/staffStrings\.ts';/);
    expect(INDEX).toMatch(/new Set\(staffPush\.kinds\)/);
    expect(INDEX).toMatch(/new Set\(staffPush\.routes\)/);
  });

  it('caps attempts on an unknown title key, as on an unknown kind', () => {
    const branch = INDEX.slice(
      INDEX.indexOf('STAFF_KINDS.has(row.kind)'),
      INDEX.indexOf('const s = STRINGS[lang]'),
    );
    expect(branch).toMatch(/last_error: m\.error, attempts: RETRY_CAP/);
  });

  it('keeps the booking kinds on their own copy table', () => {
    for (const kind of staffPush.kinds)
      expect(INDEX).not.toMatch(new RegExp(`^\\s+${kind}: \\{`, 'm'));
  });
});
