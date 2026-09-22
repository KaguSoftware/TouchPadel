import { describe, expect, it } from 'vitest';
import { BarcodeWedge } from './barcodeWedge';

/** Type `s` starting at `t0`, `gap` ms apart; returns the actions and the time of the last key. */
function type(w: BarcodeWedge, s: string, t0: number, gap: number, mode: 'idle' | 'filter' = 'idle') {
  const actions = [...s].map((ch, i) => w.feed(ch, t0 + i * gap, mode));
  return { actions, end: t0 + (s.length - 1) * gap };
}

describe('BarcodeWedge', () => {
  it('reads a fast digit burst ended by Enter as a scan, swallowing every key', () => {
    const w = new BarcodeWedge();
    const { actions, end } = type(w, '6291041500213', 1000, 8);
    expect(actions.every((a) => a.kind === 'swallow')).toBe(true);
    expect(w.feed('Enter', end + 10, 'idle')).toEqual({ kind: 'scan', code: '6291041500213' });
  });

  it('holds a lone digit and hands it back for its category job', () => {
    const w = new BarcodeWedge();
    expect(w.feed('3', 1000, 'idle')).toEqual({ kind: 'swallow' });
    expect(w.flush(1030)).toBeNull(); // still inside the gap: may be a scan
    expect(w.flush(1100)).toBe('3');
    expect(w.flush(1200)).toBeNull(); // handed back once
  });

  it('measures gaps from the key timestamps, not from when the handler ran', () => {
    // Keys pressed 8 ms apart, even if a render delayed their handling by 200 ms.
    const w = new BarcodeWedge();
    const { end } = type(w, '12345678', 5000, 8);
    expect(w.feed('Enter', end + 5, 'idle')).toEqual({ kind: 'scan', code: '12345678' });
  });

  it('does not take a person typing digits slowly for a scanner', () => {
    const w = new BarcodeWedge();
    const { end } = type(w, '123456', 1000, 180);
    expect(w.feed('Enter', end + 100, 'idle')).toEqual({ kind: 'pass' });
  });

  it('ignores a burst shorter than the minimum length', () => {
    const w = new BarcodeWedge();
    const { end } = type(w, '1234', 1000, 5);
    expect(w.feed('Enter', end + 5, 'idle')).toEqual({ kind: 'pass' });
  });

  it('lets a letter-led burst type into the filter, and still recognises its Enter', () => {
    const w = new BarcodeWedge();
    const { actions, end } = type(w, 'RKT-M-01', 1000, 6, 'filter');
    expect(actions.every((a) => a.kind === 'pass')).toBe(true);
    expect(w.feed('Enter', end + 6, 'filter')).toEqual({ kind: 'scan', code: 'RKT-M-01' });
  });

  it('resets on a non-code key', () => {
    const w = new BarcodeWedge();
    type(w, '123', 1000, 5);
    expect(w.feed('ArrowDown', 1020, 'idle')).toEqual({ kind: 'pass' });
    expect(w.feed('Enter', 1025, 'idle')).toEqual({ kind: 'pass' });
  });
});
