import { describe, expect, it } from 'vitest';
import { describeChange } from './change';

const fmt = { num: (n: number) => String(n), points: (n: string) => `${n} pts` };

describe('describeChange', () => {
  it('prints amounts in percent and rates in points, with a real minus sign', () => {
    expect(describeChange(12, {}, fmt)).toEqual({ text: '+12%', direction: 'up', tone: 'success' });
    expect(describeChange(-3, { kind: 'points' }, fmt)).toEqual({ text: '−3 pts', direction: 'down', tone: 'danger' });
  });

  it('inverts the tone where a rise is bad, and keeps neutral figures neutral', () => {
    expect(describeChange(5, { invert: true, kind: 'points' }, fmt)?.tone).toBe('danger');
    expect(describeChange(-5, { invert: true }, fmt)?.tone).toBe('success');
    expect(describeChange(40, { neutral: true }, fmt)?.tone).toBe('neutral');
  });

  it('reads a zero change as flat and neutral, and describes nothing without a comparison', () => {
    expect(describeChange(0.4, {}, fmt)).toEqual({ text: '0%', direction: 'flat', tone: 'neutral' });
    expect(describeChange(null, {}, fmt)).toBeNull();
    expect(describeChange(Number.NaN, {}, fmt)).toBeNull();
  });
});
