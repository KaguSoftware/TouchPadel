/** Pure rules for the Telegram button-people panel. */

/** A row of `telegram_actions`, the ledger of every button tap. */
export interface TapRow {
  at: string;
  tg_user_id: number;
  tg_first_name: string | null;
  tg_username: string | null;
  result: string;
  detail: string | null;
}

export interface RefusedTapper {
  tgUserId: number;
  firstName: string | null;
  username: string | null;
  lastAt: string;
}

/**
 * People whose taps were refused because they are not on the allowlist, and
 * who still are not — newest first, once each. A refusal for another reason
 * (wrong group, voiding without permission) is not a request to be let in.
 */
export function refusedTappers(taps: readonly TapRow[], allowedIds: readonly number[]): RefusedTapper[] {
  const allowed = new Set(allowedIds.map(Number));
  const seen = new Map<number, RefusedTapper>();
  for (const t of [...taps].sort((a, b) => b.at.localeCompare(a.at))) {
    const id = Number(t.tg_user_id);
    if (t.result !== 'refused' || t.detail !== 'not_allowlisted' || allowed.has(id) || seen.has(id)) continue;
    seen.set(id, { tgUserId: id, firstName: t.tg_first_name, username: t.tg_username, lastAt: t.at });
  }
  return [...seen.values()];
}
