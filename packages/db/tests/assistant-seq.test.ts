/**
 * The next message number of a conversation (supabase/functions/_shared/
 * assistant/seq.ts), pure, no stack. Two sends into one chat used to read the
 * same max(seq) and collide on `unique (conversation_id, seq)` (0108); the
 * loser's message was lost with a 500 (W2 #13). Now a 23505 re-reads and
 * retries.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { insertAtNextSeq, SEQ_ATTEMPTS, type SeqError } from '../supabase/functions/_shared/assistant/seq.ts';

/** A conversation table with the real unique (conversation_id, seq) rule. */
function table(initial: number[] = []) {
  const seqs = new Set(initial);
  return {
    seqs,
    maxSeq: async () => (seqs.size ? Math.max(...seqs) : 0),
    insert: async (seq: number): Promise<SeqError | null> => {
      if (seqs.has(seq)) return { code: '23505', message: 'duplicate key value violates unique constraint' };
      seqs.add(seq);
      return null;
    },
  };
}

describe('insertAtNextSeq', () => {
  it('takes max + 1, and 1 in an empty conversation', async () => {
    expect(await insertAtNextSeq(table())).toEqual({ seq: 1, error: null });
    expect(await insertAtNextSeq(table([1, 2, 3]))).toEqual({ seq: 4, error: null });
  });

  it('two concurrent sends both land, at different numbers', async () => {
    const t = table([1, 2]);
    // Both read max = 2 before either inserts: the classic race.
    let reads = 0;
    const racing = {
      maxSeq: async () => (reads++ < 2 ? 2 : t.maxSeq()),
      insert: t.insert,
    };
    const [a, b] = await Promise.all([insertAtNextSeq(racing), insertAtNextSeq(racing)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(new Set([a.seq, b.seq])).toEqual(new Set([3, 4]));
    expect([...t.seqs].sort()).toEqual([1, 2, 3, 4]);
  });

  it('returns any other database error at once, without retrying', async () => {
    let inserts = 0;
    const out = await insertAtNextSeq({
      maxSeq: async () => 0,
      insert: async () => {
        inserts++;
        return { code: '23503', message: 'foreign key' };
      },
    });
    expect(out.error?.code).toBe('23503');
    expect(inserts).toBe(1);
  });

  it('gives up after SEQ_ATTEMPTS unique violations and says so', async () => {
    let inserts = 0;
    const out = await insertAtNextSeq({
      maxSeq: async () => 0,
      insert: async () => {
        inserts++;
        return { code: '23505' };
      },
    });
    expect(out.error?.code).toBe('23505');
    expect(inserts).toBe(SEQ_ATTEMPTS);
  });

  it('a max(seq) read that throws once is retried, and the row lands', async () => {
    const t = table([1, 2]);
    let reads = 0;
    const out = await insertAtNextSeq({
      maxSeq: async () => {
        if (reads++ === 0) throw { code: '57014', message: 'statement timeout' };
        return t.maxSeq();
      },
      insert: t.insert,
    });
    expect(out).toEqual({ seq: 3, error: null });
    expect(reads).toBe(2);
  });

  it('a max(seq) read that throws twice is returned as the error, never thrown, and nothing is inserted', async () => {
    let reads = 0;
    let inserts = 0;
    const out = await insertAtNextSeq({
      maxSeq: async () => {
        reads++;
        throw { code: '57014', message: 'statement timeout' };
      },
      insert: async () => {
        inserts++;
        return null;
      },
    });
    expect(out.error).toEqual({ code: '57014', message: 'statement timeout' });
    expect(reads).toBe(2);
    expect(inserts).toBe(0);
    // A bare throw keeps its text.
    const bare = await insertAtNextSeq({ maxSeq: async () => { throw new Error('fetch failed'); }, insert: async () => null });
    expect(bare.error).toEqual({ code: null, message: 'fetch failed' });
  });

  it('the one read retry is for the whole call, not per 23505 attempt', async () => {
    let reads = 0;
    const out = await insertAtNextSeq({
      maxSeq: async () => {
        reads++;
        if (reads === 1 || reads === 3) throw { code: '08006', message: 'connection failure' };
        return 0;
      },
      insert: async () => ({ code: '23505' }),
    });
    expect(out.error).toEqual({ code: '08006', message: 'connection failure' });
    expect(reads).toBe(3);
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), 'utf8');

  it('assistant-chat inserts both turns through it and checks ownership before the quota', () => {
    const src = read('../supabase/functions/assistant-chat/index.ts');
    // Both inserts go through persist.ts insertMessage since the 2026-11-09 split.
    const persist = read('../supabase/functions/_shared/assistant/persist.ts');
    for (const s of [src, persist]) expect(s).not.toMatch(/seq: userSeq \+ 1/);
    expect(persist).toMatch(/insertAtNextSeq\(/);
    expect(src.match(/insertMessage\(service, conv\.id, \{/g)).toHaveLength(1);
    expect(persist).toMatch(/insertMessage\(service, convId, \{/);
    const handler = src.slice(src.indexOf("Deno.serve(handle('assistant-chat'"));
    const owner = handler.indexOf("'not your conversation'");
    const quota = handler.indexOf("rpc('llm_begin_request')");
    expect(owner).toBeGreaterThan(-1);
    expect(quota).toBeGreaterThan(owner);
  });

  it('assistant-job writes its answer through it', () => {
    // The reduce step (Book.reduce) moved to jobRunner.ts on 2026-11-11; index.ts writes no message.
    const runner = read('../supabase/functions/_shared/assistant/jobRunner.ts');
    expect(runner).toMatch(/insertAtNextSeq\(/);
    expect(runner).not.toMatch(/seq: [a-z]\w* \+ 1/);
    expect(read('../supabase/functions/assistant-job/index.ts')).not.toMatch(/from\('assistant_messages'\)/);
  });
});
