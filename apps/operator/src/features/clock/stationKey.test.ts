import { describe, expect, it } from 'vitest';
import {
  clockKeyName,
  deskKeyStatus,
  forgetStationKey,
  parseStoredKey,
  readStationKey,
  writeStationKey,
  type KeyStorage,
} from './stationKey';

const SECRET = '3132333435363738393031323334353637383930';

function memory(): KeyStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('station clock key storage', () => {
  it('names the key per station, upper case', () => {
    expect(clockKeyName(' till1 ')).toBe('tp.clock-key:TILL1');
  });

  it('round-trips a key and reads it back lower case', () => {
    const s = memory();
    expect(writeStationKey('TILL1', { secret: SECRET.toUpperCase(), issued_at: '2026-11-15T10:00:00+00:00' }, s)).toBe(true);
    expect(readStationKey('till1', s)).toEqual({ secret: SECRET, issued_at: '2026-11-15T10:00:00+00:00' });
    expect(readStationKey('DESK2', s)).toBeNull();
  });

  it('refuses to store anything that is not a 20-byte hex secret', () => {
    const s = memory();
    expect(writeStationKey('TILL1', { secret: 'abc', issued_at: null }, s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it('reads garbage as no key', () => {
    expect(parseStoredKey(null)).toBeNull();
    expect(parseStoredKey('not json')).toBeNull();
    expect(parseStoredKey('{"secret":"xyz"}')).toBeNull();
    expect(parseStoredKey(JSON.stringify({ secret: SECRET, issued_at: '' }))).toEqual({ secret: SECRET, issued_at: null });
  });

  it('survives a storage that throws', () => {
    const broken: KeyStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readStationKey('TILL1', broken)).toBeNull();
    expect(writeStationKey('TILL1', { secret: SECRET, issued_at: null }, broken)).toBe(false);
    expect(() => forgetStationKey('TILL1', broken)).not.toThrow();
    expect(readStationKey('TILL1', null)).toBeNull();
  });

  it('forgets a key', () => {
    const s = memory();
    writeStationKey('TILL1', { secret: SECRET, issued_at: null }, s);
    forgetStationKey('TILL1', s);
    expect(readStationKey('TILL1', s)).toBeNull();
  });
});

describe('deskKeyStatus', () => {
  const at = '2026-11-15T10:00:00.123456+00:00';
  it('none, lost, stale and current', () => {
    expect(deskKeyStatus(null, null)).toBe('none');
    expect(deskKeyStatus(null, { has_key: false, issued_at: null })).toBe('none');
    expect(deskKeyStatus(null, { has_key: true, issued_at: at })).toBe('lost');
    expect(deskKeyStatus({ secret: SECRET, issued_at: at }, { has_key: false, issued_at: null })).toBe('stale');
    expect(deskKeyStatus({ secret: SECRET, issued_at: at }, { has_key: true, issued_at: at })).toBe('current');
    expect(deskKeyStatus({ secret: SECRET, issued_at: at }, { has_key: true, issued_at: '2026-11-15T11:00:00+00:00' })).toBe('stale');
  });

  it('reads the same instant written two ways as current', () => {
    expect(deskKeyStatus({ secret: SECRET, issued_at: '2026-11-15T10:00:00Z' }, { has_key: true, issued_at: '2026-11-15T13:00:00+03:00' })).toBe('current');
  });

  it('trusts a key whose stamp could not be read back', () => {
    expect(deskKeyStatus({ secret: SECRET, issued_at: null }, { has_key: true, issued_at: at })).toBe('current');
  });
});
