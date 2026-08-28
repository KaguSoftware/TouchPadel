import { describe, it, expect } from 'vitest';
import {
  MUTATION_TYPES as SHELL_MUTATION_TYPES,
  clientRefRegex as shellClientRefRegex,
  idempotencyKeyRegex as shellIdempotencyKeyRegex,
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

function envelope(over: Record<string, unknown> = {}) {
  return {
    localId: `TILL-01-${ULID}`,
    idempotencyKey: `TILL-01:order.create:${ULID}`,
    mutationType: 'order.create',
    payload: { tabId: 'abc' },
    createdAt: '2026-08-28T09:00:00.000Z',
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
      ['createdAt', 'idempotencyKey', 'localId', 'mutationType', 'payload'].sort(),
    );
    expect((result as Record<string, unknown>).sneaky).toBeUndefined();
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
    // apps/operator/src/lib/idem.ts currently builds ids by hex-slicing
    // crypto.randomUUID(), which is NOT Crockford base32. Nothing calls enqueue
    // yet; this asserts the queue would refuse it rather than accept a key the
    // server will not recognise.
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

  it('refuses a localId from a different station than the key', () => {
    // Cross-station ids would attribute a write to the wrong till in the audit.
    expect(() => validateMutationEnvelope(envelope({ localId: `DESK-01-${ULID}` }))).toThrow(
      /disagree on the station/,
    );
  });

  it('accepts a station id containing hyphens', () => {
    // The station pattern allows them, and a naive split on '-' would break here.
    const e = envelope({
      localId: `KDS-BACK-01-${ULID2}`,
      idempotencyKey: `KDS-BACK-01:ticket.status:${ULID2}`,
      mutationType: 'ticket.status',
    });
    expect(validateMutationEnvelope(e).localId).toBe(`KDS-BACK-01-${ULID2}`);
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
