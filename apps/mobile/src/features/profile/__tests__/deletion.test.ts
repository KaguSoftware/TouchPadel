/**
 * SEC-16 — the account-deletion sequence.
 *
 * These tests exist because the ORDER is the security property and the order is
 * invisible: every arrangement of these four steps produces a screen that looks
 * like it worked. What separates them is what happens when one step fails, and
 * that is a state a person testing by hand essentially never reaches.
 *
 * Mutation-checked while writing: moving `deleteServerSide` after the local
 * steps turns "leaves the device untouched when the server refuses" red;
 * dropping the try/catch around a local step turns three of the best-effort
 * tests red. Neither is vacuous.
 */
import { describe, expect, it, vi } from 'vitest';

import { confirmationMatches, runAccountDeletion, type DeletionEffects } from '../deletion';
import { authStorageKeyFor } from '../../../lib/authStorageKey';
import { chunkKeyNames, PURGE_SWEEP_LIMIT } from '../../../lib/chunk';
import { historyClearedKey } from '../../booking/historyKeys';
import { localKeysToPurge, secureKeysToPurge } from '../purgeKeys';

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';

function effects(over: Partial<DeletionEffects> = {}): DeletionEffects & {
  calls: string[];
} {
  const calls: string[] = [];
  const base: DeletionEffects = {
    deleteServerSide: async () => {
      calls.push('server');
      return { deleted: true, apple_revoke_pending: false };
    },
    unregisterPush: async () => {
      calls.push('push');
      return true;
    },
    purgeSecureKeys: async () => {
      calls.push('secure-store');
    },
    clearCaches: async () => {
      calls.push('caches');
    },
    secureKeys: ['sb-abcdefghijklmnop-auth-token'],
  };
  return { ...base, ...over, calls };
}

describe('runAccountDeletion — order', () => {
  it('destroys the account on the server BEFORE touching anything local', async () => {
    const fx = effects();
    await runAccountDeletion(fx);
    expect(fx.calls[0]).toBe('server');
    expect(fx.calls).toEqual(['server', 'push', 'secure-store', 'caches']);
  });

  it('leaves the device completely untouched when the server refuses', async () => {
    // The whole reason the server call is first. A deletion that failed on a
    // flaky connection must not have already ended this guest's notifications
    // and signed them out of an account they still own.
    const fx = effects({
      deleteServerSide: async () => {
        throw new Error('ALREADY_DELETED');
      },
    });
    await expect(runAccountDeletion(fx)).rejects.toThrow('ALREADY_DELETED');
    expect(fx.calls).toEqual([]);
  });
});

describe('runAccountDeletion — the local steps are best-effort', () => {
  it('finishes the remaining steps when the push unregister throws', async () => {
    const fx = effects({
      unregisterPush: async () => {
        throw new Error('no native module');
      },
    });
    const out = await runAccountDeletion(fx);
    expect(out.deleted).toBe(true);
    expect(out.failures).toEqual(['push']);
    expect(fx.calls).toContain('secure-store');
    expect(fx.calls).toContain('caches');
  });

  it('treats a DECLINED push unregister as a failure, not a success', async () => {
    // Expo Go / simulator / web all return false rather than throwing. That is
    // still a token we did not surrender, and it belongs in the tracker.
    const fx = effects({ unregisterPush: async () => false });
    const out = await runAccountDeletion(fx);
    expect(out.failures).toEqual(['push']);
  });

  it('still clears the caches when the keychain purge throws', async () => {
    // The one that matters most: a keychain that refuses a delete must not
    // leave the previous guest's cached bookings on disk for the next person.
    const fx = effects({
      purgeSecureKeys: async () => {
        throw new Error('errSecNotAvailable');
      },
    });
    const out = await runAccountDeletion(fx);
    expect(out.failures).toEqual(['secure-store']);
    expect(fx.calls).toContain('caches');
  });

  it('never reports the account as surviving because local cleanup failed', async () => {
    const fx = effects({
      unregisterPush: async () => {
        throw new Error('x');
      },
      purgeSecureKeys: async () => {
        throw new Error('y');
      },
      clearCaches: async () => {
        throw new Error('z');
      },
    });
    const out = await runAccountDeletion(fx);
    expect(out.deleted).toBe(true);
    expect(out.failures).toEqual(['push', 'secure-store', 'caches']);
  });

  it('carries the Apple revocation debt back to the caller', async () => {
    const fx = effects({
      deleteServerSide: async () => ({ deleted: true, apple_revoke_pending: true }),
    });
    expect((await runAccountDeletion(fx)).appleRevokePending).toBe(true);
  });
});

describe('confirmationMatches', () => {
  it('accepts the word as typed, and forgives case and stray spaces', () => {
    expect(confirmationMatches('DELETE', 'DELETE')).toBe(true);
    expect(confirmationMatches('delete', 'DELETE')).toBe(true);
    expect(confirmationMatches('  Delete ', 'DELETE')).toBe(true);
  });

  it('refuses anything else, including the empty field', () => {
    expect(confirmationMatches('', 'DELETE')).toBe(false);
    expect(confirmationMatches('DELET', 'DELETE')).toBe(false);
    expect(confirmationMatches('DELETE ACCOUNT', 'DELETE')).toBe(false);
  });

  it('works for the Arabic word, which is the default locale', () => {
    expect(confirmationMatches('حذف', 'حذف')).toBe(true);
    expect(confirmationMatches(' حذف ', 'حذف')).toBe(true);
    expect(confirmationMatches('حذ', 'حذف')).toBe(false);
  });

  it('can never be satisfied by an empty EXPECTED word', () => {
    // A missing catalog entry would otherwise arm the button on an empty field.
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches('anything', '   ')).toBe(false);
  });
});

describe('what the purge sweeps', () => {
  it('derives supabase-js own default storage key', () => {
    // Pinned against supabase-js's expression, verified in dist/index.cjs:
    //   `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
    // If a future version changes it, this test is the only thing that notices:
    // the purge itself would sweep an unused key and report success.
    expect(authStorageKeyFor(SUPABASE_URL)).toBe('sb-abcdefghijklmnop-auth-token');
    expect(authStorageKeyFor('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
  });

  it('does not throw on a missing or malformed project URL', () => {
    expect(authStorageKeyFor(undefined)).toBeNull();
    expect(authStorageKeyFor('')).toBeNull();
    expect(authStorageKeyFor('not a url')).toBeNull();
    expect(secureKeysToPurge(undefined)).toEqual([]);
  });

  it('sweeps the session key', () => {
    expect(secureKeysToPurge(SUPABASE_URL)).toEqual(['sb-abcdefghijklmnop-auth-token']);
  });

  it('sweeps the user-scoped AsyncStorage key, whose NAME contains the uuid', () => {
    const uid = '11111111-2222-3333-4444-555555555555';
    expect(localKeysToPurge(uid)).toEqual([`tp.historyClearedAt.${uid}`]);
    expect(localKeysToPurge(uid)[0]).toContain(uid);
    // No session, nothing to name — and definitely not `tp.historyClearedAt.`.
    expect(localKeysToPurge(null)).toEqual([]);
    expect(localKeysToPurge('')).toEqual([]);
  });

  it('agrees with the adapter about where a chunk lives', () => {
    // The purge and the writer must name slices identically or the sweep is
    // theatre. Both go through chunkKeyNames; this pins the format itself.
    expect(chunkKeyNames('k', 3)).toEqual(['k.0', 'k.1', 'k.2']);
    expect(chunkKeyNames('k', 0)).toEqual([]);
    expect(() => chunkKeyNames('k', -1)).toThrow(RangeError);
  });

  it('sweeps far enough past a real session to catch orphaned slices', () => {
    // A Supabase session is ~4 KB => 3 chunks at CHUNK_SIZE 1800. The sweep has
    // to cover orphans from a LARGER earlier write, so the bound is what makes
    // the blind sweep meaningful rather than decorative.
    expect(PURGE_SWEEP_LIMIT).toBeGreaterThanOrEqual(32);
    expect(chunkKeyNames('k', PURGE_SWEEP_LIMIT)).toHaveLength(PURGE_SWEEP_LIMIT);
  });

  it('names the history key from the same helper the writer uses', () => {
    // Guards against the purge hardcoding a prefix that history.ts later moves.
    const uid = 'abc';
    expect(localKeysToPurge(uid)).toEqual([historyClearedKey(uid)]);
  });
});

describe('the deletion screen is actually reachable', () => {
  // SEC-16's failure mode for eight days was not a broken screen — it was a
  // correct RPC that nothing called. These read the tree so "shipped" cannot
  // again mean "written".
  it('routes the profile menu at the delete screen', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const profile = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'app', '(tabs)', 'profile.tsx'),
      'utf8',
    );
    expect(profile).toContain("router.push('/delete-account')");
  });

  it('has the screen call deleteAccount, not merely import it', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const screen = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'app', 'delete-account.tsx'),
      'utf8',
    );
    // An unused import is exactly what let the web security headers ship as
    // nothing for the life of the repo (macbook-docker-checks.md §4).
    expect(screen).toMatch(/deleteServerSide:\s*\(\)\s*=>\s*deleteAccount\(supabase\)/);
    expect(screen).toContain('runAccountDeletion');
  });
});

describe('deleteAccount sends the confirmation token', () => {
  it('calls the RPC with p_confirm and then clears the local session only', async () => {
    const { deleteAccount } = await import('../api');
    const rpc = vi.fn().mockResolvedValue({
      data: { deleted: true, apple_revoke_pending: false },
      error: null,
    });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      schema: () => ({ rpc }),
      auth: { signOut },
    } as never;

    await deleteAccount(client);

    expect(rpc).toHaveBeenCalledWith('delete_my_account', { p_confirm: 'DELETE' });
    // 'local': the server-side session died with the auth user, so a default
    // signOut would POST to /logout with a token GoTrue no longer knows.
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
