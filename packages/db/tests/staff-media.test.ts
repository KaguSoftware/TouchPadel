/**
 * staff_media_bucket (build-contracts-2026-09-23 §2.3) — upload slots and the
 * private staff-media bucket.
 *
 *   * staff_media_slot mints `<venue>/<folder>/<uuid>.<ext>` for any active
 *     staff member at the venue, refuses a guest and a venue the caller is not
 *     at, checks folder and extension, and stops at 30 unused slots an hour;
 *   * the storage INSERT policy admits only the uploader's own unused slot
 *     from the last hour, so a path without a slot, someone else's slot, an
 *     expired slot and a used slot are all refused;
 *   * a photo is read by its uploader and management, a receipt by nobody
 *     else; who else reads a claimed protocol or marketing photo follows its
 *     record (protocols_engine_rpcs re-issues the read policy, §2.3);
 *     management deletes; guests read nothing;
 *   * the path helpers never raise and answer false / NULL on a menu-media
 *     name, and menu-media keeps working with these policies installed;
 *   * app.claim_staff_media claims the caller's own slot at the right venue
 *     and folder, replays, and refuses everything else with one code;
 *   * staff_media_uploads is read by its uploader only (a driver sees nobody
 *     else's), and has no app.assistant_readable_columns row.
 *
 * claim_staff_media is internal, so it is called through the stack's own
 * container as postgres with the caller's JWT claims set; those cases skip
 * without docker. The storage cases skip when the storage API is unreachable.
 *
 * Self-contained: a driver and a barista are created at venue A through the
 * service role; every slot, object and account the file makes is removed in
 * afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const BUCKET = 'staff-media';
const NOWHERE = '00000000-0000-4000-8000-00000000fade';
const PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(proposals|tests|steps|marketing|campaigns|receipts)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
// A JPEG start-of-image marker and a few bytes: the policy never reads content.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);

function psql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
    ],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
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

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The code a claim raised as `uid`, or null when it ran. */
function claim(
  uid: string,
  paths: string[],
  venue: string,
  folders: string[],
  usedBy: string,
): string | null {
  const claims = lit(JSON.stringify({ sub: uid, role: 'authenticated' }));
  const arr = (xs: string[]) => `array[${xs.map(lit).join(',')}]::text[]`;
  try {
    psql(
      `begin;\nselect set_config('request.jwt.claims', ${claims}, true);\n` +
        `select app.claim_staff_media(${arr(paths)}, ${lit(venue)}::uuid, ${arr(folders)}, ${lit(usedBy)});\ncommit;`,
    );
    return null;
  } catch (e) {
    const err = String((e as { stderr?: string }).stderr ?? e);
    return err.match(/ERROR:\s+(\S+)/)?.[1] ?? err;
  }
}

interface Slot {
  path: string;
  bucket: string;
  expires_at: string;
}

describe.skipIf(!up)('staff_media_bucket', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  let driver: SupabaseClient;
  let barista: SupabaseClient;
  const ids = { driver: '', barista: '' };
  const madePaths = new Set<string>();
  const madeObjects: Array<{ bucket: string; path: string }> = [];
  let storageUp = false;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await anonymousSessionClient();

    for (const role of ['driver', 'barista'] as const) {
      const email = `staffmedia-${role}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({
        email,
        password: DEV_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      ids[role] = data.user.id;
      const ins = await svc
        .from('staff')
        .insert({ id: data.user.id, display_name: `Media ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
    }
    driver = await signedInClient((await svc.auth.admin.getUserById(ids.driver)).data.user!.email!);
    barista = await signedInClient(
      (await svc.auth.admin.getUserById(ids.barista)).data.user!.email!,
    );

    const bucket = await svc.storage
      .getBucket(BUCKET)
      .catch(() => ({ data: null, error: { message: 'x' } }));
    storageUp = !bucket.error && !!bucket.data;
  });

  afterAll(async () => {
    for (const o of madeObjects) await svc.storage.from(o.bucket).remove([o.path]);
    const staffIds = Object.values(ids).filter(Boolean);
    let r = await svc
      .from('staff_media_uploads')
      .delete()
      .in('uploader', [
        ...staffIds,
        SEED_STAFF_IDS.owner,
        SEED_STAFF_IDS.manager,
        SEED_STAFF_IDS.cashier,
      ])
      .in('path', [...madePaths]);
    expect(r.error).toBeNull();
    r = await svc.from('staff_media_uploads').delete().in('uploader', staffIds);
    expect(r.error).toBeNull();
    for (const c of [driver, barista]) await c?.auth.signOut();
    for (const id of staffIds) {
      r = await svc.from('staff').delete().eq('id', id);
      expect(r.error, `staff delete ${id}`).toBeNull();
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const c of [owner, manager, cashier, guest]) await c?.auth.signOut();
  });

  async function slot(
    c: SupabaseClient,
    folder: string,
    ext = 'jpg',
    venue: string | null = VENUE_A_ID,
  ) {
    const r = await appRpc(c, 'staff_media_slot', {
      p_venue_id: venue,
      p_folder: folder,
      p_ext: ext,
    });
    if (!r.error) madePaths.add((r.data as Slot).path);
    return r;
  }
  async function mint(c: SupabaseClient, folder: string): Promise<string> {
    const r = await slot(c, folder);
    expect(r.error, r.error?.message).toBeNull();
    return (r.data as Slot).path;
  }
  async function upload(c: SupabaseClient, path: string) {
    const r = await c.storage
      .from(BUCKET)
      .upload(path, JPEG, { contentType: 'image/jpeg', upsert: false });
    if (!r.error) madeObjects.push({ bucket: BUCKET, path });
    return r;
  }
  const canRead = async (c: SupabaseClient, path: string) =>
    !(await c.storage.from(BUCKET).createSignedUrl(path, 600)).error;

  // ── the slot RPC ────────────────────────────────────────────────────────────

  it('mints a slot for any active staff member at the venue', async () => {
    const before = Date.now();
    for (const c of [cashier, driver, barista, manager, owner]) {
      const r = await slot(c, 'steps');
      expect(r.error, r.error?.message).toBeNull();
      const s = r.data as Slot;
      expect(s.bucket).toBe(BUCKET);
      expect(s.path).toMatch(PATH_RE);
      expect(s.path.startsWith(`${VENUE_A_ID}/steps/`)).toBe(true);
      expect(new Date(s.expires_at).getTime()).toBeGreaterThan(before + 59 * 60_000);
    }
    const jpeg = await slot(driver, 'receipts', ' JPEG ');
    expect((jpeg.data as Slot).path).toMatch(/\/receipts\/[0-9a-f-]{36}\.jpg$/);
    const venueless = await slot(cashier, 'tests', 'png', null);
    expect((venueless.data as Slot).path).toMatch(new RegExp(`^${VENUE_A_ID}/tests/.+\\.png$`));
  });

  it('refuses a guest, and a venue the caller is not at', async () => {
    expect((await slot(guest, 'steps')).error?.message).toBe('FORBIDDEN');
    expect((await slot(cashier, 'steps', 'jpg', NOWHERE)).error?.message).toBe('FORBIDDEN');
    expect((await slot(owner, 'steps', 'jpg', NOWHERE)).error?.message).toBe('FORBIDDEN');
  });

  it('refuses an unknown folder or extension', async () => {
    const f = await slot(cashier, 'selfies');
    expect(f.error?.message).toBe('INVALID_ARGUMENT');
    expect(f.error?.hint).toBe('folder');
    const e = await slot(cashier, 'steps', 'gif');
    expect(e.error?.message).toBe('INVALID_ARGUMENT');
    expect(e.error?.hint).toBe('ext');
  });

  it('stops a caller at 30 unused slots in the last hour', async () => {
    await svc.from('staff_media_uploads').delete().eq('uploader', ids.barista);
    for (let i = 0; i < 30; i++) await mint(barista, 'tests');
    expect((await slot(barista, 'tests')).error?.message).toBe('UPLOAD_LIMIT');
    // Slots older than the hour no longer count.
    await svc
      .from('staff_media_uploads')
      .update({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() })
      .eq('uploader', ids.barista);
    expect((await slot(barista, 'tests')).error).toBeNull();
    await svc.from('staff_media_uploads').delete().eq('uploader', ids.barista);
  });

  it('keeps staff_media_uploads to its uploader', async () => {
    const mine = await mint(driver, 'receipts');
    const own = await driver.from('staff_media_uploads').select('path, uploader');
    expect(own.error).toBeNull();
    expect((own.data ?? []).every((r) => r.uploader === ids.driver)).toBe(true);
    expect((own.data ?? []).map((r) => r.path)).toContain(mine);
    for (const c of [manager, owner, cashier, guest]) {
      const seen = await c.from('staff_media_uploads').select('path').eq('path', mine);
      expect(seen.error).toBeNull();
      expect(seen.data).toEqual([]);
    }
    // Written only by the definers.
    const direct = await driver
      .from('staff_media_uploads')
      .insert({
        path: mine.replace(/[0-9a-f-]{36}\.jpg$/, `${crypto.randomUUID()}.jpg`),
        venue_id: VENUE_A_ID,
        folder: 'receipts',
        uploader: ids.driver,
      });
    expect(direct.error).not.toBeNull();
  });

  it('has no app.assistant_readable_columns row', async () => {
    const { data, error } = await owner
      .schema('app')
      .from('assistant_readable_columns')
      .select('table_name')
      .eq('table_name', 'staff_media_uploads');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ── the path helpers ────────────────────────────────────────────────────────

  it('answers false / NULL on anything that is not a staff-media path, and never raises', async () => {
    const good = `${VENUE_A_ID}/receipts/${crypto.randomUUID()}.webp`;
    const cases: Array<[string | null, boolean, string | null, string | null]> = [
      [good, true, VENUE_A_ID, 'receipts'],
      ['items/abc/photo.webp', false, null, null],
      ['categories/x.jpg', false, null, null],
      [`${'-'.repeat(36)}/steps/${'-'.repeat(36)}.jpg`, false, null, null],
      [`${VENUE_A_ID}/steps/${crypto.randomUUID()}.gif`, false, null, null],
      [`${VENUE_A_ID}/selfies/${crypto.randomUUID()}.jpg`, false, null, null],
      [`${VENUE_A_ID.toUpperCase()}/steps/${crypto.randomUUID()}.jpg`, false, null, null],
      ['', false, null, null],
      [null, false, null, null],
    ];
    for (const c of [guest, cashier]) {
      for (const [name, isPath, venue, folder] of cases) {
        const a = await appRpc(c, 'is_staff_media_path', { p_name: name });
        expect(a.error, String(name)).toBeNull();
        expect(a.data, String(name)).toBe(isPath);
        const v = await appRpc(c, 'staff_media_venue', { p_name: name });
        expect(v.error, String(name)).toBeNull();
        expect(v.data, String(name)).toBe(venue);
        const f = await appRpc(c, 'staff_media_folder', { p_name: name });
        expect(f.error, String(name)).toBeNull();
        expect(f.data, String(name)).toBe(folder);
      }
    }
  });

  // ── storage policies ────────────────────────────────────────────────────────

  describe('storage', () => {
    it('admits the uploader’s own unused slot, once', async (ctx) => {
      if (!storageUp) return ctx.skip();
      const path = await mint(cashier, 'steps');
      const first = await upload(cashier, path);
      expect(first.error, first.error?.message).toBeNull();
      expect((await upload(cashier, path)).error).not.toBeNull();
    });

    it('refuses a path without a slot, another person’s slot, an expired slot and a used one', async (ctx) => {
      if (!storageUp) return ctx.skip();
      expect(
        (await upload(cashier, `${VENUE_A_ID}/steps/${crypto.randomUUID()}.jpg`)).error,
      ).not.toBeNull();
      // Outside the grammar altogether.
      expect((await upload(manager, `items/${crypto.randomUUID()}.jpg`)).error).not.toBeNull();

      const theirs = await mint(driver, 'steps');
      expect((await upload(cashier, theirs)).error).not.toBeNull();
      expect((await upload(manager, theirs)).error).not.toBeNull();

      const stale = await mint(cashier, 'steps');
      await svc
        .from('staff_media_uploads')
        .update({ created_at: new Date(Date.now() - 61 * 60_000).toISOString() })
        .eq('path', stale);
      expect((await upload(cashier, stale)).error).not.toBeNull();

      const used = await mint(cashier, 'steps');
      await svc
        .from('staff_media_uploads')
        .update({ used_at: new Date().toISOString(), used_by: 'probe:1' })
        .eq('path', used);
      expect((await upload(cashier, used)).error).not.toBeNull();

      expect(
        (await upload(guest, `${VENUE_A_ID}/steps/${crypto.randomUUID()}.jpg`)).error,
      ).not.toBeNull();
    });

    it('keeps an unclaimed photo to its uploader and management', async (ctx) => {
      if (!storageUp) return ctx.skip();
      const path = await mint(barista, 'proposals');
      expect((await upload(barista, path)).error).toBeNull();
      for (const c of [barista, manager, owner]) expect(await canRead(c, path)).toBe(true);
      // Who else reads a claimed photo follows the record that claimed it
      // (app.staff_media_visible, re-issued by protocols_engine_rpcs, §2.3;
      // protocols-engine-flow.test.ts).
      for (const c of [driver, cashier, guest]) expect(await canRead(c, path)).toBe(false);
      // Private: no public URL serves it.
      const res = await fetch(svc.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      expect(res.ok).toBe(false);
    });

    it('keeps a receipt to its uploader and management', async (ctx) => {
      if (!storageUp) return ctx.skip();
      const path = await mint(driver, 'receipts');
      expect((await upload(driver, path)).error, 'driver uploads own receipt').toBeNull();
      expect(await canRead(driver, path)).toBe(true);
      expect(await canRead(manager, path)).toBe(true);
      expect(await canRead(owner, path)).toBe(true);
      expect(await canRead(cashier, path)).toBe(false);
      expect(await canRead(barista, path)).toBe(false);
    });

    it('lets management delete, and no one else', async (ctx) => {
      if (!storageUp) return ctx.skip();
      const path = await mint(cashier, 'marketing');
      expect((await upload(cashier, path)).error).toBeNull();
      await cashier.storage.from(BUCKET).remove([path]);
      await barista.storage.from(BUCKET).remove([path]);
      expect(await canRead(manager, path)).toBe(true);
      const del = await manager.storage.from(BUCKET).remove([path]);
      expect(del.error).toBeNull();
      expect(await canRead(owner, path)).toBe(false);
    });

    it('leaves menu-media working for staff and guests', async (ctx) => {
      if (!storageUp) return ctx.skip();
      const path = `items/staff-media-probe/${Date.now()}.webp`;
      const up1 = await manager.storage
        .from('menu-media')
        .upload(path, JPEG, { contentType: 'image/webp', upsert: true });
      expect(up1.error, up1.error?.message).toBeNull();
      madeObjects.push({ bucket: 'menu-media', path });
      for (const c of [manager, cashier, driver, guest]) {
        const dl = await c.storage.from('menu-media').download(path);
        expect(dl.error, 'menu-media read').toBeNull();
      }
      const list = await cashier.storage.from('menu-media').list('items/staff-media-probe');
      expect(list.error).toBeNull();
      expect(
        (await cashier.storage.from('menu-media').upload(`items/x/${Date.now()}.webp`, JPEG)).error,
      ).not.toBeNull();
    });
  });

  // ── claim_staff_media ───────────────────────────────────────────────────────

  describe.skipIf(!docker)('app.claim_staff_media', () => {
    it('claims the caller’s own slot at the venue and folder, and replays', async () => {
      const a = await mint(cashier, 'steps');
      const b = await mint(cashier, 'steps');
      expect(
        claim(SEED_STAFF_IDS.cashier, [a, b, a], VENUE_A_ID, ['steps', 'tests'], 'probe:claim-1'),
      ).toBeNull();
      const { data } = await svc
        .from('staff_media_uploads')
        .select('path, used_by, used_at')
        .in('path', [a, b]);
      expect(data).toHaveLength(2);
      for (const r of data ?? []) {
        expect(r.used_by).toBe('probe:claim-1');
        expect(r.used_at).not.toBeNull();
      }
      // A replay of the same record passes; another record cannot take them.
      expect(claim(SEED_STAFF_IDS.cashier, [a], VENUE_A_ID, ['steps'], 'probe:claim-1')).toBeNull();
      expect(claim(SEED_STAFF_IDS.cashier, [a], VENUE_A_ID, ['steps'], 'probe:claim-2')).toBe(
        'PHOTO_PATH_INVALID',
      );
      // Nothing to claim is nothing to do.
      expect(claim(SEED_STAFF_IDS.cashier, [], VENUE_A_ID, ['steps'], 'probe:claim-3')).toBeNull();
    });

    it('refuses someone else’s slot, the wrong venue or folder, an unknown path and a blank record', async () => {
      const p = await mint(driver, 'receipts');
      expect(claim(SEED_STAFF_IDS.cashier, [p], VENUE_A_ID, ['receipts'], 'probe:x')).toBe(
        'PHOTO_PATH_INVALID',
      );
      expect(claim(ids.driver, [p], NOWHERE, ['receipts'], 'probe:x')).toBe('PHOTO_PATH_INVALID');
      expect(claim(ids.driver, [p], VENUE_A_ID, ['steps', 'tests'], 'probe:x')).toBe(
        'PHOTO_PATH_INVALID',
      );
      expect(
        claim(
          ids.driver,
          [`${VENUE_A_ID}/receipts/${crypto.randomUUID()}.jpg`],
          VENUE_A_ID,
          ['receipts'],
          'probe:x',
        ),
      ).toBe('PHOTO_PATH_INVALID');
      expect(claim(ids.driver, ['items/x.jpg'], VENUE_A_ID, ['receipts'], 'probe:x')).toBe(
        'PHOTO_PATH_INVALID',
      );
      expect(claim(ids.driver, [p], VENUE_A_ID, ['receipts'], ' ')).toBe('INVALID_ARGUMENT');
      // One bad path refuses the whole claim.
      const q = await mint(driver, 'receipts');
      expect(
        claim(
          ids.driver,
          [q, `${VENUE_A_ID}/receipts/${crypto.randomUUID()}.jpg`],
          VENUE_A_ID,
          ['receipts'],
          'probe:y',
        ),
      ).toBe('PHOTO_PATH_INVALID');
      const { data } = await svc
        .from('staff_media_uploads')
        .select('used_by')
        .eq('path', q)
        .single();
      expect(data?.used_by).toBeNull();
    });

    it('never moves a photo between records unless the resubmission rule allows it', async () => {
      const p = await mint(driver, 'steps');
      expect(
        claim(ids.driver, [p], VENUE_A_ID, ['steps'], `protocol_submission:${crypto.randomUUID()}`),
      ).toBeNull();
      // Another submission that is not a resubmission of the same run step
      // (here: one that does not exist) cannot take it, whoever asks.
      for (const who of [ids.driver, SEED_STAFF_IDS.manager]) {
        expect(
          claim(who, [p], VENUE_A_ID, ['steps'], `protocol_submission:${crypto.randomUUID()}`),
        ).toBe('PHOTO_PATH_INVALID');
      }
      expect(claim(ids.driver, [p], VENUE_A_ID, ['steps'], 'purchase:1')).toBe(
        'PHOTO_PATH_INVALID',
      );
    });

    it('is not callable by any client role', async () => {
      const p = await mint(cashier, 'steps');
      for (const c of [cashier, manager, owner, driver, guest]) {
        const r = await appRpc(c, 'claim_staff_media', {
          p_paths: [p],
          p_venue: VENUE_A_ID,
          p_folders: ['steps'],
          p_used_by: 'probe:rpc',
        });
        expect(r.error).not.toBeNull();
      }
      const { data } = await svc
        .from('staff_media_uploads')
        .select('used_by')
        .eq('path', p)
        .single();
      expect(data?.used_by).toBeNull();
    });
  });
});
