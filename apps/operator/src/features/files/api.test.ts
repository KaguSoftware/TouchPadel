import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';

// The upload's order (0354): compress first, then record, then send exactly
// the compressed bytes to the names the server minted, then finish.

const calls: Array<{ kind: 'rpc' | 'upload' | 'remove'; name: string; args?: unknown; blob?: Blob; type?: string }> = [];
let failTextUpload = false;
let failRemove = false;

vi.mock('../../lib/appRpc', () => ({
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ kind: 'rpc', name: fn, args });
    if (fn === 'venue_file_begin') return { id: 'f1', blob_path: 'v/f1.gz', text_path: args.p_text_bytes ? 'v/f1.txt.gz' : null };
    if (fn === 'venue_file_finish') return { id: 'f1', has_text: args.p_text_chars !== null };
    return { id: 'f1', paths: [] };
  }),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob, opts: { contentType: string }) => {
          calls.push({ kind: 'upload', name: path, blob, type: opts.contentType });
          if (failTextUpload && path.endsWith('.txt.gz')) return { error: new Error('network') };
          return { error: null };
        },
        remove: async (paths: string[]) => {
          calls.push({ kind: 'remove', name: paths.join(',') });
          return { error: failRemove ? new Error('refused') : null, data: [] };
        },
      }),
    },
  },
}));

import { deleteFile, uploadFile } from './api';

const unzip = async (b: Blob) => Buffer.from(gunzipSync(new Uint8Array(await b.arrayBuffer()))).toString('utf8');

beforeEach(() => {
  calls.length = 0;
  failTextUpload = false;
  failRemove = false;
});

describe('uploadFile', () => {
  it('compresses the file and its words, records the compressed sizes, sends them, then finishes', async () => {
    const stages: string[] = [];
    const csv = 'Item,Price\nWater,2500\n'.repeat(50);
    const file = new File([csv], 'prices.csv', { type: 'text/csv' });
    await uploadFile({ file, note: ' October ', ownerOnly: true, onStage: (s) => stages.push(s) });

    expect(stages).toEqual(['compressing', 'uploading', 'saving']);
    expect(calls.map((c) => `${c.kind}:${c.name}`)).toEqual(['rpc:venue_file_begin', 'upload:v/f1.gz', 'upload:v/f1.txt.gz', 'rpc:venue_file_finish']);
    const begin = calls[0]!.args as Record<string, unknown>;
    const blob = calls[1]!.blob!;
    const text = calls[2]!.blob!;
    expect(begin).toMatchObject({ p_name: 'prices.csv', p_mime: 'text/csv', p_size_bytes: file.size, p_encoding: 'gzip', p_note: 'October', p_owner_only: true });
    // What is recorded is what is sent, and both are gzip, smaller than the file.
    expect(begin.p_stored_bytes).toBe(blob.size);
    expect(begin.p_text_bytes).toBe(text.size);
    expect(blob.size).toBeLessThan(file.size);
    expect(calls[1]!.type).toBe('application/gzip');
    expect(calls[2]!.type).toBe('application/gzip');
    expect(await unzip(blob)).toBe(csv);
    expect(await unzip(text)).toBe(csv.trim());
    expect(calls[3]!.args).toEqual({ p_id: 'f1', p_text_chars: csv.trim().length });
  });

  it('keeps the file without text when its words fail to upload, and sends no text when there are none', async () => {
    failTextUpload = true;
    await uploadFile({ file: new File(['hello'], 'a.txt', { type: 'text/plain' }), note: '', ownerOnly: false });
    expect(calls.at(-1)!.args).toEqual({ p_id: 'f1', p_text_chars: null });

    calls.length = 0;
    await uploadFile({ file: new File([new Uint8Array([1, 2, 3])], 'scan.bin'), note: '', ownerOnly: false });
    expect((calls[0]!.args as Record<string, unknown>).p_text_bytes).toBeNull();
    expect(calls.map((c) => c.name)).toEqual(['venue_file_begin', 'v/f1.gz', 'venue_file_finish']);
  });
});

describe('deleteFile', () => {
  it('removes the objects first, then the row', async () => {
    await deleteFile({ id: 'f1', blobPath: 'v/f1.gz', textPath: 'v/f1.txt.gz' });
    expect(calls.map((c) => `${c.kind}:${c.name}`)).toEqual(['remove:v/f1.gz,v/f1.txt.gz', 'rpc:venue_file_delete']);
  });

  it('stops with the file intact when storage refuses', async () => {
    failRemove = true;
    await expect(deleteFile({ id: 'f1', blobPath: 'v/f1.gz', textPath: null })).rejects.toThrow('refused');
    expect(calls.some((c) => c.name === 'venue_file_delete')).toBe(false);
  });
});
