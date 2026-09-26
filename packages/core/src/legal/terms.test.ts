import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_TERMS_VERSION, TERMS_VERSION_PATTERN, needsTermsAcceptance } from './terms';

describe('terms version', () => {
  it('the current version matches the format the database accepts', () => {
    expect(CURRENT_TERMS_VERSION).toMatch(TERMS_VERSION_PATTERN);
  });

  it('the pattern here is the one in migration 0153', () => {
    const dir = fileURLToPath(new URL('../../../db/supabase/migrations/', import.meta.url));
    const file = readdirSync(dir).find((f) => f.endsWith('_terms_consent.sql'));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file!), 'utf8');
    // Both the CHECK and the RPC spell it exactly as the TS source does.
    expect(sql.split(`'${TERMS_VERSION_PATTERN.source}'`).length - 1).toBe(2);
  });

  it('needsTermsAcceptance', () => {
    expect(needsTermsAcceptance(null)).toBe(false);
    expect(needsTermsAcceptance(undefined)).toBe(false);
    expect(needsTermsAcceptance({ terms_version: null })).toBe(true);
    expect(needsTermsAcceptance({ terms_version: '2000-01-01' })).toBe(true);
    expect(needsTermsAcceptance({ terms_version: CURRENT_TERMS_VERSION })).toBe(false);
  });
});
