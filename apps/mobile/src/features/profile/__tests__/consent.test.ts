import { describe, expect, it, vi } from 'vitest';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import { acceptTerms, consentAction, fetchOwnConsent } from '../consent';

const V = CURRENT_TERMS_VERSION;

describe('consentAction', () => {
  it('does nothing until the consent row is known', () => {
    expect(consentAction(undefined, { terms_version: V })).toBe('none');
    expect(consentAction(null, {})).toBe('none');
  });

  it('does nothing when the current version is already recorded', () => {
    expect(consentAction({ terms_version: V, terms_accepted_at: 'x' }, {})).toBe('none');
  });

  it('records silently when the guest ticked this version at sign-up', () => {
    expect(consentAction({ terms_version: null, terms_accepted_at: null }, { terms_version: V })).toBe('record');
  });

  it('asks everyone else: social and desk accounts, old accounts, version bumps', () => {
    expect(consentAction({ terms_version: null, terms_accepted_at: null }, {})).toBe('ask');
    expect(consentAction({ terms_version: null, terms_accepted_at: null }, null)).toBe('ask');
    expect(consentAction({ terms_version: '2000-01-01', terms_accepted_at: 'x' }, { terms_version: '2000-01-01' })).toBe(
      'ask',
    );
  });
});

describe('consent api', () => {
  it('reads the caller’s own consent columns', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { terms_version: V, terms_accepted_at: 't' }, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const client = { from: vi.fn(() => ({ select })) };

    await expect(fetchOwnConsent(client as never, 'uid-1')).resolves.toEqual({
      terms_version: V,
      terms_accepted_at: 't',
    });
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith('terms_version, terms_accepted_at');
    expect(eq).toHaveBeenCalledWith('id', 'uid-1');
  });

  it('records acceptance through app.accept_terms with the current version', async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    const client = { schema: vi.fn(() => ({ rpc })) };

    await acceptTerms(client as never);
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(rpc).toHaveBeenCalledWith('accept_terms', { p_version: V });
  });

  it('throws the server error so the screen can say it failed', async () => {
    const client = { schema: () => ({ rpc: async () => ({ data: null, error: { message: 'VERSION_INVALID' } }) }) };
    await expect(acceptTerms(client as never)).rejects.toEqual({ message: 'VERSION_INVALID' });
  });
});
