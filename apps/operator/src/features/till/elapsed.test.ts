import { describe, expect, it } from 'vitest';
import { elapsedSince, formatElapsed, minutesSince } from './elapsed';

const NOW = Date.parse('2026-09-16T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const tr = (k: string, p?: Record<string, string | number>) => `${k.split('.').pop()}:${JSON.stringify(p ?? {})}`;

describe('elapsedSince', () => {
  it('reads in the unit a person would say', () => {
    expect(elapsedSince(ago(0.5), NOW)).toEqual({ unit: 'now' });
    expect(elapsedSince(ago(25), NOW)).toEqual({ unit: 'minutes', minutes: 25 });
    expect(elapsedSince(ago(130), NOW)).toEqual({ unit: 'hours', hours: 2, minutes: 10 });
    // The call the till used to print as "Waiting 2720 min".
    expect(elapsedSince(ago(2720), NOW)).toEqual({ unit: 'days', days: 1, hours: 21 });
  });

  it('never goes negative when the station clock runs behind the server', () => {
    expect(elapsedSince(new Date(NOW + 90_000).toISOString(), NOW)).toEqual({ unit: 'now' });
    expect(minutesSince(new Date(NOW + 90_000).toISOString(), NOW)).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('picks one message per unit', () => {
    expect(formatElapsed(ago(0), NOW, tr as never)).toBe('ageNow:{}');
    expect(formatElapsed(ago(5), NOW, tr as never)).toBe('age:{"minutes":5}');
    expect(formatElapsed(ago(125), NOW, tr as never)).toBe('ageHours:{"hours":2,"minutes":5}');
    expect(formatElapsed(ago(29 * 60 + 44), NOW, tr as never)).toBe('ageDays:{"days":1,"hours":5}');
  });
});
