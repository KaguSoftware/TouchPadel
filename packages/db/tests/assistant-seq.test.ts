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
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), 'utf8');

  it('assistant-chat inserts both turns through it and checks ownership before the quota', () => {
    const src = read('../supabase/functions/assistant-chat/index.ts');
    expect(src).not.toMatch(/seq: userSeq \+ 1/);
    expect(src).toMatch(/insertAtNextSeq\(/);
    const handler = src.slice(src.indexOf("Deno.serve(handle('assistant-chat'"));
    const owner = handler.indexOf("'not your conversation'");
    const quota = handler.indexOf("rpc('llm_begin_request')");
    expect(owner).toBeGreaterThan(-1);
    expect(quota).toBeGreaterThan(owner);
  });

  it('assistant-job writes its answer through it', () => {
    expect(read('../supabase/functions/assistant-job/index.ts')).toMatch(/insertAtNextSeq\(/);
  });
});
