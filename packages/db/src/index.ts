/**
 * @touch/db — schema-first database package.
 *
 * The source of truth is `supabase/migrations/`. This module re-exports the
 * generated Database types (see src/types.gen.ts — regenerate with `pnpm db:types`).
 */
export type { Database, Json } from './types.gen';

/**
 * Idempotency key format (resolved override, wins over design docs):
 *   "{station}:{mutation_type}:{ulid}"   e.g. "TILL1:reservation.hold:01J5XABC..."
 * Client entity refs: "{station}-{ulid}" e.g. "TILL1-01J5XABC..."
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Z0-9_-]+:[a-z0-9_.]+:[0-9A-HJKMNP-TV-Z]{26}$/;
export const CLIENT_REF_PATTERN = /^[A-Z0-9_-]+-[0-9A-HJKMNP-TV-Z]{26}$/;

export function makeIdempotencyKey(station: string, mutationType: string, ulid: string): string {
  return `${station}:${mutationType}:${ulid}`;
}

export function makeClientRef(station: string, ulid: string): string {
  return `${station}-${ulid}`;
}
