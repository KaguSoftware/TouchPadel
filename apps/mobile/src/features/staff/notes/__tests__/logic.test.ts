import { describe, expect, it } from 'vitest';
import { NOTE_MAX, checkNote, daysLeft, initialItemId } from '../logic';

/** Notes on a new item's first 30 days (build-contracts-2026-09-23 §2.10, Q9). */

const NOW = Date.parse('2026-09-25T12:00:00Z');

describe('notes on new items', () => {
  it('counts the days left to write, today included', () => {
    expect(daysLeft('2026-10-05T12:00:00Z', NOW)).toBe(10);
    expect(daysLeft('2026-09-25T18:00:00Z', NOW)).toBe(1);
    expect(daysLeft('2026-09-25T11:59:59Z', NOW)).toBe(0);
    expect(daysLeft('not a date', NOW)).toBe(0);
  });

  it('opens on the item a link named, else the newest launch', () => {
    const items = [{ menu_item_id: 'newest' }, { menu_item_id: 'older' }];
    expect(initialItemId(items, 'older')).toBe('older');
    expect(initialItemId(items, undefined)).toBe('newest');
    expect(initialItemId([], null)).toBeNull();
  });

  it('asks for something written, within the 2000-character cap', () => {
    expect(checkNote('  ')).toBe('required');
    expect(checkNote('Guests asked for less sugar.')).toBeNull();
    expect(checkNote('ع'.repeat(NOTE_MAX))).toBeNull();
    expect(checkNote('ع'.repeat(NOTE_MAX + 1))).toBe('tooLong');
  });
});
