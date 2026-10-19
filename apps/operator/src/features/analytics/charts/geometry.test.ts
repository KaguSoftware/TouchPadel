import { describe, expect, it } from 'vitest';
import { arcPath, layoutArcs, meterSweep, nearestIndex, sparkPaths, sparkPoints, sumTotals } from './geometry';

describe('layoutArcs', () => {
  it('shares the ring by value and leaves a gap between neighbours', () => {
    const arcs = layoutArcs([
      { key: 'a', value: 3 },
      { key: 'b', value: 1 },
    ], 0.1);
    expect(arcs.map((a) => a.share)).toEqual([75, 25]);
    expect(arcs[0]!.start).toBeCloseTo(0.05);
    expect(arcs[1]!.start - arcs[0]!.end).toBeCloseTo(0.1);
    // The last arc ends half a gap short of where the first began, a full turn on.
    expect(arcs[1]!.end).toBeCloseTo(Math.PI * 2 - 0.05);
  });

  it('gives zero and negative values no arc, and a lone slice the whole ring', () => {
    const arcs = layoutArcs([
      { key: 'a', value: 0 },
      { key: 'b', value: -4 },
      { key: 'c', value: 9 },
    ]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.start).toBe(0);
    expect(arcs[0]!.end).toBeCloseTo(Math.PI * 2);
    expect(layoutArcs([{ key: 'a', value: 0 }])).toEqual([]);
  });
});

describe('arcPath', () => {
  it('draws a full ring as two halves, because a closed SVG arc draws nothing', () => {
    expect(arcPath(50, 50, 30, 40, 0, Math.PI * 2).match(/M /g)).toHaveLength(2);
    expect(arcPath(50, 50, 30, 40, 0, 1).match(/M /g)).toHaveLength(1);
  });

  it('flags the large arc past half a turn', () => {
    expect(arcPath(50, 50, 30, 40, 0, 4)).toContain(' 0 1 1 ');
    expect(arcPath(50, 50, 30, 40, 0, 2)).toContain(' 0 0 1 ');
  });
});

describe('meterSweep', () => {
  it('clamps a rate to one turn and treats nothing as nothing', () => {
    expect(meterSweep(50)).toBeCloseTo(Math.PI);
    expect(meterSweep(140)).toBeCloseTo(Math.PI * 2);
    expect(meterSweep(null)).toBe(0);
    expect(meterSweep(-3)).toBe(0);
  });
});

describe('sparkPoints', () => {
  it('floors the series at zero, not at its minimum', () => {
    const pts = sparkPoints([5, 10], 100, 40, 0);
    expect(pts[0]!.y).toBe(20);
    expect(pts[1]!.y).toBe(0);
    expect(pts[1]!.x).toBe(100);
  });

  it('draws an all-zero series flat on the floor and a single point in the middle', () => {
    expect(sparkPoints([0, 0, 0], 100, 40, 2).every((p) => p.y === 38)).toBe(true);
    expect(sparkPoints([7], 100, 40)[0]!.x).toBe(50);
  });

  it('closes the area down to the floor and finds the point under the pointer', () => {
    const pts = sparkPoints([1, 2, 3], 100, 20, 0);
    expect(sparkPaths(pts, 20).area.endsWith('L 0 20 Z')).toBe(true);
    expect(nearestIndex(pts, 70)).toBe(1);
    expect(nearestIndex(pts, 80)).toBe(2);
  });
});

describe('sumTotals', () => {
  it('adds open cells by hour and by day, and keeps a closed hour null', () => {
    const t = sumTotals([
      { dow: 0, hour: 9, value: 2 },
      { dow: 1, hour: 9, value: 3 },
      { dow: 1, hour: 10, value: 4, thin: true },
      { dow: 2, hour: 11, value: 5, open: false },
    ]);
    expect(t.hours[9]).toBe(5);
    expect(t.hours[10]).toBeNull();
    expect(t.hours[11]).toBeNull();
    expect(t.days[1]).toBe(3);
    expect(t.days[2]).toBeNull();
  });
});
