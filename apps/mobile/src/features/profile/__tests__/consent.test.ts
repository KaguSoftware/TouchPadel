import { describe, expect, it, vi } from 'vitest';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import {
  GATE_PUSH_SETTLE_MS,
  acceptTerms,
  consentAction,
  fetchOwnConsent,
  shouldPushGate,
  stackHas,
} from '../consent';

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

    const row = await acceptTerms(client as never);
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(row.terms_version).toBe(V);
    expect(rpc).toHaveBeenCalledWith('accept_terms', { p_version: V });
  });

  it('throws the server error so the screen can say it failed', async () => {
    const client = { schema: () => ({ rpc: async () => ({ data: null, error: { message: 'VERSION_INVALID' } }) }) };
    await expect(acceptTerms(client as never)).rejects.toEqual({ message: 'VERSION_INVALID' });
  });
});

describe('shouldPushGate', () => {
  const ask = { action: 'ask' as const, onExemptScreen: false, inStack: false, pushedAt: null, now: 10_000 };

  it('pushes the consent screen for an account that has to be asked', () => {
    expect(shouldPushGate(ask)).toBe(true);
  });

  it('never pushes when there is nothing to ask', () => {
    expect(shouldPushGate({ ...ask, action: 'none' })).toBe(false);
    expect(shouldPushGate({ ...ask, action: 'record' })).toBe(false);
  });

  it('pushes once: not again while the screen is on the stack or on its way there', () => {
    expect(shouldPushGate({ ...ask, inStack: true })).toBe(false);
    expect(shouldPushGate({ ...ask, onExemptScreen: true })).toBe(false);
    expect(shouldPushGate({ ...ask, pushedAt: ask.now - 100 })).toBe(false);
  });

  it('pushes again when a push never reached the stack', () => {
    expect(shouldPushGate({ ...ask, pushedAt: ask.now - GATE_PUSH_SETTLE_MS - 1 })).toBe(true);
  });
});

describe('stackHas', () => {
  it('finds a route at any depth of the navigation state', () => {
    const state = { routes: [{ name: '__root', state: { routes: [{ name: '(tabs)' }, { name: 'accept-terms' }] } }] };
    expect(stackHas(state, 'accept-terms')).toBe(true);
    expect(stackHas(state, 'delete-account')).toBe(false);
    expect(stackHas(undefined, 'accept-terms')).toBe(false);
  });
});
