/**
 * 0302 profile_avatar_birth_date (Edit profile, owner 2026-10-04).
 *
 *   - the avatars bucket: a guest uploads into their own folder only, reads
 *     their own photo, never another guest's; active staff read every photo;
 *   - app.set_my_avatar: refuses another folder and a missing object, sets,
 *     answers a repeat as a duplicate, queues the replaced photo, clears;
 *   - app.set_my_birth_date / app.my_birth_date: the range, clearing, and no
 *     column grant (the desk never reads it);
 *   - account deletion empties both columns and queues the whole folder;
 *   - the service pair is the service role's alone.
 *
 * Needs the local stack.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  anonymousSessionClient,
  appRpc,
  createStaffOfRole,
  guestClient,
  serviceClient,
  stackAvailable,
} from './helpers';

const up = await stackAvailable();

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

async function uid(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getUser();
  return data.user!.id;
}

async function upload(c: SupabaseClient, path: string) {
  return c.storage.from('avatars').upload(path, PNG, { contentType: 'image/png', upsert: false });
}

describe.skipIf(!up)('0302 profile avatar and date of birth', () => {
  let svc: SupabaseClient;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId: string;
  let bId: string;
  let desk: { id: string; client: SupabaseClient };

  beforeAll(async () => {
    svc = serviceClient();
    a = await guestClient(svc, 'avatar-a');
    b = await guestClient(svc, 'avatar-b');
    aId = await uid(a);
    bId = await uid(b);
    desk = await createStaffOfRole(svc, 'court_desk', 'avatar');
  });

  afterAll(async () => {
    if (desk) await svc.from('staff').update({ is_active: false }).eq('id', desk.id);
  });

  describe('the avatars bucket', () => {
    it('admits an upload into the own folder only', async () => {
      const own = await upload(a, `${aId}/${crypto.randomUUID()}.png`);
      expect(own.error).toBeNull();
      const other = await upload(a, `${bId}/${crypto.randomUUID()}.png`);
      expect(other.error).not.toBeNull();
      const badName = await upload(a, `${aId}/me.png`);
      expect(badName.error).not.toBeNull();
    });

    it('lets the owner and staff read a photo, never another guest', async () => {
      const path = `${aId}/${crypto.randomUUID()}.png`;
      expect((await upload(a, path)).error).toBeNull();
      expect((await a.storage.from('avatars').createSignedUrl(path, 60)).error).toBeNull();
      expect((await desk.client.storage.from('avatars').createSignedUrl(path, 60)).error).toBeNull();
      expect((await b.storage.from('avatars').createSignedUrl(path, 60)).error).not.toBeNull();
      const listed = await b.storage.from('avatars').list(aId);
      expect(listed.data ?? []).toHaveLength(0);
    });
  });

  describe('app.set_my_avatar', () => {
    it('is not granted to anon', async () => {
      const res = await appRpc(anonClient(), 'set_my_avatar', { p_path: null });
      expect(res.error?.message ?? '').toMatch(/permission denied/i);
    });

    it('ACCOUNT_REQUIRED for an anonymous café session', async () => {
      const res = await appRpc(await anonymousSessionClient(), 'set_my_avatar', { p_path: null });
      expect(res.error?.message).toBe('ACCOUNT_REQUIRED');
    });

    it("refuses another guest's folder and a path with no object", async () => {
      const bPath = `${bId}/${crypto.randomUUID()}.png`;
      expect((await upload(b, bPath)).error).toBeNull();
      expect((await appRpc(a, 'set_my_avatar', { p_path: bPath })).error?.message).toBe('INVALID_ARGUMENT');
      const missing = `${aId}/${crypto.randomUUID()}.png`;
      expect((await appRpc(a, 'set_my_avatar', { p_path: missing })).error?.message).toBe('INVALID_ARGUMENT');
    });

    it('sets, repeats as a duplicate, queues the replaced photo and clears', async () => {
      const first = `${aId}/${crypto.randomUUID()}.png`;
      const second = `${aId}/${crypto.randomUUID()}.png`;
      expect((await upload(a, first)).error).toBeNull();
      expect((await upload(a, second)).error).toBeNull();

      const set1 = await appRpc(a, 'set_my_avatar', { p_path: first });
      expect(set1.error).toBeNull();
      expect(set1.data).toEqual({ avatar_path: first, duplicate: false });
      expect((await appRpc(a, 'set_my_avatar', { p_path: first })).data).toEqual({
        avatar_path: first,
        duplicate: true,
      });

      const own = await a.from('profiles').select('avatar_path').eq('id', aId).single();
      expect(own.data?.avatar_path).toBe(first);
      // The desk reads it beside the name (profiles_select).
      const atDesk = await desk.client.from('profiles').select('avatar_path').eq('id', aId).single();
      expect(atDesk.data?.avatar_path).toBe(first);

      expect((await appRpc(a, 'set_my_avatar', { p_path: second })).error).toBeNull();
      const due = await appRpc(svc, 'avatar_purge_due', { p_limit: 500 });
      expect((due.data as { path: string }[]).map((r) => r.path)).toContain(first);
      expect((await appRpc(svc, 'avatar_in_use', { p_path: second })).data).toBe(true);
      expect((await appRpc(svc, 'avatar_in_use', { p_path: first })).data).toBe(false);

      expect((await appRpc(a, 'set_my_avatar', { p_path: null })).data).toEqual({
        avatar_path: null,
        duplicate: false,
      });
      const cleared = await a.from('profiles').select('avatar_path').eq('id', aId).single();
      expect(cleared.data?.avatar_path).toBeNull();
    });

    it('a guest cannot write avatar_path directly', async () => {
      const res = await a.from('profiles').update({ avatar_path: null } as never).eq('id', aId);
      expect(res.error?.message ?? '').toMatch(/permission denied/i);
    });
  });

  describe('date of birth', () => {
    it('sets, reads back and clears', async () => {
      expect((await appRpc(a, 'set_my_birth_date', { p_birth_date: '1994-03-07' })).error).toBeNull();
      expect((await appRpc(a, 'my_birth_date', {})).data).toEqual({ birth_date: '1994-03-07' });
      expect((await appRpc(a, 'set_my_birth_date', { p_birth_date: null })).error).toBeNull();
      expect((await appRpc(a, 'my_birth_date', {})).data).toEqual({ birth_date: null });
    });

    it('refuses a date before 1900 or in the future', async () => {
      for (const d of ['1899-12-31', '2999-01-01']) {
        const res = await appRpc(a, 'set_my_birth_date', { p_birth_date: d });
        expect(res.error?.message).toBe('INVALID_ARGUMENT');
      }
    });

    it('has no column grant: neither the guest nor the desk selects it', async () => {
      expect((await a.from('profiles').select('birth_date').eq('id', aId)).error).not.toBeNull();
      expect((await desk.client.from('profiles').select('birth_date').eq('id', aId)).error).not.toBeNull();
    });
  });

  it('account deletion empties both columns and queues the folder', async () => {
    const g = await guestClient(svc, 'avatar-del');
    const gId = await uid(g);
    const path = `${gId}/${crypto.randomUUID()}.png`;
    expect((await upload(g, path)).error).toBeNull();
    expect((await appRpc(g, 'set_my_avatar', { p_path: path })).error).toBeNull();
    expect((await appRpc(g, 'set_my_birth_date', { p_birth_date: '2001-01-01' })).error).toBeNull();

    expect((await appRpc(g, 'delete_my_account', { p_confirm: 'DELETE' })).error).toBeNull();

    const row = await svc.from('profiles').select('avatar_path, birth_date').eq('id', gId).single();
    expect(row.data).toEqual({ avatar_path: null, birth_date: null });
    const due = await appRpc(svc, 'avatar_purge_due', { p_limit: 500 });
    expect((due.data as { path: string }[]).map((r) => r.path)).toContain(gId);
  });

  it('the purge pair is the service role alone', async () => {
    for (const c of [a, desk.client]) {
      expect((await appRpc(c, 'avatar_purge_due', { p_limit: 1 })).error?.message ?? '').toMatch(/permission denied/i);
      expect((await appRpc(c, 'avatar_purged', { p_id: crypto.randomUUID() })).error?.message ?? '').toMatch(
        /permission denied/i,
      );
    }
  });
});
