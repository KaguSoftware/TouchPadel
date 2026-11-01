/**
 * 0391 (F-61, F-64):
 *
 *   * discard_staff_media marks the caller's own unclaimed protocol photo for
 *     the orphan purge; a claimed photo and someone else's are left alone;
 *   * staff_media_orphan_purge_due takes the marked slot and a protocol slot
 *     nobody claimed for a week, never a fresh one;
 *   * venue_files_gc deletes a ready file row whose object is gone and an
 *     upload that never finished within a day, and keeps a file whose object
 *     is there.
 *
 * One rolled-back transaction per case (stores-harness).
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, T, Q, X, KEEP, MK, ok, refused } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** A staff-media slot in `folder` at venue A uploaded by `who`, `age` ago. */
const SLOT = (name: string, who: string, folder: string, age = '0 minutes', usedBy = 'null') =>
  KEEP(
    name,
    `insert into staff_media_uploads (path, venue_id, folder, uploader, created_at, used_at, used_by)
     values ({{venue}} || '/${folder}/' || gen_random_uuid() || '.jpg', {{venue}}::uuid, '${folder}', {{${who}}}::uuid,
             now() - interval '${age}', case when ${usedBy} is null then null else now() end, ${usedBy})
     returning path`,
  );

describe.skipIf(!docker)('0391 removed protocol photos and broken Files rows', () => {
  it('discard marks only the caller’s own unclaimed photos; the purge takes them and week-old orphans', () => {
    const r = scenario('ppf391a', [
      MK('m2', 'manager'),
      SLOT('mine', 'manager', 'steps'),
      SLOT('claimed', 'manager', 'steps', '0 minutes', `'protocol_submission:00000000-0000-4000-8000-000000000001'`),
      SLOT('theirs', 'm2', 'steps'),
      SLOT('old', 'm2', 'proposals', '8 days'),
      SLOT('fresh', 'm2', 'tests', '2 days'),
      T('discard', 'manager', `select to_jsonb(app.discard_staff_media(array[{{mine}}, {{claimed}}, {{theirs}}]))`),
      T('guest', 'manager', `select to_jsonb(app.discard_staff_media(array_fill('x'::text, array[51])))`),
      Q('marked', `select jsonb_object_agg(case path when {{mine}} then 'mine' when {{claimed}} then 'claimed' else 'theirs' end, used_by)
                     from staff_media_uploads where path in ({{mine}}, {{claimed}}, {{theirs}})`),
      Q('due', `with d as (select jsonb_array_elements_text(app.staff_media_orphan_purge_due(500)) as p)
                 select jsonb_build_object('mine', exists (select 1 from d where p = {{mine}}),
                                           'old', exists (select 1 from d where p = {{old}}),
                                           'fresh', exists (select 1 from d where p = {{fresh}}),
                                           'claimed', exists (select 1 from d where p = {{claimed}}),
                                           'theirs', exists (select 1 from d where p = {{theirs}}))`),
    ]);
    expect(ok<number>(r, 'discard')).toBe(1);
    expect(refused(r, 'guest')).toBe('INVALID_ARGUMENT:paths');
    expect(ok(r, 'marked')).toEqual({ mine: 'orphan_purge', claimed: 'protocol_submission:00000000-0000-4000-8000-000000000001', theirs: null });
    expect(ok(r, 'due')).toEqual({ mine: true, old: true, fresh: false, claimed: false, theirs: false });
  });

  it('the Files garbage collector deletes rows whose file is gone, never one whose file is there', () => {
    const FILE = (name: string, label: string, status: string, age: string) => [
      KEEP(name, `select gen_random_uuid()::text`),
      X(`insert into venue_files (id, venue_id, name, mime, size_bytes, stored_bytes, encoding, blob_path, status, uploaded_by, created_at, ready_at)
         values ({{${name}}}::uuid, {{venue}}::uuid, '${label}', 'application/pdf', 10, 10, 'gzip', {{venue}} || '/' || {{${name}}} || '.gz',
                 '${status}', {{owner}}::uuid, now() - interval '${age}', case when '${status}' = 'ready' then now() - interval '${age}' end)`),
    ];
    const r = scenario('ppf391b', [
      ...FILE('gone', 'Gone.pdf', 'ready', '1 hour'),
      ...FILE('here', 'Here.pdf', 'ready', '1 hour'),
      X(`insert into storage.objects (bucket_id, name, owner) values ('venue-files', {{venue}} || '/' || {{here}} || '.gz', {{owner}}::uuid)`),
      ...FILE('stuck', 'Stuck.pdf', 'uploading', '2 days'),
      ...FILE('uploading', 'Now.pdf', 'uploading', '1 minute'),
      Q('gc', `select to_jsonb(app.venue_files_gc())`),
      Q('left', `select jsonb_object_agg(name, true) from venue_files where id in ({{gone}}::uuid, {{here}}::uuid, {{stuck}}::uuid, {{uploading}}::uuid)`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'file.gc' and entity_id in ({{gone}}, {{stuck}})`),
    ]);
    expect(ok<number>(r, 'gc')).toBeGreaterThanOrEqual(2);
    expect(ok(r, 'left')).toEqual({ 'Here.pdf': true, 'Now.pdf': true });
    expect(ok<number>(r, 'audit')).toBe(2);
  });
});
