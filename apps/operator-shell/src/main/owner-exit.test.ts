import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthState } from '../ipc-channels';
import { learnSession, lookupOwner, ownerMayLeave, resetOwnerExit, tokenSubject } from './owner-exit';

const OWNER = '11111111-1111-4111-8111-111111111111';
const MANAGER = '22222222-2222-4222-8222-222222222222';

function token(sub: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ sub })}.sig`;
}

function auth(staffId: string, sub = staffId): AuthState {
  return { accessToken: token(sub), staffId, supabaseUrl: 'https://db.example', anonKey: 'anon' };
}

/** A fetch that answers the staff lookup with `rows`, or fails like an offline station. */
function server(rows: { role: string; is_active: boolean }[] | 'offline' | number) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    if (rows === 'offline') throw new TypeError('fetch failed');
    if (typeof rows === 'number') return new Response('', { status: rows });
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('owner leaves a locked station without a PIN', () => {
  beforeEach(() => resetOwnerExit());

  it('reads the sub claim', () => {
    expect(tokenSubject(token(OWNER))).toBe(OWNER);
    expect(tokenSubject('not-a-jwt')).toBeNull();
  });

  it('lets an active owner out, and nobody else', async () => {
    expect(await lookupOwner(auth(OWNER), server([{ role: 'owner', is_active: true }]).impl)).toBe(true);
    expect(await lookupOwner(auth(MANAGER), server([{ role: 'manager', is_active: true }]).impl)).toBe(false);
    expect(await lookupOwner(auth(OWNER), server([{ role: 'owner', is_active: false }]).impl)).toBe(false);
    expect(await lookupOwner(auth(OWNER), server([]).impl)).toBe(false);
  });

  it("refuses a manager's token sent with the owner's id, without asking the server", async () => {
    const s = server([{ role: 'owner', is_active: true }]);
    expect(await lookupOwner(auth(OWNER, MANAGER), s.impl)).toBe(false);
    expect(s.calls).toHaveLength(0);
  });

  it('treats a refused token as an answer and an outage as no answer', async () => {
    expect(await lookupOwner(auth(OWNER), server(401).impl)).toBe(false);
    expect(await lookupOwner(auth(OWNER), server(503).impl)).toBeNull();
    expect(await lookupOwner(auth(OWNER), server('offline').impl)).toBeNull();
  });

  it('an owner confirmed at sign-in can still leave after going offline', async () => {
    await learnSession(auth(OWNER), server([{ role: 'owner', is_active: true }]).impl);
    expect(await ownerMayLeave(auth(OWNER), server('offline').impl)).toBe(true);
  });

  it('an owner never confirmed is asked for the PIN while offline', async () => {
    await learnSession(auth(OWNER), server('offline').impl);
    expect(await ownerMayLeave(auth(OWNER), server('offline').impl)).toBe(false);
  });

  it('a change of person forgets the owner at once', async () => {
    await learnSession(auth(OWNER), server([{ role: 'owner', is_active: true }]).impl);
    void learnSession(auth(MANAGER), server('offline').impl);
    expect(await ownerMayLeave(auth(MANAGER), server('offline').impl)).toBe(false);
    await learnSession(null);
    expect(await ownerMayLeave(null)).toBe(false);
  });

  it('a token refresh that the server refuses drops the owner', async () => {
    await learnSession(auth(OWNER), server([{ role: 'owner', is_active: true }]).impl);
    await learnSession(auth(OWNER), server(401).impl);
    expect(await ownerMayLeave(auth(OWNER), server('offline').impl)).toBe(false);
  });
});
