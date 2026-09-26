/**
 * Types for fn-signatures.mjs, so tests/fn-signatures.test.ts imports it under
 * `strict` without `allowJs` (same arrangement as build-assistant-map.d.mts).
 */
export interface SignatureEvent {
  at: number;
  op: 'create' | 'drop';
  name: string;
  /** Normalised type list; null for `drop function app.x;` with no list. */
  sig: string | null;
}

export function stripSqlNoise(sql: string): string;
export function normalizeArgs(list: string): string;
export function signatureEvents(clean: string): SignatureEvent[];
export function replaySignatures(files: { file: string; sql: string }[]): {
  live: Map<string, Map<string, string>>;
  misses: { file: string; name: string; sig: string }[];
  /** Bare `drop function app.x;` while x had more than one live signature — Postgres rejects it. */
  errors: { file: string; name: string; sigs: string[] }[];
};
