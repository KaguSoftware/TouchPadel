import { describe, expect, it, vi } from 'vitest';
import { replaceAvatar, removeAvatar, AVATAR_BUCKET } from '../avatar';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHOTO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PATH = `${ID}/${PHOTO}.jpg`;

function fakeClient(opts: { uploadError?: unknown; rpcError?: unknown } = {}) {
  const upload = vi.fn(async () => ({ data: { path: PATH }, error: opts.uploadError ?? null }));
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const rpc = vi.fn(async () => ({ data: { avatar_path: PATH, duplicate: false }, error: opts.rpcError ?? null }));
  const from = vi.fn(() => ({ upload, remove }));
  const client = { storage: { from }, schema: () => ({ rpc }) };
  return { client, upload, remove, rpc, from };
}

const deps = (client: unknown) => ({
  client: client as never,
  fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }),
  uuid: () => PHOTO,
});

describe('replaceAvatar (0302)', () => {
  it('uploads into the own folder, then points the profile at it', async () => {
    const f = fakeClient();
    expect(await replaceAvatar(ID, 'file:///photo.jpg', deps(f.client))).toBe(PATH);
    expect(f.from).toHaveBeenCalledWith(AVATAR_BUCKET);
    expect(f.upload).toHaveBeenCalledWith(PATH, expect.any(ArrayBuffer), { contentType: 'image/jpeg', upsert: false });
    expect(f.rpc).toHaveBeenCalledWith('set_my_avatar', { p_path: PATH });
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('never calls the RPC when the upload fails', async () => {
    const f = fakeClient({ uploadError: new Error('storage down') });
    await expect(replaceAvatar(ID, 'file:///photo.jpg', deps(f.client))).rejects.toThrow('storage down');
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('removes the upload again when the profile refuses it', async () => {
    const f = fakeClient({ rpcError: { message: 'INVALID_ARGUMENT' } });
    await expect(replaceAvatar(ID, 'file:///photo.jpg', deps(f.client))).rejects.toEqual({ message: 'INVALID_ARGUMENT' });
    expect(f.remove).toHaveBeenCalledWith([PATH]);
  });
});

describe('removeAvatar (0302)', () => {
  it('clears with NULL', async () => {
    const f = fakeClient();
    await removeAvatar(f.client as never);
    expect(f.rpc).toHaveBeenCalledWith('set_my_avatar', { p_path: null });
  });
});
