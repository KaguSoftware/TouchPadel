/**
 * Per-conversation handle table (plan §11.1 "Handles, not UUIDs", contracts
 * "handles.ts"). Every uuid the model sees is replaced by a short handle such
 * as `r12`; the same uuid always gets the same handle within a conversation,
 * so a follow-up `booking_bill(id: "r12")` resolves back to the row.
 *
 * Pure: no imports, no Deno. The table round-trips through
 * `assistant_conversations.handles` as `{ "r1": "<uuid>", …, "_next": { "r": 2 } }`
 * (the edge function owns the format; the database stores it).
 *
 * Pseudonyms for redacted PII live in the same table under the letters
 * `phone` and `email` and print as `phone#1` / `email#2`, so a customer who
 * appears in two tool results is recognisably one person without either
 * vendor ever seeing the number.
 */

export interface HandleTable {
  /** handle → uuid (or the raw phone / email a pseudonym stands for). */
  map: Record<string, string>;
  /** uuid → handle. */
  reverse: Record<string, string>;
  /** next counter per letter. */
  next: Record<string, number>;
}

/** Handle letters (plan §11.1); `x` is anything else. */
export type HandleLetter = 'r' | 't' | 'p' | 'c' | 's' | 'k' | 'i' | 'x';

/** Pseudonym kinds; they print with a `#` so they can never be mistaken for a row handle. */
export type PseudonymKind = 'phone' | 'email';

const NEXT_KEY = '_next';

/** Build a table from the stored jsonb (null / malformed → empty table). */
export function newHandleTable(json: unknown): HandleTable {
  const table: HandleTable = { map: {}, reverse: {}, next: {} };
  if (!json || typeof json !== 'object' || Array.isArray(json)) return table;
  const obj = json as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === NEXT_KEY) continue;
    if (typeof v !== 'string') continue;
    table.map[k] = v;
    table.reverse[v] = k;
  }
  const next = obj[NEXT_KEY];
  if (next && typeof next === 'object' && !Array.isArray(next)) {
    for (const [letter, n] of Object.entries(next as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) table.next[letter] = n;
    }
  }
  // Repair a table whose counters lag its entries (a hand-edited row): never hand out a handle twice.
  for (const handle of Object.keys(table.map)) {
    const m = /^([a-z]+)#?(\d+)$/.exec(handle);
    if (!m) continue;
    const letter = m[1] as string;
    const n = Number(m[2]);
    if ((table.next[letter] ?? 1) <= n) table.next[letter] = n + 1;
  }
  return table;
}

/** The jsonb to store back: `{ r1: uuid, …, _next: { r: 2 } }`. */
export function toJson(table: HandleTable): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(table.map).sort()) out[k] = table.map[k];
  out[NEXT_KEY] = { ...table.next };
  return out;
}

/** The handle for a uuid, minting one when it is new. Deterministic within a table. */
export function handleFor(table: HandleTable, uuid: string, letter: HandleLetter): string {
  const existing = table.reverse[uuid];
  if (existing) return existing;
  const n = table.next[letter] ?? 1;
  const handle = `${letter}${n}`;
  table.next[letter] = n + 1;
  table.map[handle] = uuid;
  table.reverse[uuid] = handle;
  return handle;
}

/** A stable pseudonym (`phone#3`) for a normalised phone or lower-cased email. */
export function pseudonymFor(table: HandleTable, raw: string, kind: PseudonymKind): string {
  const key = `${kind}:${raw}`;
  const existing = table.reverse[key];
  if (existing) return existing;
  const n = table.next[kind] ?? 1;
  const handle = `${kind}#${n}`;
  table.next[kind] = n + 1;
  table.map[handle] = key;
  table.reverse[key] = handle;
  return handle;
}

export const HANDLE_TOKEN_RE = /^[a-z]{1,2}\d{1,6}$/;

/**
 * Resolve a handle the model typed back to its uuid. Anything that is not a
 * known handle (a uuid, free text) comes back unchanged, so callers can pass
 * every `id` argument through this without inspecting it first.
 */
export function resolveHandle(table: HandleTable, text: string): string {
  const t = text.trim();
  if (!HANDLE_TOKEN_RE.test(t)) return text;
  const uuid = table.map[t];
  return uuid ?? text;
}

/** True when `text` looks like a handle but the table does not know it. */
export function isUnknownHandle(table: HandleTable, text: string): boolean {
  const t = text.trim();
  return HANDLE_TOKEN_RE.test(t) && !(t in table.map);
}

/**
 * The letter for an id column (plan §11.1): r reservation/booking, t tab,
 * p payment, c customer/profile/guest, s staff, k court, i item, x anything else.
 */
export function letterForKey(key: string): HandleLetter {
  const k = key.toLowerCase();
  if (/reservation|booking|series/.test(k)) return 'r';
  if (/^tabs?(_|$)|_tab(_|$)|tabid|^tab_id$/.test(k)) return 't';
  if (/payment/.test(k)) return 'p';
  if (/customer|profile|guest|author/.test(k)) return 'c';
  if (/staff|actor|authorizer|recorded_?by|opened_?by|created_?by|decided_?by|covered_?by/.test(k)) return 's';
  if (/court/.test(k)) return 'k';
  if (/item|ingredient|menu|stock/.test(k)) return 'i';
  return 'x';
}
