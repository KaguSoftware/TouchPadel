/**
 * incident_reports (wave5-addendum-2026-09-25 §2.6, §2.0, §4.2, §6.1;
 * contracts §8.2): staff report accidents, fights, injuries and damage; MGMT
 * review them; the text and the photos go after a year, or at once when the
 * owner redacts; nothing reaches the owner assistant.
 *
 *   * filing: every role files, the driver, marketing and both wave-5 roles
 *     included; MGMT hear incident_reported with the reporter's name and the
 *     kind only; the court, time, text and photo checks refuse bad input; a
 *     retry under one key is one report;
 *   * reviewing: MGMT with a note, never their own report, once; the
 *     reporter hears incident_reviewed and reads the note;
 *   * reads: incidents_page and the table are MGMT's; my_incidents the
 *     reporter's own; a photo reads to the reporter and MGMT only;
 *   * purge and redaction: the purge leaves the marker and the NULLs and
 *     keeps the counts; the photo pair lists and empties the paths; a
 *     redaction is the owner's and state-idempotent; a note written after it
 *     goes at the next purge; incident and campaign photos nobody claimed a
 *     day on are listed for the tick and held from any later claim, and
 *     nothing else is;
 *   * the kind labels on the push are work.incident.kind.* (§4.2);
 *   * the LLM wall: no assistant_readable_columns row, and the audit carries
 *     no text.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, courts, slots, storage rows
 * and reports are created inside it and each call runs as `authenticated`
 * (or `service_role`) with the caller's JWT claims. Nothing is committed.
 * Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { workAr } from '../../i18n/src/catalogs/work.ar';
import { workEn } from '../../i18n/src/catalogs/work.en';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

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

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
// t() runs one statement as a staff member (as `authenticated`); as() runs it
// as the definer's caller (postgres, with the JWT claims set) for internal
// functions; q() reads as postgres; keep() stores a value; mk() makes an auth
// user + staff row (the 0123 trigger files a non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text, p_role text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if p_role is not null then execute 'set local role ' || p_role; end if;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'ir-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'IR ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A photo: a slot minted by p_who in p_folder, and its storage object.
create function pg_temp.photo(p_name text, p_who text, p_folder text) returns void language plpgsql as $f$
declare v_uid uuid; v_path text;
begin
  select val::uuid into v_uid from pg_temp.vars where name = p_who;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_path := app.staff_media_slot('${VENUE_A_ID}', p_folder, 'jpg')->>'path';
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('staff-media', v_path, v_uid, v_uid::text);
  insert into pg_temp.vars values (p_name, v_path);
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `select label || E'\\t' || res::text from pg_temp.out order by seq;\nrollback;\n`,
  );
  const results: Results = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    results[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)) as Outcome;
  }
  return results;
}

const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
/** Through the staff_media_read storage policy, as the reader. */
const SEES = (label: string, who: string, photo: string) =>
  T(label, who, `select to_jsonb(count(*) = 1) from storage.objects where bucket_id = 'staff-media' and name = {{${photo}}}`);

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}

const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
/** As the service role, the way protocol-action's tick calls the photo pair. */
const SVC = (label: string, sql: string) => `select pg_temp.run('${label}', 'owner', $q$${sql}$q$, 'service_role');`;
const OTHER_VENUE = '00000000-0000-4000-8000-00000000e3e3';
/** An inactive venue nobody here works at, with a court. */
const OTHER_VENUE_SQL = [
  `insert into venues (id, slug, name_en, name_ar, is_active)
   values ('${OTHER_VENUE}', 'ir-other-venue', 'IR other', 'مكان آخر', false);`,
  KEEP('far_court', `insert into courts (name_en, name_ar, venue_id) values ('IR far', 'بعيد', '${OTHER_VENUE}') returning id::text`),
];
const COURT = KEEP('court', `insert into courts (name_en, name_ar, venue_id, is_active)
                             values ('IR court 9', 'ملعب ٩', {{venue}}, false) returning id::text`);

const report = (who: string, label: string, extra = '', kind = 'injury', place = 'cafe') =>
  T(label, who, `select app.submit_incident('${kind}', now() - interval '1 hour', '${place}',
                                            'A guest slipped by the counter'${extra})`);

/** §4.2: the words of work.incident.kind.*, which the push's step must carry. */
const KIND_LABELS = {
  accident: { en: 'Accident', ar: 'حادث' },
  injury: { en: 'Injury', ar: 'إصابة' },
  fight: { en: 'Fight', ar: 'شجار' },
  damage: { en: 'Damage', ar: 'ضرر' },
  other: { en: 'Other', ar: 'أخرى' },
} as const;

interface Incident { id: string; status: string; description: string; people_involved: string | null;
                     review_note: string | null; redacted: boolean; photos: string[]; [k: string]: unknown }

describe('incident_reports: the kind labels', () => {
  it('match work.incident.kind.* once the catalog carries them', () => {
    // W0 lands work.incident (wave5-addendum §1.4 #3) before this migration
    // commits; until then the §4.2 words are the reference.
    const en = (workEn as unknown as { incident?: { kind?: Record<string, string> } }).incident?.kind;
    const ar = (workAr as unknown as { incident?: { kind?: Record<string, string> } }).incident?.kind;
    if (en) expect(en).toEqual(Object.fromEntries(Object.entries(KIND_LABELS).map(([k, v]) => [k, v.en])));
    if (ar) expect(ar).toEqual(Object.fromEntries(Object.entries(KIND_LABELS).map(([k, v]) => [k, v.ar])));
    expect(Object.keys(KIND_LABELS)).toEqual(['accident', 'injury', 'fight', 'damage', 'other']);
  });
});

describe.skipIf(!docker)('incident_reports (rolled-back transactions)', () => {
  it('every role files a report; MGMT hear the reporter’s name and the kind only', () => {
    const roles = ['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'marketing', 'assistant_barista', 'waiter'] as const;
    const everyone = [...roles, 'cashier', 'desk', 'prep', 'manager', 'owner'] as const;
    const r = scenario([
      ...roles.map((role) => MK(role, role)),
      COURT,
      ...everyone.map((who) => report(who, `f_${who}`)),
      T('on_court', 'desk', `select app.submit_incident('fight', now() - interval '2 hours', 'court', 'Two players argued',
                                                        p_court_id => {{court}}::uuid, p_place_detail => 'By the net',
                                                        p_people_involved => 'Two regulars')`),
      RES('court_id', 'on_court', 'id'),
      Q('push', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)), '[]'::jsonb)
                   from notification_outbox o
                  where o.created_at = now() and o.payload->>'title_key' = 'incident_reported'`),
      Q('row', `select jsonb_build_object('kind', kind, 'place', place, 'court_id', court_id, 'place_detail', place_detail,
                                          'people_involved', people_involved, 'status', status, 'reported_by', reported_by,
                                          'purge_days', extract(day from purge_after - reported_at))
                  from incident_reports where id = {{court_id}}::uuid`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', action, 'after', after, 'before', before))
                    from audit_log where entity = 'incident_report' and entity_id = {{court_id}}`),
      Q('who', `select jsonb_build_object('driver', {{driver}}, 'marketing', {{marketing}}, 'desk', {{desk}},
                                          'manager', {{manager}}, 'owner', {{owner}}, 'court', {{court}})`),
      ...(Object.keys(KIND_LABELS)).map((k) => Q(`label_${k}`, `select app.incident_kind_label('${k}')`)),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    for (const w of everyone) expect(ok<{ id: string }>(r, `f_${w}`).id, w).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok(r, 'row')).toEqual({ kind: 'fight', place: 'court', court_id: who.court, place_detail: 'By the net',
                                   people_involved: 'Two regulars', status: 'open', reported_by: who.desk, purge_days: 365 });
    expect(ok(r, 'audit')).toEqual([{ action: 'incident.report', before: null,
                                      after: { kind: 'fight', place: 'court', court_id: who.court, photos: 0 } }]);

    const push = ok<Array<{ to: string; kind: string; payload: { params: Record<string, unknown> } & Record<string, unknown> }>>(r, 'push');
    // The desk's report reaches the manager and the owner, with no text.
    const desk = push.filter((p) => p.payload.params.name === 'Dev Court Desk' || p.payload.params.name === 'Dev Desk');
    expect(desk.length).toBeGreaterThan(0);
    const court = push.filter((p) => (p.payload.params.step as { en: string }).en === 'Fight');
    expect(court.map((p) => p.to)).toEqual(expect.arrayContaining([who.manager, who.owner]));
    for (const p of push) {
      expect(p.kind).toBe('staff_task');
      expect(Object.keys(p.payload.params).sort()).toEqual(['name', 'step']);
      expect(p.payload).toMatchObject({ route: 'staff', id: null, title_key: 'incident_reported' });
    }
    // The driver's and marketing's reports tell MGMT too, and never the reporter.
    expect(push.filter((p) => p.payload.params.name === 'IR driver').map((p) => p.to)).toContain(who.manager);
    expect(push.filter((p) => p.payload.params.name === 'IR marketing').map((p) => p.to)).toContain(who.owner);
    expect(push.map((p) => p.to)).not.toContain(who.driver);
    expect(JSON.stringify(push)).not.toMatch(/slipped|argued|regulars|By the net/);
    for (const [k, v] of Object.entries(KIND_LABELS)) expect(ok(r, `label_${k}`), k).toEqual(v);
  });

  it('refuses a bad kind, place, time, court, text or photo; a retry is one report', () => {
    const r = scenario([
      ...OTHER_VENUE_SQL,
      COURT,
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      PHOTO('mine', 'drv', 'incidents'), PHOTO('theirs', 'mkt', 'incidents'), PHOTO('req', 'drv', 'requests'),
      PHOTO('p1', 'drv', 'incidents'), PHOTO('p2', 'drv', 'incidents'), PHOTO('p3', 'drv', 'incidents'),
      PHOTO('p4', 'drv', 'incidents'), PHOTO('p5', 'drv', 'incidents'), PHOTO('p6', 'drv', 'incidents'),
      report('drv', 'bad_kind', '', 'theft'),
      report('drv', 'bad_place', '', 'injury', 'roof'),
      T('old', 'drv', `select app.submit_incident('injury', now() - interval '8 days', 'cafe', 'x')`),
      T('week', 'drv', `select app.submit_incident('injury', now() - interval '6 days 23 hours', 'cafe', 'x')`),
      T('ahead', 'drv', `select app.submit_incident('injury', now() + interval '11 minutes', 'cafe', 'x')`),
      T('no_time', 'drv', `select app.submit_incident('injury', null, 'cafe', 'x')`),
      report('drv', 'court_no_court', '', 'injury', 'court'),
      report('drv', 'court_elsewhere', `, p_court_id => {{court}}::uuid`),
      report('drv', 'far_court', `, p_court_id => {{far_court}}::uuid`, 'injury', 'court'),
      report('drv', 'no_court', `, p_court_id => gen_random_uuid()`, 'injury', 'court'),
      T('no_text', 'drv', `select app.submit_incident('injury', now(), 'cafe', '   ')`),
      T('long_text', 'drv', `select app.submit_incident('injury', now(), 'cafe', repeat('d', 2001))`),
      report('drv', 'long_people', `, p_people_involved => repeat('p', 1001)`),
      report('drv', 'long_detail', `, p_place_detail => repeat('x', 121)`),
      report('drv', 'too_many', `, p_photos => array['a','b','c','d','e','f','g']`),
      report('drv', 'their_slot', `, p_photos => array[{{theirs}}]`),
      report('drv', 'wrong_folder', `, p_photos => array[{{req}}]`),
      report('drv', 'six', `, p_photos => array[{{p1}}, {{p2}}, {{p3}}, {{p4}}, {{p5}}, {{p6}}, {{p1}}]`),
      report('drv', 'with_photo', `, p_photos => array[{{mine}}], p_people_involved => '  ', p_place_detail => ''`),
      RES('with_photo', 'with_photo', 'id'),
      Q('claimed', `select to_jsonb(used_by) from staff_media_uploads where path = {{mine}}`),
      Q('blank', `select jsonb_build_object('people', people_involved, 'detail', place_detail, 'photos', to_jsonb(photos))
                    from incident_reports where id = {{with_photo}}::uuid`),
      report('drv', 'other_venue', `, p_venue_id => '${OTHER_VENUE}'`),
      report('drv', 'k1', `, p_idempotency_key => 'IR-KEY-1'`),
      report('drv', 'k2', `, p_idempotency_key => 'IR-KEY-1'`),
      Q('k_rows', `select to_jsonb(count(*)) from incident_reports where reported_by = {{drv}}::uuid`),
    ]);
    expect(refused(r, 'bad_kind')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'bad_place')).toBe('INVALID_ARGUMENT:place');
    expect(refused(r, 'old')).toBe('INVALID_ARGUMENT:occurred_at');
    expect(ok<{ id: string }>(r, 'week').id).toBeTruthy();
    expect(refused(r, 'ahead')).toBe('INVALID_ARGUMENT:occurred_at');
    expect(refused(r, 'no_time')).toBe('INVALID_ARGUMENT:occurred_at');
    expect(refused(r, 'court_no_court')).toBe('INVALID_ARGUMENT:court_id');
    expect(refused(r, 'court_elsewhere')).toBe('INVALID_ARGUMENT:court_id');
    expect(refused(r, 'far_court')).toBe('REF_NOT_FOUND:court_id');
    expect(refused(r, 'no_court')).toBe('REF_NOT_FOUND:court_id');
    expect(refused(r, 'no_text')).toBe('TEXT_REQUIRED:description');
    expect(refused(r, 'long_text')).toBe('TEXT_TOO_LONG:description');
    expect(refused(r, 'long_people')).toBe('TEXT_TOO_LONG:people_involved');
    expect(refused(r, 'long_detail')).toBe('TEXT_TOO_LONG:place_detail');
    expect(refused(r, 'too_many')).toBe('INVALID_ARGUMENT:photos');
    expect(refused(r, 'their_slot')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    // Six once each: the repeat is dropped, not counted.
    expect(ok<{ id: string }>(r, 'six').id).toBeTruthy();
    expect(ok<string>(r, 'claimed')).toBe(`incident:${ok<{ id: string }>(r, 'with_photo').id}`);
    expect(ok(r, 'blank')).toMatchObject({ people: null, detail: null, photos: [expect.stringMatching(/\/incidents\//)] });
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');
    expect(ok(r, 'k2')).toEqual({ id: ok<{ id: string }>(r, 'k1').id, duplicate: true });
    // week, six, with_photo and the keyed one.
    expect(ok<number>(r, 'k_rows')).toBe(4);
  });

  it('MGMT review with a note, never their own, once; the reporter hears and reads it', () => {
    const r = scenario([
      MK('drv', 'driver'), MK('mkt', 'marketing'), MK('hb', 'head_barista'),
      report('desk', 'a'), RES('a', 'a', 'id'),
      report('manager', 'b'), RES('b', 'b', 'id'),
      report('drv', 'c'), RES('c', 'c', 'id'),
      T('bare', 'manager', `select app.review_incident({{a}}::uuid, '  ')`),
      T('long', 'manager', `select app.review_incident({{a}}::uuid, repeat('n', 1001))`),
      T('own', 'manager', `select app.review_incident({{b}}::uuid, 'Seen')`),
      ...(['drv', 'mkt', 'hb', 'cashier', 'desk'] as const).map((w) =>
        T(`review_${w}`, w, `select app.review_incident({{c}}::uuid, 'Seen')`)),
      T('review_a', 'manager', `select app.review_incident({{a}}::uuid, 'Called the guest; first aid given.')`),
      T('again', 'owner', `select app.review_incident({{a}}::uuid, 'Again')`),
      T('review_b', 'owner', `select app.review_incident({{b}}::uuid, 'Seen by the owner')`),
      T('missing', 'manager', `select app.review_incident(gen_random_uuid(), 'x')`),
      Q('push', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)), '[]'::jsonb)
                   from notification_outbox o
                  where o.created_at = now() and o.payload->>'title_key' = 'incident_reviewed'`),
      T('mine_desk', 'desk', `select app.my_incidents({{venue}})`),
      T('mine_drv', 'drv', `select app.my_incidents()`),
      T('page_open', 'manager', `select app.incidents_page({{venue}})`),
      T('page_all', 'owner', `select app.incidents_page({{venue}}, 'all', 200)`),
      T('page_bad', 'manager', `select app.incidents_page({{venue}}, 'mine')`),
      ...(['drv', 'mkt', 'hb', 'cashier', 'desk', 'prep'] as const).flatMap((w) => [
        T(`page_${w}`, w, `select app.incidents_page({{venue}})`),
        T(`read_${w}`, w, `select to_jsonb(count(*)) from incident_reports`),
        T(`redact_${w}`, w, `select app.redact_incident({{c}}::uuid)`),
      ]),
      T('read_manager', 'manager', `select to_jsonb(count(*)) from incident_reports`),
      Q('who', `select jsonb_build_object('desk', {{desk}}, 'manager', {{manager}}, 'a', {{a}}, 'b', {{b}}, 'c', {{c}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(refused(r, 'bare')).toBe('TEXT_REQUIRED:note');
    expect(refused(r, 'long')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'own')).toBe('CANNOT_DECIDE_OWN');
    for (const w of ['drv', 'mkt', 'hb', 'cashier', 'desk']) expect(refused(r, `review_${w}`), w).toBe('FORBIDDEN');
    expect(ok<{ status: string }>(r, 'review_a').status).toBe('reviewed');
    expect(refused(r, 'again')).toBe('SUBMISSION_DECIDED');
    expect(ok<{ status: string }>(r, 'review_b').status).toBe('reviewed');
    expect(refused(r, 'missing')).toBe('REF_NOT_FOUND:id');

    const push = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'push');
    expect(push.find((p) => p.to === who.desk)).toEqual({
      to: who.desk, kind: 'staff_info',
      payload: { route: 'staff', id: null, title_key: 'incident_reviewed', params: { step: KIND_LABELS.injury } },
    });
    expect(JSON.stringify(push)).not.toMatch(/first aid|Seen by/);

    const mine = ok<{ incidents: Incident[] }>(r, 'mine_desk').incidents.find((i) => i.id === who.a)!;
    expect(mine).toMatchObject({ status: 'reviewed', review_note: 'Called the guest; first aid given.',
                                 reviewed_by_name: 'Dev Manager', redacted: false,
                                 description: 'A guest slipped by the counter' });
    expect(Object.keys(mine).sort()).toEqual(['court_id', 'court_name_ar', 'court_name_en', 'description', 'id', 'kind',
      'occurred_at', 'people_involved', 'photos', 'place', 'place_detail', 'redacted', 'review_note', 'reviewed_at',
      'reviewed_by_name', 'status']);
    expect(ok<{ incidents: Incident[] }>(r, 'mine_drv').incidents.map((i) => i.id)).toEqual([who.c]);

    type Page = { incidents: Incident[]; open_count: number; total: number };
    const open = ok<Page>(r, 'page_open');
    expect(open.incidents.every((i) => i.status === 'open')).toBe(true);
    expect(open.incidents.find((i) => i.id === who.c)).toMatchObject({ reported_by_name: 'IR drv', reported_by_role: 'driver',
                                                                       can_review: true, can_redact: false });
    expect(open.open_count).toBe(open.total);
    const all = ok<Page>(r, 'page_all');
    expect(all.incidents.find((i) => i.id === who.a)).toMatchObject({ status: 'reviewed', can_review: false, can_redact: true });
    expect(refused(r, 'page_bad')).toBe('INVALID_ARGUMENT:filter');
    for (const w of ['drv', 'mkt', 'hb', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `page_${w}`), w).toBe('FORBIDDEN');
      expect(ok<number>(r, `read_${w}`), w).toBe(0);
      expect(refused(r, `redact_${w}`), w).toBe('FORBIDDEN');
    }
    expect(ok<number>(r, 'read_manager')).toBeGreaterThan(0);
  });

  it('shows an incident’s photo to the reporter, a manager and the owner, and to no one else', () => {
    const r = scenario([
      MK('desk2', 'court_desk'), MK('drv', 'driver'), MK('mkt', 'marketing'), MK('w', 'waiter'),
      PHOTO('p', 'desk', 'incidents'),
      report('desk', 'r', `, p_photos => array[{{p}}]`),
      ...(['desk', 'manager', 'owner', 'desk2', 'drv', 'mkt', 'w', 'cashier'] as const).map((w) => SEES(`sees_${w}`, w, 'p')),
    ]);
    ok(r, 'r');
    for (const w of ['desk', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${w}`), w).toBe(true);
    for (const w of ['desk2', 'drv', 'mkt', 'w', 'cashier']) expect(ok<boolean>(r, `sees_${w}`), w).toBe(false);
  });

  it('purges the text after a year and the photos through the tick; the owner redacts at once', () => {
    const r = scenario([
      MK('drv', 'driver'),
      COURT,
      PHOTO('p', 'drv', 'incidents'),
      T('old', 'drv', `select app.submit_incident('injury', now() - interval '1 hour', 'court', 'A player fell',
                                                   p_court_id => {{court}}::uuid, p_place_detail => 'Court 9 gate',
                                                   p_people_involved => 'Ali, a regular', p_photos => array[{{p}}])`),
      RES('old', 'old', 'id'),
      T('reviewed', 'manager', `select app.review_incident({{old}}::uuid, 'Ali is fine')`),
      report('drv', 'fresh'), RES('fresh', 'fresh', 'id'),
      report('drv', 'to_redact', `, p_people_involved => 'Omar'`), RES('to_redact', 'to_redact', 'id'),
      // A year on for the first report only.
      `update incident_reports set purge_after = now() - interval '1 minute'
        where id = (select val::uuid from pg_temp.vars where name = 'old');`,
      SVC('photos_due', `select app.incident_photo_purge_due(20)`),
      Q('nudge_due', `select to_jsonb(exists (select 1 from incident_reports i where i.purge_after <= now()
                                                and i.photos_purged_at is null and cardinality(i.photos) > 0))`),
      Q('purge', `select app.incident_purge_due()`),
      Q('purge_again', `select app.incident_purge_due()`),
      Q('after', `select jsonb_build_object('description', description, 'people', people_involved, 'detail', place_detail,
                                            'note', review_note, 'kind', kind, 'place', place, 'court', court_id is not null,
                                            'status', status, 'reviewed', reviewed_at is not null,
                                            'text_purged', text_purged_at is not null, 'photos', to_jsonb(photos))
                    from incident_reports where id = {{old}}::uuid`),
      Q('fresh_after', `select jsonb_build_object('description', description, 'text_purged', text_purged_at)
                          from incident_reports where id = {{fresh}}::uuid`),
      SVC('photos_done', `select to_jsonb(app.incident_photos_purged({{old}}::uuid))`),
      Q('photos_after', `select jsonb_build_object('photos', to_jsonb(photos), 'stamped', photos_purged_at is not null)
                           from incident_reports where id = {{old}}::uuid`),
      SVC('photos_due_after', `select app.incident_photo_purge_due(20)`),
      // Redaction: the owner, at once, once.
      T('redact_mgr', 'manager', `select app.redact_incident({{to_redact}}::uuid)`),
      T('redact', 'owner', `select app.redact_incident({{to_redact}}::uuid)`),
      T('redact_again', 'owner', `select app.redact_incident({{to_redact}}::uuid)`),
      Q('redacted', `select jsonb_build_object('description', description, 'people', people_involved,
                                               'due', purge_after <= now(), 'text_purged', text_purged_at is not null)
                       from incident_reports where id = {{to_redact}}::uuid`),
      // A note written after the redaction goes at the next purge run.
      T('late_review', 'manager', `select app.review_incident({{to_redact}}::uuid, 'Omar called back')`),
      Q('late_purge', `select app.incident_purge_due()`),
      Q('late_after', `select jsonb_build_object('note', review_note, 'description', description, 'status', status)
                         from incident_reports where id = {{to_redact}}::uuid`),
      T('mine', 'drv', `select app.my_incidents({{venue}})`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', action, 'before', before, 'after', after) order by id)
                    from audit_log where action in ('incident.redact', 'incident.purge')
                     and (entity_id = {{to_redact}} or entity_id = {{venue}})
                     and at = now()`),
      Q('who', `select jsonb_build_object('old', {{old}}, 'p', {{p}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(ok(r, 'photos_due')).toEqual(expect.arrayContaining([{ incident_id: who.old, paths: [who.p] }]));
    expect(ok<boolean>(r, 'nudge_due')).toBe(true);
    expect(ok<{ incidents: number }>(r, 'purge').incidents).toBeGreaterThanOrEqual(1);
    expect(ok<{ incidents: number }>(r, 'purge_again').incidents).toBe(0);
    expect(ok(r, 'after')).toEqual({ description: '[deleted after 365 days]', people: null, detail: null, note: null,
                                     kind: 'injury', place: 'court', court: true, status: 'reviewed', reviewed: true,
                                     text_purged: true, photos: [who.p] });
    expect(ok(r, 'fresh_after')).toEqual({ description: 'A guest slipped by the counter', text_purged: null });
    expect(ok(r, 'photos_after')).toEqual({ photos: [], stamped: true });
    expect(ok<Array<{ incident_id: string }>>(r, 'photos_due_after').map((d) => d.incident_id)).not.toContain(who.old);

    expect(refused(r, 'redact_mgr')).toBe('FORBIDDEN');
    const first = ok<{ text_purged_at: string }>(r, 'redact');
    expect(ok(r, 'redact_again')).toEqual(first);
    expect(ok(r, 'redacted')).toEqual({ description: '[deleted by the owner]', people: null, due: true, text_purged: true });
    expect(ok<{ status: string }>(r, 'late_review').status).toBe('reviewed');
    expect(ok(r, 'late_after')).toEqual({ note: null, description: '[deleted by the owner]', status: 'reviewed' });
    const mine = ok<{ incidents: Incident[] }>(r, 'mine').incidents;
    expect(mine.find((i) => i.id === who.old)).toMatchObject({ redacted: true, description: '[deleted after 365 days]' });
    const audit = ok<Array<{ action: string; before: unknown; after: unknown }>>(r, 'audit');
    expect(audit.filter((a) => a.action === 'incident.redact')).toEqual([
      { action: 'incident.redact', before: {}, after: { redacted: true } }]);
    for (const a of audit.filter((x) => x.action === 'incident.purge')) {
      expect(Object.keys(a.after as object)).toEqual(['incidents']);
    }
  });

  it('sweeps incident and content photos nobody claimed a day on, and nothing else', () => {
    const SLOTS = `select jsonb_object_agg(v.name, exists (select 1 from staff_media_uploads u where u.path = v.val))
                     from pg_temp.vars v where v.name in ('old_inc', 'fresh_inc', 'old_camp', 'old_req', 'claimed')`;
    const r = scenario([
      MK('drv', 'driver'),
      PHOTO('old_inc', 'drv', 'incidents'),
      PHOTO('fresh_inc', 'drv', 'incidents'),
      PHOTO('old_camp', 'manager', 'campaigns'),
      PHOTO('old_req', 'drv', 'requests'),
      PHOTO('claimed', 'drv', 'incidents'),
      T('filed', 'drv', `select app.submit_incident('damage', now() - interval '1 hour', 'cafe', 'A chair broke',
                                                     p_photos => array[{{claimed}}])`),
      // An abandoned form a day on: every slot but the fresh one.
      `update staff_media_uploads set created_at = now() - interval '25 hours'
        where path in (select val from pg_temp.vars where name in ('old_inc', 'old_camp', 'old_req', 'claimed'));`,
      T('due_client', 'manager', `select app.staff_media_orphan_purge_due(50)`),
      SVC('due', `select app.staff_media_orphan_purge_due(1000)`),
      // A report that names a swept photo now is refused, not left pointing at nothing.
      T('late_claim', 'drv', `select app.submit_incident('damage', now() - interval '1 hour', 'cafe', 'Late',
                                                         p_photos => array[{{old_inc}}])`),
      SVC('due_again', `select app.staff_media_orphan_purge_due(1000)`),
      Q('reserved', SLOTS),
      SVC('purged', `select to_jsonb(app.staff_media_orphans_purged(array[{{old_inc}}, {{old_camp}}, {{claimed}}, {{fresh_inc}}]))`),
      Q('left', SLOTS),
      SVC('due_after', `select app.staff_media_orphan_purge_due(1000)`),
      Q('who', `select jsonb_object_agg(name, val) from pg_temp.vars
                 where name in ('old_inc', 'fresh_inc', 'old_camp', 'old_req', 'claimed')`),
    ]);
    ok(r, 'filed');
    const who = ok<Record<string, string>>(r, 'who');
    expect(refused(r, 'due_client')).toMatch(/permission denied/);
    // Incidents and campaigns only: never a claimed photo, a fresh one or
    // another folder's.
    expect([...ok<string[]>(r, 'due')].sort()).toEqual(expect.arrayContaining([who.old_inc, who.old_camp].sort()));
    const due = ok<string[]>(r, 'due');
    for (const name of ['fresh_inc', 'old_req', 'claimed']) expect(due, name).not.toContain(who[name]);
    expect(refused(r, 'late_claim')).toBe('PHOTO_PATH_INVALID');
    // Listed once, held until the tick says the objects are gone.
    expect(ok<string[]>(r, 'due_again')).toEqual(expect.arrayContaining([who.old_inc, who.old_camp]));
    expect(ok(r, 'reserved')).toEqual({ old_inc: true, fresh_inc: true, old_camp: true, old_req: true, claimed: true });
    expect(ok<number>(r, 'purged')).toBe(2);
    expect(ok(r, 'left')).toEqual({ old_inc: false, fresh_inc: true, old_camp: false, old_req: true, claimed: true });
    expect(ok<string[]>(r, 'due_after')).not.toContain(who.old_inc);
    expect(ok<string[]>(r, 'due_after')).not.toContain(who.old_camp);
  });

  it('keeps incident reports from the owner assistant: no readable column, no text in the audit', () => {
    const r = scenario([
      MK('drv', 'driver'),
      report('drv', 'a', `, p_people_involved => 'Sara from table 4', p_place_detail => 'Terrace'`), RES('a', 'a', 'id'),
      T('rev', 'manager', `select app.review_incident({{a}}::uuid, 'Sara is fine')`),
      Q('columns', `select to_jsonb(count(*)) from app.assistant_readable_columns where table_name = 'incident_reports'`),
      Q('audit', `select jsonb_agg(jsonb_build_object('before', before, 'after', after, 'reason', reason_code))
                    from audit_log where entity = 'incident_report' and entity_id = {{a}}`),
    ]);
    ok(r, 'rev');
    expect(ok<number>(r, 'columns')).toBe(0);
    const audit = JSON.stringify(ok(r, 'audit'));
    expect(audit).not.toMatch(/slipped|Sara|Terrace|table 4/);
  });
});
