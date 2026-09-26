/**
 * Storage key for the device-local "clear history" cut.
 *
 * Split out of `history.ts` — which imports react-query and AsyncStorage, so it
 * cannot be loaded under the plain-node vitest setup — because TWO features now
 * depend on this exact string and they must not drift apart:
 *
 *   history.ts   writes and reads it
 *   the SEC-16 account deletion purge REMOVES it, and can only do so by name
 *
 * The key embeds the guest's auth uuid, so a purge that named it slightly
 * differently would leave a durable, per-account record on a device whose owner
 * has just been told everything was deleted — and would look like it worked.
 * One definition, imported by both, pinned by `deletion.test.ts`.
 */
export const historyClearedKey = (userId: string) => `tp.historyClearedAt.${userId}`;
