import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as basis from './courtsBasis';
import * as contract from './insightsContract';

describe('insightsContract module contract', () => {
  it('has zero imports (shared by relative path with the Deno edge function)', () => {
    const src = readFileSync(fileURLToPath(new URL('./insightsContract.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\(/);
  });

  it('is the one home of the floors: courtsBasis re-exports the same values', () => {
    expect(contract.MIN_RATE_DENOM).toBe(20);
    expect(contract.MIN_CELL_OPEN_DAYS).toBe(4);
    expect(contract.MIN_IDENTITIES).toBe(15);
    expect(contract.MIN_ATTACH_BOOKINGS).toBe(10);
    expect(contract.MIN_PLAYERS_KNOWN_SHARE).toBe(0.5);
    expect(contract.MIN_ENDING_N).toBe(8);
    expect(contract.MIN_ITEM_UNITS).toBe(5);
    expect(contract.MIN_ITEM_VIEWS).toBe(5);
    for (const key of ['MIN_RATE_DENOM', 'MIN_CELL_OPEN_DAYS', 'MIN_IDENTITIES', 'MIN_ATTACH_BOOKINGS', 'MIN_PLAYERS_KNOWN_SHARE', 'MIN_ENDING_N'] as const) {
      expect(basis[key], key).toBe(contract[key]);
    }
  });
});
