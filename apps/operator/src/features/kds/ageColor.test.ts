import { describe, expect, it } from 'vitest';
import { ageColor, formatAge } from './ageColor';

const TARGET = 600; // default tickets.target_seconds

describe('ageColor', () => {
  it('is green under 5 minutes', () => {
    expect(ageColor(0, TARGET)).toBe('green');
    expect(ageColor(299, TARGET)).toBe('green');
  });

  it('is amber between 5 and 10 minutes', () => {
    expect(ageColor(300, TARGET)).toBe('amber');
    expect(ageColor(599, TARGET)).toBe('amber');
  });

  it('is red past 10 minutes', () => {
    expect(ageColor(600, TARGET)).toBe('red');
    expect(ageColor(4000, TARGET)).toBe('red');
  });

  it('goes red at target_seconds even before the 10-minute mark', () => {
    expect(ageColor(240, 240)).toBe('red'); // 4-minute target, 4 minutes old
    expect(ageColor(239, 240)).toBe('green');
    expect(ageColor(301, 240)).toBe('red');
  });

  it('a long target does not delay the generic red threshold', () => {
    expect(ageColor(650, 1800)).toBe('red');
  });

  it('clamps negative ages (clock skew) to green', () => {
    expect(ageColor(-30, TARGET)).toBe('green');
  });
});

describe('formatAge', () => {
  it('renders m:ss', () => {
    expect(formatAge(0)).toBe('0:00');
    expect(formatAge(65)).toBe('1:05');
    expect(formatAge(600)).toBe('10:00');
  });
});
