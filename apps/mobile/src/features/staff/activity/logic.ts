/**
 * The staff activity monitor (0341), the parts that are pure: when the phone
 * pings, how a "last seen" reads, and how an audit action code becomes words.
 *
 * PURE (vitest): no react-native, no expo, no supabase.
 */
import type { StaffRole } from '@touch/core';
import { catalogs, type MessageKey } from '@touch/i18n';

// ── the board's shape (app.staff_activity_board) ────────────────────────────

export type ActivityStatus = 'online' | 'away' | 'offline';
export type PingState = 'active' | 'background' | 'signed_out';

/** One person's use of one app. */
export interface ActivityPart {
  status: ActivityStatus;
  state: PingState;
  stateAt: string;
  lastSeenAt: string;
  screen: string | null;
  appVersion: string | null;
  deviceId: string | null;
  /** The audit action code, e.g. `discount.apply`. */
  lastAction: string | null;
  lastActionEntity: string | null;
  lastActionAt: string | null;
}

export interface ActivityRow {
  staffId: string;
  name: string;
  role: StaffRole;
  onBreak: boolean;
  /** null: this person has never used the operator (the desktop app). */
  operator: ActivityPart | null;
  /** null: this person has never used the staff phone. */
  mobile: ActivityPart | null;
}

export interface ActivityBoard {
  serverTime: string;
  rows: ActivityRow[];
}

/** What a part shows: the server's status, or `never` for an app never used. */
export type PartStatus = ActivityStatus | 'never';

export function partStatus(part: ActivityPart | null): PartStatus {
  return part ? part.status : 'never';
}

export type ActivityFilter = 'all' | 'online';

/** Name order as the server sent it; the filter only drops rows, it never reorders. */
export function filterRows(rows: readonly ActivityRow[], filter: ActivityFilter): ActivityRow[] {
  if (filter === 'all') return [...rows];
  return rows.filter((r) => r.operator?.status === 'online' || r.mobile?.status === 'online');
}

/** How many people are online on each app right now. */
export function onlineCounts(rows: readonly ActivityRow[]): { operator: number; mobile: number } {
  let operator = 0;
  let mobile = 0;
  for (const r of rows) {
    if (r.operator?.status === 'online') operator++;
    if (r.mobile?.status === 'online') mobile++;
  }
  return { operator, mobile };
}

// ── "3 min ago" ─────────────────────────────────────────────────────────────

export type Since =
  | { kind: 'now' }
  | { kind: 'minutes'; n: number }
  | { kind: 'hours'; n: number }
  | { kind: 'days'; n: number }
  | { kind: 'date'; at: Date };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, on the SERVER's clock: the board's `serverTime` plus
 * the time this phone has counted since it fetched the board. A phone whose
 * clock is wrong still reads "3 min ago" right. Older than a week reads as a
 * date. A time a little in the future (clock jitter) reads as now.
 */
export function sinceOf(
  at: string,
  serverTime: string,
  fetchedAtMs: number,
  nowMs: number,
): Since {
  const then = Date.parse(at);
  const serverNow = Date.parse(serverTime) + Math.max(0, nowMs - fetchedAtMs);
  if (Number.isNaN(then) || Number.isNaN(serverNow)) return { kind: 'now' };
  const ms = Math.max(0, serverNow - then);
  if (ms < MINUTE) return { kind: 'now' };
  if (ms < HOUR) return { kind: 'minutes', n: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { kind: 'hours', n: Math.floor(ms / HOUR) };
  if (ms < 7 * DAY) return { kind: 'days', n: Math.floor(ms / DAY) };
  return { kind: 'date', at: new Date(then) };
}

// ── action words ────────────────────────────────────────────────────────────

/** `order_item.void` → `orderItemVoid`: the desktop Audit log's catalog-key rule. */
export function codeToKey(code: string): string {
  return code.replace(/[._:-]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** `discount.apply` → `discount`. */
export function actionFamily(code: string): string {
  const dot = code.indexOf('.');
  return dot === -1 ? code : code.slice(0, dot);
}

/** Whether the assembled catalog has a string at this dotted key. */
export function hasMessage(key: string): boolean {
  let node: unknown = catalogs.en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

/**
 * An audit action code in words, through the desktop Audit log's own strings
 * (`ws.manager.audit.actions.*`): the action itself when it is known, else its
 * area's words and the code ("Discounts · discount.extra"), else the code.
 */
export function actionWords(
  code: string,
  t: (key: MessageKey) => string,
  has: (key: string) => boolean = hasMessage,
): string {
  const action = `ws.manager.audit.actions.${codeToKey(code)}`;
  if (has(action)) return t(action as MessageKey);
  const family = `ws.manager.audit.families.${codeToKey(actionFamily(code))}`;
  if (has(family)) return `${t(family as MessageKey)} · ${code}`;
  return code;
}

// ── the ping ────────────────────────────────────────────────────────────────

/** A foreground phone pings this often (the server's "online" window is 2 minutes). */
export const PING_INTERVAL_MS = 60_000;
/** The sign-out ping waits this long at most; sign-out never waits on it longer. */
export const SIGN_OUT_PING_TIMEOUT_MS = 1_500;
/** Room for a timer that fires a little early. */
const SLACK_MS = 1_000;

export interface SentPing {
  state: PingState;
  screen: string;
  at: number;
}

/**
 * Whether to send a ping now, given the last one sent. A change of state
 * always goes, as does a new screen while in the foreground; otherwise one a
 * minute. The server throttles again (one write per 20 s per row unless the
 * state or the screen changed), so a slip here costs a request, not a write.
 */
export function shouldPing(
  last: SentPing | null,
  next: { state: PingState; screen: string },
  nowMs: number,
): boolean {
  if (!last) return true;
  if (last.state !== next.state) return true;
  if (next.state === 'active' && last.screen !== next.screen) return true;
  return nowMs - last.at >= PING_INTERVAL_MS - SLACK_MS;
}

/** React Native's AppState as a ping state; null for the states that say nothing. */
export function appStateToPing(appState: string): PingState | null {
  if (appState === 'active') return 'active';
  if (appState === 'background' || appState === 'inactive') return 'background';
  return null;
}

/** The screen the owner reads: the route as the router has it, kept to what the database takes. */
export function pingScreen(pathname: string | null | undefined): string {
  const clean = (pathname ?? '').replace(/[^A-Za-z0-9/_().[\]-]/g, '').slice(0, 160);
  return clean === '' ? '/' : clean;
}
