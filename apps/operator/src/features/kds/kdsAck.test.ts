import { describe, expect, it } from 'vitest';
import { ACK_BATCH, ACKED_CAP, markAcked, pendingAcks } from './kdsAck';

describe('kitchen screen acks (F-11)', () => {
  it('sends each drawn id once, in batches', () => {
    const sent = new Set<string>();
    expect(pendingAcks(['a', 'b', 'a'], sent)).toEqual(['a', 'b']);
    markAcked(sent, ['a', 'b']);
    expect(pendingAcks(['a', 'b', 'c'], sent)).toEqual(['c']);
    const many = Array.from({ length: ACK_BATCH + 10 }, (_, i) => `id${i}`);
    expect(pendingAcks(many, new Set())).toHaveLength(ACK_BATCH);
  });

  it('keeps the sent set bounded, oldest out first', () => {
    const sent = new Set<string>();
    markAcked(sent, Array.from({ length: ACKED_CAP + 5 }, (_, i) => `id${i}`));
    expect(sent.size).toBe(ACKED_CAP);
    expect(sent.has('id0')).toBe(false);
    expect(sent.has(`id${ACKED_CAP + 4}`)).toBe(true);
  });
});
