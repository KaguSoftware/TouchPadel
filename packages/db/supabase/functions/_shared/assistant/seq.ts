/**
 * seq — the next message number of a conversation, race-free with no SQL
 * change. assistant_messages carries `unique (conversation_id, seq)` (0108):
 * two sends that both read max(seq) and insert max + 1 used to collide, and
 * the loser's message was lost with a 500. Now the loser sees 23505 (unique
 * violation), reads max(seq) again and retries; the unique constraint is the
 * lock.
 *
 * PURE: no `Deno.*`, no `npm:`, no supabase-js; the caller hands in two small
 * ports, so vitest runs it (tests/assistant-seq.test.ts).
 */

export interface SeqError {
  code?: string | null;
  message?: string | null;
}

export interface SeqPorts {
  /** The conversation's highest seq, 0 when it has no message yet. */
  maxSeq(): Promise<number>;
  /** Insert the row at this seq: null on success, the database error otherwise. */
  insert(seq: number): Promise<SeqError | null>;
}

/** Enough for any realistic burst of sends into one conversation. */
export const SEQ_ATTEMPTS = 5;

/**
 * Insert at max(seq) + 1, re-reading and retrying on a unique violation.
 * Resolves with the seq the row landed at, or the last error (a non-23505
 * error is returned at once; 23505 after SEQ_ATTEMPTS tries).
 */
export async function insertAtNextSeq(ports: SeqPorts, attempts: number = SEQ_ATTEMPTS): Promise<{ seq: number; error: SeqError | null }> {
  let seq = 0;
  let error: SeqError | null = null;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    seq = (await ports.maxSeq()) + 1;
    error = await ports.insert(seq);
    if (!error) return { seq, error: null };
    if (error.code !== '23505') return { seq, error };
  }
  return { seq, error };
}
