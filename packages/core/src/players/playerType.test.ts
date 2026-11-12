import { describe, expect, it } from 'vitest';
import { PICKABLE_LEVELS, PLAYER_TYPES, levelForPick, levelOfType, playerTypeOf, sameType } from './playerType';

describe('playerType', () => {
  it('reads every stored code as the server tournament rule does (0359)', () => {
    expect(playerTypeOf('advanced')).toBe('A');
    expect(playerTypeOf('intermediate')).toBe('B');
    expect(playerTypeOf('beginner')).toBe('C');
    expect(playerTypeOf('new')).toBe('C');
    expect(playerTypeOf(null)).toBeNull();
    expect(playerTypeOf('pro')).toBeNull();
  });

  it('offers one code per type, in A, B, C order', () => {
    expect(PICKABLE_LEVELS.map(playerTypeOf)).toEqual([...PLAYER_TYPES]);
    expect(PLAYER_TYPES.map(levelOfType)).toEqual([...PICKABLE_LEVELS]);
  });

  it('keeps a stored new when Type C is pressed, and saves the type code otherwise', () => {
    expect(levelForPick('beginner', 'new')).toBe('new');
    expect(levelForPick('beginner', 'advanced')).toBe('beginner');
    expect(levelForPick('advanced', null)).toBe('advanced');
    expect(sameType('new', 'beginner')).toBe(true);
    expect(sameType(null, null)).toBe(false);
  });
});
