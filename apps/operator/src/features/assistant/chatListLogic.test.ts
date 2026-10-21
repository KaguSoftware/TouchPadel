import { describe, expect, it } from 'vitest';
import { dayGroup, groupByDay, matchesQuery } from './chatListLogic';

const now = new Date(2026, 9, 20, 15, 0);
const at = (d: number, h = 10) => new Date(2026, 9, d, h, 0);

describe('chat list (design L1)', () => {
  it('puts a chat in today, yesterday, this week or earlier', () => {
    expect(dayGroup(at(20, 1), now)).toBe('today');
    expect(dayGroup(at(19, 23), now)).toBe('yesterday');
    expect(dayGroup(at(14), now)).toBe('week');
    expect(dayGroup(at(13), now)).toBe('earlier');
  });

  it('groups newest first and drops empty groups', () => {
    const groups = groupByDay([{ d: at(20) }, { d: at(10) }, { d: at(20, 8) }], (x) => x.d, now);
    expect(groups.map((g) => g.group)).toEqual(['today', 'earlier']);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('matches every typed word, in any case', () => {
    expect(matchesQuery('Café takings today', 'TAKINGS caf')).toBe(true);
    expect(matchesQuery('Café takings today', 'stock')).toBe(false);
    expect(matchesQuery('Anything', '   ')).toBe(true);
  });
});
