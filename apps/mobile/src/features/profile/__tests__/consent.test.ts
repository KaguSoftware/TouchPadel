import { describe, expect, it, vi } from 'vitest';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import {
  READ_TO_END_SLACK,
  acceptTerms,
  readToEnd,
  consentAction,
  fetchOwnConsent,
  termsCheck,
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

describe('readToEnd', () => {
  it('is false before the text has been measured', () => {
    expect(readToEnd({ offsetY: 0, viewportHeight: 0, contentHeight: 0 })).toBe(false);
    expect(readToEnd({ offsetY: 0, viewportHeight: 400, contentHeight: 0 })).toBe(false);
  });

  it('is false at the top of text taller than the box', () => {
    expect(readToEnd({ offsetY: 0, viewportHeight: 400, contentHeight: 3000 })).toBe(false);
  });

  it('is true at the bottom, within the slack', () => {
    expect(readToEnd({ offsetY: 2600, viewportHeight: 400, contentHeight: 3000 })).toBe(true);
    expect(readToEnd({ offsetY: 2600 - READ_TO_END_SLACK, viewportHeight: 400, contentHeight: 3000 })).toBe(true);
    expect(readToEnd({ offsetY: 2600 - READ_TO_END_SLACK - 1, viewportHeight: 400, contentHeight: 3000 })).toBe(false);
  });

  it('is true when the text fits without scrolling', () => {
    expect(readToEnd({ offsetY: 0, viewportHeight: 400, contentHeight: 300 })).toBe(true);
  });
});

describe('termsCheck', () => {
  it('waits for the row before letting a booking through', () => {
    expect(termsCheck(undefined, { terms_version: V })).toBe('unknown');
  });

  it('lets an accepted account through, and one that ticked this version at sign-up', () => {
    expect(termsCheck({ terms_version: V, terms_accepted_at: 'x' }, {})).toBe('ok');
    expect(termsCheck({ terms_version: null, terms_accepted_at: null }, { terms_version: V })).toBe('ok');
  });

  it('asks an account that has not accepted this version', () => {
    expect(termsCheck({ terms_version: null, terms_accepted_at: null }, {})).toBe('ask');
    expect(termsCheck({ terms_version: '2020-01-01', terms_accepted_at: 'x' }, {})).toBe('ask');
  });
});
