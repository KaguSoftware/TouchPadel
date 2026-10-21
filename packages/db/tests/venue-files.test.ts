/**
 * venue_files (0354) — the Files page and the owner assistant's two reads.
 *
 *   * the owner and a manager add files (begin → upload → finish) and list
 *     them; staff below management and guests are refused; the paths are
 *     minted by the server, never chosen by the client;
 *   * storage takes only the compressed types (gzip, WebP), only at a name
 *     the caller's own unfinished file was given, and reads follow the row:
 *     an owner_only file is the owner's alone, a guest reads nothing;
 *   * a manager may not mark a file owner_only, edit one, or remove one they
 *     did not add; the owner removes anything, and storage deletes an object
 *     only for someone who may remove its file (objects first, then the row);
 *   * the arguments and FILE_TOO_LARGE are checked before anything is recorded;
 *   * assistant_files_list / assistant_file_get answer the owner only, through
 *     the dispatcher's read-only wall, and file_get says where the text is.
 *
 * Self-contained: every row and object the file makes is removed in afterAll.
 * The storage cases skip when the storage API is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, anonymousSessionClient, appRpc, SEED_STAFF, VENUE_A_ID } from './helpers';

const up = await stackAvailable();
const BUCKET = 'venue-files';
const NIL = '00000000-0000-4000-8000-000000000000';

interface Begun {
  id: string;
  blob_path: string;
  text_path: string | null;
}

describe.skipIf(!up)('venue_files', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  let storageUp = false;
  const made = new Set<string>();
  const objects = new Set<string>();

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await anonymousSessionClient();
    const bucket = await svc.storage.getBucket(BUCKET).catch(() => ({ data: null, error: { message: 'x' } }));
    storageUp = !bucket.error && !!bucket.data;
  });

  afterAll(async () => {
    if (objects.size) await svc.storage.from(BUCKET).remove([...objects]);
    if (made.size) {
      const r = await svc.from('venue_files').delete().in('id', [...made]);
      expect(r.error).toBeNull();
    }
    for (const c of [owner, manager, cashier, guest]) await c?.auth.signOut();
  });

  const text = 'Supplier contract\nTerm: 12 months\nCall 07701234567 for orders';
  const packedText = new Uint8Array(gzipSync(Buffer.from(text, 'utf8')));
  const packedBlob = new Uint8Array(gzipSync(Buffer.from('%PDF-1.4 pretend', 'utf8')));

  async function begin(c: SupabaseClient, extra: Record<string, unknown> = {}) {
    const r = await appRpc(c, 'venue_file_begin', {
      p_name: 'Contract.pdf',
      p_mime: 'application/pdf',
      p_size_bytes: 1000,
      p_stored_bytes: packedBlob.byteLength,
      p_encoding: 'gzip',
      p_text_bytes: packedText.byteLength,
      p_venue_id: VENUE_A_ID,
      ...extra,
    });
    if (!r.error) made.add((r.data as Begun).id);
    return r;
  }
  async function put(c: SupabaseClient, path: string, bytes: Uint8Array, contentType = 'application/gzip') {
    const r = await c.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (!r.error) objects.add(path);
    return r;
  }
  /** begin → upload both → finish, as the operator does. */
  async function addFile(c: SupabaseClient, extra: Record<string, unknown> = {}): Promise<Begun> {
    const b = await begin(c, extra);
    expect(b.error, b.error?.message).toBeNull();
    const begun = b.data as Begun;
    expect((await put(c, begun.blob_path, packedBlob)).error).toBeNull();
    expect((await put(c, begun.text_path!, packedText)).error).toBeNull();
    const f = await appRpc(c, 'venue_file_finish', { p_id: begun.id, p_text_chars: text.length });
    expect(f.error, f.error?.message).toBeNull();
    return begun;
  }
  const list = async (c: SupabaseClient) => {
    const r = await appRpc(c, 'venue_files_list', { p_venue_id: VENUE_A_ID });
    expect(r.error, r.error?.message).toBeNull();
    return r.data as { files: Array<Record<string, unknown>>; used_bytes: number; quota_bytes: number; is_owner: boolean };
  };
  const canRead = async (c: SupabaseClient, path: string) => !(await c.storage.from(BUCKET).download(path)).error;

  it('mints the paths for management at the branch, and refuses everyone else', async () => {
    for (const c of [owner, manager]) {
      const r = await begin(c);
      expect(r.error, r.error?.message).toBeNull();
      const b = r.data as Begun;
      expect(b.blob_path).toBe(`${VENUE_A_ID}/${b.id}.gz`);
      expect(b.text_path).toBe(`${VENUE_A_ID}/${b.id}.txt.gz`);
    }
    const photo = await begin(owner, { p_name: 'Licence.jpg', p_mime: 'image/jpeg', p_encoding: 'webp', p_text_bytes: null });
    expect((photo.data as Begun).blob_path).toMatch(/\.webp$/);
    expect((photo.data as Begun).text_path).toBeNull();
    for (const c of [cashier, guest]) expect((await begin(c)).error?.message).toMatch(/FORBIDDEN/);
    expect((await appRpc(cashier, 'venue_files_list', { p_venue_id: VENUE_A_ID })).error?.message).toMatch(/FORBIDDEN/);
  });

  it('checks the arguments and the size, and a manager cannot mark a file owner_only', async () => {
    expect((await begin(owner, { p_encoding: 'zip' })).error?.message).toMatch(/INVALID_ARGUMENT/);
    expect((await begin(owner, { p_name: '   ' })).error?.message).toMatch(/INVALID_ARGUMENT/);
    expect((await begin(owner, { p_mime: 'not a type' })).error?.message).toMatch(/INVALID_ARGUMENT/);
    expect((await begin(owner, { p_size_bytes: 60 * 1024 * 1024 })).error?.message).toMatch(/FILE_TOO_LARGE/);
    expect((await list(owner)).quota_bytes).toBe(2147483648);
    expect((await begin(manager, { p_owner_only: true })).error?.message).toMatch(/FORBIDDEN/);
  });

  it('storage takes only compressed objects, only at a minted name, from its uploader', async (ctx) => {
    if (!storageUp) ctx.skip();
    const b = (await begin(manager)).data as Begun;
    // Not a compressed type: refused by the bucket.
    expect((await put(manager, b.blob_path, new Uint8Array([1, 2, 3]), 'application/pdf')).error).not.toBeNull();
    // Not the uploader: refused by the insert rule.
    expect((await put(owner, b.blob_path, packedBlob)).error).not.toBeNull();
    // A name nobody minted: refused.
    expect((await put(manager, `${VENUE_A_ID}/${NIL}.gz`, packedBlob)).error).not.toBeNull();
    expect((await put(manager, b.blob_path, packedBlob)).error).toBeNull();
    // Finished: no more uploads to it.
    expect((await appRpc(manager, 'venue_file_finish', { p_id: b.id, p_text_chars: null })).error).toBeNull();
    expect((await put(manager, b.text_path!, packedText)).error).not.toBeNull();
    // No text stored: the row forgets the text name.
    const row = (await list(manager)).files.find((f) => f.id === b.id)!;
    expect(row.has_text).toBe(false);
    expect(row.can_delete).toBe(true);
  });

  it('reads follow the row: management reads, owner_only is the owner alone, guests nothing', async (ctx) => {
    if (!storageUp) ctx.skip();
    const shared = await addFile(manager);
    const secret = await addFile(owner, { p_owner_only: true });

    const asManager = await list(manager);
    expect(asManager.files.some((f) => f.id === shared.id)).toBe(true);
    expect(asManager.files.some((f) => f.id === secret.id)).toBe(false);
    expect(asManager.is_owner).toBe(false);
    const asOwner = await list(owner);
    expect(asOwner.files.some((f) => f.id === secret.id)).toBe(true);
    expect(asOwner.used_bytes).toBeGreaterThan(0);

    expect(await canRead(manager, shared.blob_path)).toBe(true);
    expect(await canRead(owner, shared.text_path!)).toBe(true);
    expect(await canRead(manager, secret.blob_path)).toBe(false);
    expect(await canRead(owner, secret.blob_path)).toBe(true);
    expect(await canRead(cashier, shared.blob_path)).toBe(false);
    expect(await canRead(guest, shared.blob_path)).toBe(false);

    // What comes back is what went in, compressed: gunzip gives the words.
    const { data } = await owner.storage.from(BUCKET).download(shared.text_path!);
    expect(gunzipSync(Buffer.from(await data!.arrayBuffer())).toString('utf8')).toBe(text);
  });

  it('a manager edits and removes only what they may; storage deletes only orphans', async (ctx) => {
    if (!storageUp) ctx.skip();
    const mine = await addFile(manager);
    const owners = await addFile(owner);
    const secret = await addFile(owner, { p_owner_only: true });

    const renamed = await appRpc(manager, 'venue_file_update', { p_id: mine.id, p_name: 'Contract 2026.pdf', p_note: 'Water supplier' });
    expect(renamed.error, renamed.error?.message).toBeNull();
    expect((renamed.data as { name: string; note: string }).note).toBe('Water supplier');
    expect((await appRpc(manager, 'venue_file_update', { p_id: mine.id, p_name: 'x', p_owner_only: true })).error?.message).toMatch(/FORBIDDEN/);
    expect((await appRpc(manager, 'venue_file_update', { p_id: secret.id, p_name: 'x' })).error?.message).toMatch(/FILE_NOT_FOUND/);

    expect((await appRpc(manager, 'venue_file_delete', { p_id: owners.id })).error?.message).toMatch(/FILE_NOT_YOURS/);
    expect((await appRpc(manager, 'venue_file_delete', { p_id: secret.id })).error?.message).toMatch(/FILE_NOT_FOUND/);

    // Storage follows the same rule: the manager cannot delete the owner's objects.
    await manager.storage.from(BUCKET).remove([owners.blob_path, secret.blob_path]);
    expect(await canRead(owner, owners.blob_path)).toBe(true);
    expect(await canRead(owner, secret.blob_path)).toBe(true);

    // Their own: the objects first (the delete rule needs the row), then the row.
    const removed = await manager.storage.from(BUCKET).remove([mine.blob_path, mine.text_path!]);
    expect(removed.error).toBeNull();
    expect(removed.data?.length).toBe(2);
    for (const p of [mine.blob_path, mine.text_path!]) objects.delete(p);
    const gone = await appRpc(manager, 'venue_file_delete', { p_id: mine.id });
    expect(gone.error, gone.error?.message).toBeNull();
    expect((gone.data as { paths: string[] }).paths.sort()).toEqual([mine.blob_path, mine.text_path!].sort());
    expect((await list(owner)).files.some((f) => f.id === mine.id)).toBe(false);

    // The owner removes anyone's.
    const ownersGone = await owner.storage.from(BUCKET).remove([owners.blob_path, owners.text_path!]);
    expect(ownersGone.data?.length).toBe(2);
    for (const p of [owners.blob_path, owners.text_path!]) objects.delete(p);
    expect((await appRpc(owner, 'venue_file_delete', { p_id: owners.id })).error).toBeNull();
  });

  it('the assistant reads files through the wall, owner only', async (ctx) => {
    if (!storageUp) ctx.skip();
    const f = await addFile(manager, { p_name: 'Water supplier price list.pdf', p_note: 'prices from October' });
    const listed = await appRpc(owner, 'assistant_run_tool', { p_tool: 'assistant_files_list', p_args: { p_query: 'water' } });
    expect(listed.error, listed.error?.message).toBeNull();
    const out = listed.data as { data: { files: Array<Record<string, unknown>>; total: number }; row_count: number };
    expect(out.data.files.some((x) => x.id === f.id && x.readable === true)).toBe(true);
    expect(out.row_count).toBe(out.data.files.length);

    const got = await appRpc(owner, 'assistant_run_tool', { p_tool: 'assistant_file_get', p_args: { p_file_id: f.id } });
    expect(got.error, got.error?.message).toBeNull();
    expect((got.data as { data: { text_path: string } }).data.text_path).toBe(f.text_path);

    const missing = await appRpc(owner, 'assistant_run_tool', { p_tool: 'assistant_file_get', p_args: { p_file_id: NIL } });
    expect(missing.error?.message).toMatch(/FILE_NOT_FOUND/);
    expect((await appRpc(manager, 'assistant_run_tool', { p_tool: 'assistant_files_list', p_args: {} })).error?.message).toMatch(/FORBIDDEN/);
    expect((await appRpc(manager, 'assistant_files_list', {})).error?.message).toMatch(/FORBIDDEN/);
  });

  it('keeps no client grant on the table', async () => {
    for (const c of [owner, manager]) {
      const r = await c.from('venue_files').select('id').limit(1);
      expect(r.error).not.toBeNull();
    }
  });
});
