import { describe, expect, it, vi } from 'vitest';
import { isRetryableError } from '@touch/core';
import { fetchOwnProfile, ownUid } from '../api';

/**
 * auth-js's getUser() never throws: a request that failed comes back as
 * `{ user: null, error }`. Read as "no user", a dropped connection made the
 * profile query SUCCEED with no row, so nothing retried and Edit profile said
 * "Not set" on every row.
 */
type GetUser = () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;

const fetchFailed = Object.assign(new Error('Network request failed'), {
  name: 'AuthRetryableFetchError',
  status: 0,
});
const sessionMissing = Object.assign(new Error('Auth session missing!'), {
  name: 'AuthSessionMissingError',
  status: 400,
});

const authWith = (getUser: GetUser) => ({ auth: { getUser } }) as unknown as Parameters<typeof ownUid>[0];

describe('ownUid', () => {
  it('is the signed-in id', async () => {
    const client = authWith(async () => ({ data: { user: { id: 'u1' } }, error: null }));
    await expect(ownUid(client)).resolves.toBe('u1');
  });

  it('is null when there is no session', async () => {
    const client = authWith(async () => ({ data: { user: null }, error: sessionMissing }));
    await expect(ownUid(client)).resolves.toBeNull();
  });

  it('throws a failed request, which the query layer retries', async () => {
    const client = authWith(async () => ({ data: { user: null }, error: fetchFailed }));
    await expect(ownUid(client)).rejects.toBe(fetchFailed);
    expect(isRetryableError(fetchFailed)).toBe(true);
  });
});

describe('fetchOwnProfile', () => {
  it('fails, and never reads the table, when the session check failed', async () => {
    const from = vi.fn();
    const client = {
      auth: { getUser: async () => ({ data: { user: null }, error: fetchFailed }) },
      from,
    } as unknown as Parameters<typeof fetchOwnProfile>[0];
    await expect(fetchOwnProfile(client)).rejects.toBe(fetchFailed);
    expect(from).not.toHaveBeenCalled();
  });

  it('is null (no row to show) when nobody is signed in', async () => {
    const from = vi.fn();
    const client = {
      auth: { getUser: async () => ({ data: { user: null }, error: sessionMissing }) },
      from,
    } as unknown as Parameters<typeof fetchOwnProfile>[0];
    await expect(fetchOwnProfile(client)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
