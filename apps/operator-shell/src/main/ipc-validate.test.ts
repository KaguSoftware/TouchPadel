import { describe, it, expect } from 'vitest';
import {
  MUTATION_TYPES as SHELL_MUTATION_TYPES,
  clientRefRegex as shellClientRefRegex,
  idempotencyKeyRegex as shellIdempotencyKeyRegex,
  validateAuthState,
  validateConnState,
  validateMutationEnvelope,
  validatePin,
  validatePrintJob,
  validateRefKey,
  IpcValidationError,
  MAX_PAYLOAD_BYTES,
} from './ipc-validate';
import {
  MUTATION_TYPES,
  clientRefRegex,
  idempotencyKeyRegex,
} from '@touch/core/schemas/mutations';

// The five ipcMain.handle callbacks used to take their arguments on trust —
// TypeScript annotations are erased at runtime, so whatever the renderer sent
// went straight into the durable trading queue.

const ULID = '01J5XABCDEFGHJKMNPQRSTVWXY';
const ULID2 = '01J5XZZZZZZZZZZZZZZZZZZZZZ';
const STAFF = '5c9f1f1e-2b3a-4c4d-8e9f-0000000000aa';

function envelope(over: Record<string, unknown> = {}) {
  return {
    localId: `TILL-01-${ULID}`,
    idempotencyKey: `TILL-01:order.create:${ULID}`,
    mutationType: 'order.create',
    payload: { tabId: 'abc' },
    createdAt: '2026-08-28T09:00:00.000Z',
    staffId: STAFF,
    deviceId: 'TILL-01',
    ...over,
  };
}

describe('drift guard against @touch/core', () => {
  // These patterns are COPIED, not imported: the shell compiles to CommonJS and
  // requires its own emitted JS, while @touch/core is ESM-only and ships raw
  // TypeScript. The copy is deliberate; going stale would not be.
  it('mirrors the canonical idempotency-key pattern exactly', () => {
    expect(shellIdempotencyKeyRegex.source).toBe(idempotencyKeyRegex.source);
  });

  it('mirrors the canonical client-ref pattern exactly', () => {
    expect(shellClientRefRegex.source).toBe(clientRefRegex.source);
  });

  it('knows exactly the canonical mutation types', () => {
    expect([...SHELL_MUTATION_TYPES]).toEqual([...MUTATION_TYPES]);
  });
});

describe('validateMutationEnvelope', () => {
  it('accepts a well-formed envelope and returns only known fields', () => {
    const result = validateMutationEnvelope(envelope({ sneaky: 'extra' }));
    expect(Object.keys(result).sort()).toEqual(
      ['createdAt', 'deviceId', 'idempotencyKey', 'localId', 'mutationType', 'payload', 'staffId'].sort(),
    );
    expect((result as Record<string, unknown>).sneaky).toBeUndefined();
    expect(result.staffId).toBe(STAFF);
    expect(result.deviceId).toBe('TILL-01');
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['an array', []],
  ])('refuses %s', (_label, value) => {
    expect(() => validateMutationEnvelope(value)).toThrow(IpcValidationError);
  });

  it('refuses a malformed idempotency key', () => {
    // The replay function re-derives and cross-checks this exact shape, so a
    // bad key would otherwise sit in the queue undeliverable forever.
    expect(() => validateMutationEnvelope(envelope({ idempotencyKey: 'TILL-01/order/1' }))).toThrow(
      /idempotencyKey/,
    );
  });

  it('refuses a lowercase hex pseudo-ULID', () => {
    // apps/operator/src/lib/idem.ts used to build ids by hex-slicing
    // crypto.randomUUID(), which is NOT Crockford base32 (audit M9, fixed —
    // it now mints real ULIDs via @touch/core). This asserts the queue refuses
    // the old shape rather than accept a key the server will not recognise.
    const hex = 'a1b2c3d4e5f6a7b8c9d0e1f2a3';
    expect(() =>
      validateMutationEnvelope(
        envelope({ localId: `TILL-01-${hex}`, idempotencyKey: `TILL-01:order.create:${hex}` }),
      ),
    ).toThrow(IpcValidationError);
  });

  it('refuses an unknown mutation type', () => {
    expect(() =>
      validateMutationEnvelope(
        envelope({
          mutationType: 'order.destroy',
          idempotencyKey: `TILL-01:order.destroy:${ULID}`,
        }),
      ),
    ).toThrow(/idempotencyKey/);
  });

  it('refuses a key whose embedded type disagrees with mutationType', () => {
    expect(() =>
      validateMutationEnvelope({
        ...envelope(),
        mutationType: 'tab.settle',
      }),
    ).toThrow(/does not match mutationType/);
  });

  it('refuses a deviceId that disagrees with the key station', () => {
    // The queue owner mints the key; the replay function 400s on the same pair,
    // so a row that passed here with a mismatch would sit undeliverable forever.
    expect(() => validateMutationEnvelope(envelope({ deviceId: 'DESK-01' }))).toThrow(
      /disagree on the station/,
    );
  });

  it('accepts a localId from a different station than the key — the till enqueues on the KDS behalf', () => {
    // Single writer (design-arch §2.4): a KDS status frame is wrapped by the TILL,
    // key minted with the till's deviceId, localId keeping the KDS provenance.
    const e = envelope({
      localId: `KDS-01-${ULID2}`,
      idempotencyKey: `TILL-01:ticket.status:${ULID2}`,
      mutationType: 'ticket.status',
    });
    expect(validateMutationEnvelope(e).localId).toBe(`KDS-01-${ULID2}`);
  });

  it('accepts a station id containing hyphens', () => {
    // The station pattern allows them, and a naive split on '-' would break here.
    const e = envelope({
      localId: `KDS-BACK-01-${ULID2}`,
      idempotencyKey: `KDS-BACK-01:ticket.status:${ULID2}`,
      mutationType: 'ticket.status',
      deviceId: 'KDS-BACK-01',
    });
    expect(validateMutationEnvelope(e).localId).toBe(`KDS-BACK-01-${ULID2}`);
  });

  it('refuses a missing or malformed staffId — replay 400s without one', () => {
    const { staffId: _s, ...missing } = envelope();
    expect(() => validateMutationEnvelope(missing)).toThrow(/staffId/);
    expect(() => validateMutationEnvelope(envelope({ staffId: 'staff-1' }))).toThrow(/staffId/);
  });

  it('refuses a missing or malformed deviceId', () => {
    const { deviceId: _d, ...missing } = envelope();
    expect(() => validateMutationEnvelope(missing)).toThrow(/deviceId/);
    expect(() => validateMutationEnvelope(envelope({ deviceId: 'till 01' }))).toThrow(/deviceId/);
  });

  it('refuses a non-ISO createdAt', () => {
    expect(() => validateMutationEnvelope(envelope({ createdAt: 'yesterday' }))).toThrow(
      /createdAt/,
    );
  });

  it('normalises a missing payload to null rather than dropping the column', () => {
    expect(validateMutationEnvelope(envelope({ payload: undefined })).payload).toBeNull();
  });

  it('refuses a payload that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateMutationEnvelope(envelope({ payload: circular }))).toThrow(
      /JSON-serialisable/,
    );
  });

  it('refuses an oversized payload', () => {
    const big = { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) };
    expect(() => validateMutationEnvelope(envelope({ payload: big }))).toThrow(/too large/);
  });
});

describe('validateRefKey', () => {
  it('accepts the documented cache keys', () => {
    expect(validateRefKey('menu')).toBe('menu');
    expect(validateRefKey('open_tabs')).toBe('open_tabs');
  });

  it('refuses anything outside the closed set', () => {
    expect(() => validateRefKey('staff_pins_all')).toThrow(/unknown ref key/);
    expect(() => validateRefKey(42)).toThrow(IpcValidationError);
  });
});

describe('validatePrintJob', () => {
  it('accepts the three job kinds', () => {
    for (const kind of ['receipt', 'kitchen', 'reprint'] as const) {
      expect(validatePrintJob({ kind, data: {} }).kind).toBe(kind);
    }
  });

  it('refuses an unknown kind', () => {
    expect(() => validatePrintJob({ kind: 'label', data: {} })).toThrow(/unknown print kind/);
  });

  it('drops unknown fields', () => {
    const job = validatePrintJob({ kind: 'receipt', data: { total: 1 }, copies: 99 });
    expect(Object.keys(job).sort()).toEqual(['data', 'kind']);
  });
});

describe('validateAuthState', () => {
  const valid = () => ({
    accessToken: 'jwt-abc',
    staffId: STAFF,
    supabaseUrl: 'https://project.supabase.co',
    anonKey: 'anon-key',
  });

  it('accepts a full push and null (sign-out)', () => {
    expect(validateAuthState(valid())).toEqual(valid());
    expect(validateAuthState(null)).toBeNull();
  });

  it('strips a trailing slash from the url so path joins stay canonical', () => {
    expect(
      validateAuthState({ ...valid(), supabaseUrl: 'https://project.supabase.co/' })?.supabaseUrl,
    ).toBe('https://project.supabase.co');
  });

  it('refuses junk shapes', () => {
    expect(() => validateAuthState('token')).toThrow(IpcValidationError);
    expect(() => validateAuthState({ ...valid(), staffId: 'me' })).toThrow(/staffId/);
    expect(() => validateAuthState({ ...valid(), supabaseUrl: 'ftp://x' })).toThrow(/supabaseUrl/);
    expect(() => validateAuthState({ ...valid(), accessToken: '' })).toThrow(/accessToken/);
  });

  it('never echoes the token in an error message', () => {
    try {
      validateAuthState({ ...valid(), accessToken: 'secret-token', supabaseUrl: 'nope' });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-token');
    }
  });
});

describe('validateConnState', () => {
  it('accepts booleans only', () => {
    expect(validateConnState(true)).toBe(true);
    expect(validateConnState(false)).toBe(false);
    expect(() => validateConnState('up')).toThrow(IpcValidationError);
    expect(() => validateConnState(1)).toThrow(IpcValidationError);
  });
});

describe('validatePin', () => {
  it('accepts a 4-12 digit pin', () => {
    expect(validatePin('1234')).toBe('1234');
    expect(validatePin('123456789012')).toBe('123456789012');
  });

  it.each([['123'], ['1234567890123'], ['12a4'], [''], [' 1234 ']])(
    'refuses %j',
    (value) => {
      expect(() => validatePin(value)).toThrow(IpcValidationError);
    },
  );

  it('never echoes the pin in the error message', () => {
    // A PIN in a kiosk log is a PIN on the machine anyone can walk up to.
    try {
      validatePin('99a99');
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('99a99');
    }
  });
});

import {
  pairingCodeRegex as shellPairingCodeRegex,
  validateDiscoverRequest,
  validatePairingCode,
  validateStationSetup,
} from './ipc-validate';
import { pairingCodeRegex } from '@touch/core/pairing/pairingCode';

describe('validatePairingCode', () => {
  it('mirrors the canonical pattern exactly', () => {
    expect(shellPairingCodeRegex.source).toBe(pairingCodeRegex.source);
  });

  it('accepts a canonical code and refuses everything else', () => {
    expect(validatePairingCode('ABCDEFGHJK')).toBe('ABCDEFGHJK');
    for (const bad of ['abcdefghjk', 'ABCDE-FGHJK', 'ABCDEFGHJ', 'ABCDEFGHJU', 42, null, '']) {
      expect(() => validatePairingCode(bad)).toThrow(IpcValidationError);
    }
  });

  it('never echoes the code in the error message', () => {
    // The code is the LAN secret; a kiosk log is readable by anyone at the till.
    try {
      validatePairingCode('SECRETCOD3-nope');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETCOD3');
    }
  });
});

describe('validateStationSetup', () => {
  it('till and desk keep only id + mode', () => {
    expect(validateStationSetup({ stationId: 'TILL-01', mode: 'till', pairingCode: 'ABCDEFGHJK', x: 1 })).toEqual({
      stationId: 'TILL-01',
      mode: 'till',
    });
    expect(validateStationSetup({ stationId: 'DESK-01', mode: 'desk' })).toEqual({ stationId: 'DESK-01', mode: 'desk' });
  });

  it('a kitchen screen must bring a private till host and a code', () => {
    expect(
      validateStationSetup({ stationId: 'KDS-01', mode: 'kds', tillHost: '192.168.4.10', pairingCode: 'ABCDEFGHJK' }),
    ).toEqual({ stationId: 'KDS-01', mode: 'kds', tillHost: '192.168.4.10', pairingCode: 'ABCDEFGHJK' });
    expect(() => validateStationSetup({ stationId: 'KDS-01', mode: 'kds', pairingCode: 'ABCDEFGHJK' })).toThrow(
      IpcValidationError,
    );
    expect(() =>
      validateStationSetup({ stationId: 'KDS-01', mode: 'kds', tillHost: '8.8.8.8', pairingCode: 'ABCDEFGHJK' }),
    ).toThrow(/private/);
    expect(() =>
      validateStationSetup({ stationId: 'KDS-01', mode: 'kds', tillHost: '192.168.4.10', pairingCode: 'nope' }),
    ).toThrow(IpcValidationError);
  });

  it('refuses a bad station id or mode', () => {
    expect(() => validateStationSetup({ stationId: 'till 1', mode: 'till' })).toThrow(/TILL-01/);
    expect(() => validateStationSetup({ stationId: 'TILL-01', mode: 'oven' })).toThrow(/mode/);
    expect(() => validateStationSetup('TILL-01')).toThrow(IpcValidationError);
  });
});

describe('validateDiscoverRequest', () => {
  it('takes a code alone, or a code with one private host', () => {
    expect(validateDiscoverRequest({ code: 'ABCDEFGHJK' })).toEqual({ code: 'ABCDEFGHJK' });
    expect(validateDiscoverRequest({ code: 'ABCDEFGHJK', host: '' })).toEqual({ code: 'ABCDEFGHJK' });
    expect(validateDiscoverRequest({ code: 'ABCDEFGHJK', host: '10.0.0.9' })).toEqual({
      code: 'ABCDEFGHJK',
      host: '10.0.0.9',
    });
    expect(() => validateDiscoverRequest({ code: 'ABCDEFGHJK', host: '1.1.1.1' })).toThrow(/private/);
    expect(() => validateDiscoverRequest({ code: 'bad' })).toThrow(IpcValidationError);
  });
});
