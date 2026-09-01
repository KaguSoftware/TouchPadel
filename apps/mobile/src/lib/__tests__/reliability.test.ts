import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, buildManifest, parseManifest, splitChunks } from '../chunk';
import { clearIdemKey, idemKeyFor, reservationIdemKey } from '../idempotency';
import { mapErrorToKey, rpcErrorCode } from '../../features/booking/errors';

const here = dirname(fileURLToPath(import.meta.url));

describe('entry order (the ulid CSPRNG crash)', () => {
  // ulid runs detectPrng() at module scope; under Hermes there is no
  // window.crypto and its `browser`-field crypto stub is a 0-byte file, so it
  // returns a closure that throws on the FIRST id — i.e. on every booking.
  // react-native-get-random-values must therefore evaluate first.
  it('imports react-native-get-random-values before the router entry', () => {
    const entry = readFileSync(join(here, '../../../index.js'), 'utf8');
    const imports = [...entry.matchAll(/^import\s+'([^']+)';/gm)].map((m) => m[1]);
    expect(imports[0]).toBe('react-native-get-random-values');
    expect(imports).toContain('expo-router/entry');
  });

  it('package.json main points at the shim, not expo-router/entry', () => {
    const pkg = JSON.parse(readFileSync(join(here, '../../../package.json'), 'utf8'));
    expect(pkg.main).toBe('index.js');
  });
});

describe('idempotency', () => {
  it('mints the documented {station}:{mutation_type}:{ulid} shape', () => {
    expect(reservationIdemKey()).toMatch(/^MOBILE:reservation\.create:[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns a STABLE key for the same intent — the whole point', () => {
    // A fresh key per attempt is why app.hold_slot's dedupe could never fire:
    // a call that committed server-side but lost its response retried under a
    // new key and created a SECOND hold.
    const intent = 'court-1|2026-09-01T10:00:00Z|60';
    const a = idemKeyFor(intent);
    const b = idemKeyFor(intent);
    expect(a).toBe(b);
  });

  it('gives different intents different keys, and forgets on demand', () => {
    expect(idemKeyFor('intent-a')).not.toBe(idemKeyFor('intent-b'));
    const first = idemKeyFor('intent-c');
    clearIdemKey('intent-c');
    expect(idemKeyFor('intent-c')).not.toBe(first);
  });
});

describe('SecureStore chunking', () => {
  it('round-trips a value larger than the platform limit', () => {
    const value = 'x'.repeat(CHUNK_SIZE * 3 + 17);
    const chunks = splitChunks(value);
    expect(chunks).toHaveLength(4);
    expect(chunks.join('')).toBe(value);
    expect(chunks.every((c) => c.length <= CHUNK_SIZE)).toBe(true);
  });

  it('reads back a manifest it wrote', () => {
    expect(parseManifest(buildManifest(4))).toBe(4);
  });

  it('does not mistake a real session payload for a manifest', () => {
    // The failure mode this guards: a JSON session whose first bytes happened to
    // look like a manifest would be read back as chunk pointers and lost.
    expect(parseManifest('{"access_token":"ey..."}')).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('__tpchunk__:0')).toBeNull();
    expect(parseManifest('__tpchunk__:nope')).toBeNull();
  });

  it('rejects a non-positive chunk size rather than looping forever', () => {
    expect(() => splitChunks('abc', 0)).toThrow(RangeError);
  });
});

describe('RPC error mapping', () => {
  it('maps the two assert_bookable codes that used to render "Something went wrong"', () => {
    expect(mapErrorToKey('CLOSED_DATE')).toBe('booking.closedDate');
    expect(mapErrorToKey('OUTSIDE_HOURS')).toBe('booking.outsideHours');
  });

  it('prefers an exact match and then the LONGEST embedded code', () => {
    // Matching used to iterate in object-literal order, so which code won when
    // one is a substring of another depended on how the keys were typed.
    expect(rpcErrorCode('SLOT_TAKEN')).toBe('SLOT_TAKEN');
    expect(rpcErrorCode('pg: raised SLOT_TAKEN while inserting')).toBe('SLOT_TAKEN');
  });

  it('still falls back sensibly', () => {
    expect(mapErrorToKey('Network request failed')).toBe('errors.network');
    expect(mapErrorToKey('something unrecognised')).toBe('errors.generic');
  });
});

describe('social sign-in library boundary', () => {
  // The Google SDK is young and isolated behind ONE adapter so the mature
  // library is a one-file swap; expo-apple-authentication lives only in the
  // iOS-suffixed files so Android never bundles it (owner decision D2).
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  const root = join(here, '../../..');
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'src'))];
  const importers = (needle: string) =>
    files
      .filter((f) => readFileSync(f, 'utf8').includes(needle))
      .map((f) => relative(root, f).split(sep).join('/'))
      .sort();

  it('imports react-native-nitro-google-signin from the adapter only', () => {
    expect(importers("'react-native-nitro-google-signin'")).toEqual([
      'src/features/auth/providers/google.ts',
    ]);
  });

  it('imports expo-apple-authentication from the iOS-only files only', () => {
    expect(importers("'expo-apple-authentication'")).toEqual([
      'src/components/AppleButton.ios.tsx',
      'src/features/auth/providers/apple.ios.ts',
    ]);
  });
});
