/**
 * release-review (build-contracts-2026-09-23 §2.20, §2.10, §8.2): the day-30
 * review of a released item.
 *
 *   * the pure half (supabase/functions/release-review/review.ts), no Deno,
 *     no model: the input read defensively, the thin floor, the template, the
 *     structured answer parsed, the number gate (an amount the input does not
 *     carry is dropped) and the campaign rule, and the tick against fake
 *     ports: thin never calls the model, a written review records its usage,
 *     no key or the cap falls back to the template, a gated-out answer falls
 *     back too, and one bad run never stops the others;
 *   * with the stack: app.release_review_input and
 *     app.release_launch_scheduled answer the service role (never
 *     FORBIDDEN); the input's notes and marketing's take are text only, with
 *     no author name anywhere, and no key a guest identity would sit under;
 *     the driver and marketing cannot run either function, nor read a review.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, SEED_TAX_GROUP_STANDARD, VENUE_A_ID } from './helpers';
import {
  MIN_ITEM_UNITS,
  REVIEW_SCHEMA,
  REVIEW_SYSTEM,
  gateWriteUp,
  isThin,
  parseWriteUp,
  readInput,
  reviewTick,
  reviewUserTurn,
  sentencesOf,
  templateWriteUp,
  type ReviewInput,
  type ReviewPorts,
  type ReviewStatus,
  type Usage,
  type WriteUp,
} from '../supabase/functions/release-review/review.ts';

const INPUT: ReviewInput = {
  item: { name_en: 'Rose Latte', name_ar: 'لاتيه الورد' },
  numbers: {
    units: 120,
    revenue_iqd: 540000,
    margin_iqd: 378000,
    margin_pct: 70,
    category_share_pct: 18.5,
    days_sold: 26,
    bought_with: [{ item_id: 'i2', name_en: 'Croissant', name_ar: 'كرواسون', count: 31 }],
    from: '2026-08-20',
    to: '2026-09-19',
  },
  notes: ['Guests ask for it warm'],
  marketing_take: ['Photographs well'],
  campaign_has_promotion: false,
};

describe('release-review: the input and the template', () => {
  it('reads the input defensively', () => {
    expect(readInput(null)).toBeNull();
    expect(readInput({ notes: [] })).toBeNull();
    const r = readInput({ numbers: { units: '7', bought_with: [{ name_en: 'x' }] }, notes: ['a', 3, ' '], campaign_has_promotion: 'yes' })!;
    expect(r.numbers).toMatchObject({ units: 0, margin_iqd: null, bought_with: [] });
    expect(r.notes).toEqual(['a']);
    expect(r.campaign_has_promotion).toBe(false);
    expect(readInput(JSON.parse(JSON.stringify(INPUT)))).toEqual(INPUT);
  });

  it('is thin below the item floor', () => {
    const at = (units: number) => isThin({ ...INPUT, numbers: { ...INPUT.numbers, units } });
    expect(at(MIN_ITEM_UNITS - 1)).toBe(true);
    expect(at(MIN_ITEM_UNITS)).toBe(false);
  });

  it('templates the review from the numbers only, in both languages', () => {
    const t = templateWriteUp(INPUT, false);
    expect(t.en).toContain('Rose Latte sold 120');
    expect(t.en).toContain('540,000 IQD');
    expect(t.en).toContain('378,000 IQD (70%)');
    expect(t.en).toContain('Croissant (31 orders)');
    expect(t.ar).toContain('لاتيه الورد');
    expect(t.ar).toContain('540,000 د.ع');
    // The template passes its own gate: every amount it prints is the input's.
    expect(gateWriteUp(t, INPUT)).toEqual({ writeUp: t, dropped: 0 });
    const unknown = templateWriteUp({ ...INPUT, numbers: { ...INPUT.numbers, margin_iqd: null, margin_pct: null } }, false);
    expect(unknown.en).toContain('cost is not known yet');
    const thin = templateWriteUp({ ...INPUT, numbers: { ...INPUT.numbers, units: 3 } }, true);
    expect(thin.en).toMatch(/not enough data yet/);
    expect(thin.ar).toMatch(/غير كافية/);
  });

  it('sends the model the input and nothing else, and asks for {en, ar}', () => {
    expect(JSON.parse(reviewUserTurn(INPUT))).toEqual(INPUT);
    expect(REVIEW_SCHEMA).toMatchObject({ required: ['en', 'ar'], additionalProperties: false });
    expect(REVIEW_SYSTEM).toMatch(/campaign_has_promotion is true/);
    expect(REVIEW_SYSTEM).toMatch(/Never name or describe a person/);
  });
});

describe('release-review: the answer and the gate', () => {
  it('parses the structured answer', () => {
    expect(parseWriteUp('{"en":" Good. ","ar":"جيد."}')).toEqual({ en: 'Good.', ar: 'جيد.' });
    expect(parseWriteUp('Here you go: {"en":"a","ar":"b"} done')).toEqual({ en: 'a', ar: 'b' });
    expect(parseWriteUp('{"en":"only english"}')).toBeNull();
    expect(parseWriteUp('not json')).toBeNull();
    expect(parseWriteUp(JSON.stringify({ en: 'x'.repeat(3000), ar: 'y' }))!.en).toHaveLength(2000);
  });

  it('splits sentences in both scripts', () => {
    expect(sentencesOf('One. Two! Three? أربعة؟ خمسة.')).toEqual(['One.', 'Two!', 'Three?', 'أربعة؟', 'خمسة.']);
  });

  it('drops a sentence citing an amount the input does not carry', () => {
    const w: WriteUp = {
      en: 'It earned 540,000 IQD. That is about 18,000 IQD a day. It sold with Croissant.',
      ar: 'حقق 540,000 د.ع. أي نحو 18,000 د.ع يومياً.',
    };
    expect(gateWriteUp(w, INPUT)).toEqual({
      writeUp: { en: 'It earned 540,000 IQD. It sold with Croissant.', ar: 'حقق 540,000 د.ع.' },
      dropped: 2,
    });
  });

  it('claims a campaign effect only when the launch campaign carried a promotion', () => {
    const w: WriteUp = {
      en: 'It sold 120. The launch campaign lifted sales.',
      ar: 'باع 120. رفعت الحملة المبيعات.',
    };
    expect(gateWriteUp(w, INPUT).writeUp).toEqual({ en: 'It sold 120.', ar: 'باع 120.' });
    expect(gateWriteUp(w, { ...INPUT, campaign_has_promotion: true }).writeUp).toEqual(w);
  });

  it('fails a write-up the gate empties in either language', () => {
    expect(gateWriteUp({ en: 'It made 1,000,000 IQD.', ar: 'حقق 540,000 د.ع.' }, INPUT).writeUp).toBeNull();
  });
});

// ── the tick against fake ports ─────────────────────────────────────────────
interface Saved {
  run: string;
  status: ReviewStatus;
  model: string | null;
  writeUp: WriteUp | null;
}
function fakePorts(opts: {
  inputs: Record<string, unknown>;
  answer?: string;
  noKey?: boolean;
  capped?: boolean;
  throwOn?: string;
}) {
  const saved: Saved[] = [];
  const recorded: Array<{ model: string; usage: Usage }> = [];
  const calls = { begin: 0, write: 0 };
  const usage: Usage = { input: 1000, cache_write: 0, cache_read: 0, output: 200 };
  const ports: ReviewPorts = {
    dueReviews: async () => Object.keys(opts.inputs).map((run_id) => ({ run_id, venue_id: VENUE_A_ID })),
    input: async (runId) => {
      if (runId === opts.throwOn) throw new Error('boom');
      return opts.inputs[runId];
    },
    modelFor: async () => 'claude-opus-5',
    writer: (model) =>
      opts.noKey
        ? null
        : {
            model: model ?? 'default',
            write: async () => {
              calls.write += 1;
              return { raw: opts.answer ?? '{"en":"It sold 120.","ar":"باع 120."}', usage, stop_reason: 'end_turn' };
            },
          },
    beginRequest: async () => {
      calls.begin += 1;
      if (opts.capped) throw new Error('llm_begin_request: LLM_MONTHLY_CAP');
    },
    recordUsage: async (model, u) => {
      recorded.push({ model, usage: u });
    },
    save: async (run, _numbers, writeUp, status, model) => {
      saved.push({ run, status, model, writeUp });
    },
    log: () => undefined,
  };
  return { ports, saved, recorded, calls };
}

describe('release-review: the tick', () => {
  const thinInput = { ...INPUT, numbers: { ...INPUT.numbers, units: 2 } };

  it('writes a thin review with no model call', async () => {
    const f = fakePorts({ inputs: { r1: thinInput } });
    expect(await reviewTick(f.ports)).toEqual({ written: 0, thin: 1, fallback: 0, failed: 0 });
    expect(f.calls).toEqual({ begin: 0, write: 0 });
    expect(f.saved[0]).toMatchObject({ run: 'r1', status: 'thin', model: null });
    expect(f.saved[0]!.writeUp!.en).toMatch(/not enough data yet/);
  });

  it('writes the model’s review under the cap and records what it spent', async () => {
    const f = fakePorts({ inputs: { r1: INPUT } });
    expect(await reviewTick(f.ports)).toEqual({ written: 1, thin: 0, fallback: 0, failed: 0 });
    expect(f.calls).toEqual({ begin: 1, write: 1 });
    expect(f.saved[0]).toEqual({ run: 'r1', status: 'written', model: 'claude-opus-5', writeUp: { en: 'It sold 120.', ar: 'باع 120.' } });
    expect(f.recorded).toEqual([{ model: 'claude-opus-5', usage: { input: 1000, cache_write: 0, cache_read: 0, output: 200 } }]);
  });

  it('falls back to the template with no key, at the cap, or when the gate empties the answer', async () => {
    const noKey = fakePorts({ inputs: { r1: INPUT }, noKey: true });
    expect(await reviewTick(noKey.ports)).toMatchObject({ fallback: 1 });
    expect(noKey.calls.begin).toBe(0);

    const capped = fakePorts({ inputs: { r1: INPUT }, capped: true });
    expect(await reviewTick(capped.ports)).toMatchObject({ fallback: 1 });
    expect(capped.calls.write).toBe(0);
    expect(capped.recorded).toEqual([]);

    const invented = fakePorts({ inputs: { r1: INPUT }, answer: '{"en":"It made 999,999 IQD.","ar":"حقق 999,999 د.ع."}' });
    expect(await reviewTick(invented.ports)).toMatchObject({ fallback: 1 });
    // The call happened, so it is metered even though its answer was dropped.
    expect(invented.recorded).toHaveLength(1);
    expect(invented.saved[0]).toMatchObject({ status: 'fallback', model: null });
    expect(invented.saved[0]!.writeUp).toEqual(templateWriteUp(INPUT, false));
  });

  it('goes on to the next run when one fails', async () => {
    const f = fakePorts({ inputs: { r1: INPUT, r2: INPUT }, throwOn: 'r1' });
    expect(await reviewTick(f.ports)).toEqual({ written: 1, thin: 0, fallback: 0, failed: 1 });
    expect(f.saved.map((s) => s.run)).toEqual(['r2']);
  });
});

// ── with the stack ──────────────────────────────────────────────────────────
const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

/**
 * One rolled-back transaction: an owner-run release launched now (the
 * owner's own steps pass at once), notes by named staff, marketing's take,
 * then the two service-role functions and the client refusals. Each result
 * is one `label<TAB>json` line.
 */
function stackScenario(): Record<string, { ok: boolean; data?: unknown; state?: string; code?: string }> {
  // One call as a role with the claims a SQL expression builds; its result
  // or its error is kept under a label.
  const call = (label: string, claims: string, role: string, sql: string) => `
    select set_config('request.jwt.claims', (${claims})::text, true);
    set local role ${role};
    do $d$ begin
      insert into pg_temp.out values ('${label}', jsonb_build_object('ok', true, 'data', (${sql})));
    exception when others then
      insert into pg_temp.out values ('${label}', jsonb_build_object('ok', false, 'code', sqlerrm, 'state', sqlstate));
    end $d$;
    reset role;`;
  const svc = `json_build_object('role', 'service_role')`;
  const staff = (name: string) =>
    `json_build_object('sub', (select val from pg_temp.v where name = '${name}'), 'role', 'authenticated')`;
  const run = `(select val::uuid from pg_temp.v where name = 'run')`;
  const raw = psql(`
    begin;
    create temp table out (label text, res jsonb);
    grant all on pg_temp.out to service_role, authenticated;
    create temp table v (name text primary key, val text);
    grant select on pg_temp.v to service_role, authenticated;
    do $s$
    declare
      v_owner uuid := '${SEED_STAFF_IDS.owner}';
      v_cat uuid; v_ing uuid; v_run uuid; v_item uuid; v_var uuid; v_photo text; v_step uuid;
      v_writer uuid := gen_random_uuid(); v_mkt uuid := gen_random_uuid(); v_drv uuid := gen_random_uuid();
    begin
      insert into auth.users (id, email, raw_user_meta_data, aud, role) values
        (v_writer, 'rr-writer-' || v_writer || '@test.touch.local', '{}', 'authenticated', 'authenticated'),
        (v_mkt, 'rr-mkt-' || v_mkt || '@test.touch.local', '{}', 'authenticated', 'authenticated'),
        (v_drv, 'rr-drv-' || v_drv || '@test.touch.local', '{}', 'authenticated', 'authenticated');
      insert into staff (id, display_name, role, is_active) values
        (v_writer, 'Zaynab Qasimova', 'cashier', true),
        (v_mkt, 'Farida Mamedova', 'marketing', true),
        (v_drv, 'RR driver', 'driver', true);
      insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
      values ('RR cakes', 'كعك', '${SEED_TAX_GROUP_STANDARD}', true, '${VENUE_A_ID}', 'cafe') returning id into v_cat;
      insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
      values ('purchased', 'RR sugar', 'سكر', 'g', true, '${VENUE_A_ID}') returning id into v_ing;

      -- The owner's own steps pass at once: a release from proposal to launch.
      perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      v_run := (app.start_protocol('product_release', null, 'Honey cake', 'كعكة العسل', '{}'::jsonb,
                  jsonb_build_object('name_en', 'Honey cake', 'item_kind', 'dessert', 'category_id', v_cat,
                    'lines', jsonb_build_array(jsonb_build_object('ingredient_id', v_ing, 'qty', 50, 'unit', 'g')),
                    'sizes', jsonb_build_array(jsonb_build_object('name_en', 'Slice'))),
                  '{}'::text[], '${VENUE_A_ID}', null)->>'run_id')::uuid;
      select menu_item_id into v_item from protocol_runs where id = v_run;
      select id into v_var from menu_item_variants where item_id = v_item;
      v_photo := app.staff_media_slot('${VENUE_A_ID}', 'tests', 'jpg')->>'path';
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'test';
      perform app.submit_step(v_step, jsonb_build_object('servings', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'count', 1))), array[v_photo]);
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'analysis';
      perform app.submit_step(v_step, jsonb_build_object('prices', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'price_iqd', 4000)),
                                                         'name_en', 'Honey cake', 'name_ar', 'كعكة العسل'), '{}'::text[]);
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'marketing';
      perform app.submit_step(v_step, jsonb_build_object('highlights_en', 'Sweet', 'highlights_ar', 'حلوة'), '{}'::text[]);
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'launch';
      -- What protocol-action's copy leaves in the public menu bucket.
      insert into storage.objects (bucket_id, name) values ('menu-media', app.release_menu_photo_path(v_run, v_photo));
      perform app.submit_step(v_step, jsonb_build_object('when', 'now', 'photo_path', v_photo,
                                                         'menu_photo_path', app.release_menu_photo_path(v_run, v_photo)), '{}'::text[]);

      -- A staff note and marketing's take, by people with distinctive names.
      perform set_config('request.jwt.claims', json_build_object('sub', v_writer, 'role', 'authenticated')::text, true);
      perform app.add_release_note(v_item, 'Regulars love the crust', null);
      perform set_config('request.jwt.claims', json_build_object('sub', v_mkt, 'role', 'authenticated')::text, true);
      perform app.add_marketing_note('${VENUE_A_ID}', 'item', v_item, 'Best seller on the story', '{}'::text[], null);

      insert into pg_temp.v values ('run', v_run::text), ('drv', v_drv::text), ('mkt', v_mkt::text);
    end $s$;
    ${call('input', svc, 'service_role', `app.release_review_input(${run})`)}
    ${call('sched', svc, 'service_role', `to_jsonb(app.release_launch_scheduled(${run}, 'items/x.jpg'))`)}
    ${call('sched_none', svc, 'service_role', `to_jsonb(app.release_launch_scheduled(gen_random_uuid(), 'items/x.jpg'))`)}
    ${['drv', 'mkt']
      .map(
        (w) => `
    ${call(`${w}_input`, staff(w), 'authenticated', `app.release_review_input(${run})`)}
    ${call(`${w}_sched`, staff(w), 'authenticated', `to_jsonb(app.release_launch_scheduled(${run}, 'items/x.jpg'))`)}
    ${call(`${w}_review`, staff(w), 'authenticated', `app.release_review(${run})`)}`,
      )
      .join('\n')}
    select label || E'\\t' || res::text from pg_temp.out;
    rollback;`);
  const out: Record<string, { ok: boolean; data?: unknown; state?: string; code?: string }> = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    out[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1));
  }
  return out;
}

describe.skipIf(!docker)('release-review: the service-role functions (rolled-back transaction)', () => {
  it('answers the service role, carries no author name, and refuses the driver and marketing', () => {
    const r = stackScenario();
    expect(r.input!.ok).toBe(true);
    const input = r.input!.data as ReviewInput;
    expect(input.item).toEqual({ name_en: 'Honey cake', name_ar: 'كعكة العسل' });
    expect(input.notes).toEqual(['Regulars love the crust']);
    expect(input.marketing_take).toEqual(['Best seller on the story']);
    const text = JSON.stringify(input);
    for (const name of ['Zaynab', 'Qasimova', 'Farida', 'Mamedova']) expect(text).not.toContain(name);
    // No key a person or a guest identity would sit under (SEC-29's list).
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(input);
    for (const k of keys) expect(k).not.toMatch(/author|guest|customer|profile|phone|email|user_id|session_id|device_id|staff/i);
    expect(readInput(input)).not.toBeNull();

    // The launch path answers the service role: a live run is 'launched'
    // (a retry), an unknown one PROTOCOL_NOT_FOUND, never FORBIDDEN.
    expect(r.sched).toEqual({ ok: true, data: 'launched' });
    expect(r.sched_none).toMatchObject({ ok: false, code: 'PROTOCOL_NOT_FOUND' });
    for (const w of ['drv', 'mkt']) {
      expect(r[`${w}_input`], w).toMatchObject({ ok: false, state: '42501' });
      expect(r[`${w}_sched`], w).toMatchObject({ ok: false, state: '42501' });
      expect(r[`${w}_review`], w).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }
  });
});
