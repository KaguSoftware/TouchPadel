import { describe, expect, it } from 'vitest';
import {
  birthDateToDate,
  dateToBirthDate,
  defaultBirthDate,
  isValidBirthDate,
  birthDateToLocalDate,
  localDateToBirthDate,
  todayBirthDate,
} from '../birthDate';
import { avatarObjectPath } from '../avatar';

const NOW = new Date('2026-10-04T08:30:00Z');

describe('date of birth (0302)', () => {
  it('round-trips a calendar date through noon UTC', () => {
    const d = birthDateToDate('1994-03-07');
    expect(d?.toISOString()).toBe('1994-03-07T12:00:00.000Z');
    expect(dateToBirthDate(d!)).toBe('1994-03-07');
  });

  it("round-trips a calendar date through the phone's own day (the iOS wheel)", () => {
    const d = birthDateToLocalDate('1994-03-07');
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate(), d?.getHours()]).toEqual([
      1994, 2, 7, 12,
    ]);
    expect(localDateToBirthDate(d!)).toBe('1994-03-07');
    expect(localDateToBirthDate(new Date(2001, 11, 31, 0, 5))).toBe('2001-12-31');
    expect(localDateToBirthDate(new Date(2001, 11, 31, 23, 55))).toBe('2001-12-31');
    expect(birthDateToLocalDate('1994-02-30')).toBeNull();
  });

  it('refuses a malformed or impossible date', () => {
    for (const v of ['', null, undefined, '1994-3-7', '1994-02-30', '07/03/1994']) {
      expect(birthDateToDate(v)).toBeNull();
    }
  });

  it('holds the server range, 1900-01-01 .. today', () => {
    expect(isValidBirthDate('1900-01-01', NOW)).toBe(true);
    expect(isValidBirthDate('1899-12-31', NOW)).toBe(false);
    expect(isValidBirthDate(todayBirthDate(NOW), NOW)).toBe(true);
    expect(isValidBirthDate('2026-10-05', NOW)).toBe(false);
  });

  it('opens the picker 25 years back', () => {
    expect(defaultBirthDate(NOW)).toBe('2001-01-01');
  });
});

describe('avatar object path (0302)', () => {
  const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const PHOTO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('is <profile id>/<uuid>.jpg, as app.is_avatar_path accepts', () => {
    expect(avatarObjectPath(ID, PHOTO)).toBe(`${ID}/${PHOTO}.jpg`);
  });

  it('refuses anything that is not a lower-case uuid', () => {
    expect(() => avatarObjectPath('me', PHOTO)).toThrow();
    expect(() => avatarObjectPath(ID, PHOTO.toUpperCase())).toThrow();
  });
});
