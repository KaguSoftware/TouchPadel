/**
 * The activity monitor's pure half (/observation/activity, 0341). The board
 * (app.staff_activity_board) gives every person two parts, the operator and
 * the mobile app, each with a status the SERVER decided. What is computed here
 * is only how long ago, against the server's clock, and which rows a filter
 * keeps. Nothing here ranks or scores anyone: rows stay in the server's name
 * order (PRODUCT.md: no dashboard grades staff).
 */
import type { StaffRole } from '../../../lib/auth';
import { WORKSPACES, activeNavItem, workspaceItems, type NavItem } from '../../../lib/workspaces';

export type PartStatus = 'online' | 'away' | 'offline';
export type PartState = 'active' | 'background' | 'signed_out';

export interface ActivityPart {
  status: PartStatus;
  state: PartState;
  stateAt: string;
  lastSeenAt: string;
  screen: string | null;
  appVersion: string | null;
  deviceId: string | null;
  lastAction: string | null;
  lastActionEntity: string | null;
  lastActionAt: string | null;
}

export interface ActivityRow {
  staffId: string;
  name: string;
  role: StaffRole | string;
  onBreak: boolean;
  /** null: never used the operator. */
  operator: ActivityPart | null;
  /** null: never used the phone app. */
  mobile: ActivityPart | null;
}

export interface ActivityBoard {
  serverTime: string;
  rows: ActivityRow[];
}

/** What the monitor says of one part: the server's status, or that it was never used. */
export type PartWord = PartStatus | 'signedOut' | 'never';

export function partWord(part: ActivityPart | null): PartWord {
  if (!part) return 'never';
  if (part.status === 'offline' && part.state === 'signed_out') return 'signedOut';
  return part.status;
}

export type ActivityFilter = 'all' | 'online' | 'notToday';

/**
 * "Now" on the server's clock: the board's serverTime plus the time this PC
 * has counted since the board arrived. A till whose clock is ten minutes off
 * would otherwise call everybody "10 min ago" or "in the future".
 */
export function serverNow(serverTime: string, fetchedAt: number, pcNow: number): number {
  const server = Date.parse(serverTime);
  if (!Number.isFinite(server)) return pcNow;
  return server + Math.max(0, pcNow - fetchedAt);
}

export type Ago =
  | { unit: 'justNow' }
  | { unit: 'minutes' | 'hours' | 'days'; count: number };

/** How long ago `at` was, at `now` (server clock). A time ahead of now is "just now". */
export function agoOf(at: string, now: number): Ago {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return { unit: 'justNow' };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

function dayIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Seen today (venue calendar day) on either app. */
export function seenToday(row: ActivityRow, now: number, timeZone: string): boolean {
  const today = dayIn(now, timeZone);
  return [row.operator, row.mobile].some((p) => {
    if (!p) return false;
    const at = Date.parse(p.lastSeenAt);
    return Number.isFinite(at) && dayIn(at, timeZone) === today;
  });
}

export function isOnline(row: ActivityRow): boolean {
  return row.operator?.status === 'online' || row.mobile?.status === 'online';
}

/** The rows a filter keeps, in the order the server sent them. */
export function filterRows(rows: readonly ActivityRow[], filter: ActivityFilter, now: number, timeZone: string): ActivityRow[] {
  if (filter === 'online') return rows.filter(isOnline);
  if (filter === 'notToday') return rows.filter((r) => !seenToday(r, now, timeZone));
  return [...rows];
}

/** The summary line's two numbers: people online right now on each app. */
export function onlineCounts(rows: readonly ActivityRow[]): { operator: number; mobile: number } {
  let operator = 0;
  let mobile = 0;
  for (const r of rows) {
    if (r.operator?.status === 'online') operator += 1;
    if (r.mobile?.status === 'online') mobile += 1;
  }
  return { operator, mobile };
}

let allItems: readonly NavItem[] | null = null;

/**
 * The rail row an operator screen belongs to ('/till/tabs' is "Open tabs"),
 * across every workspace, so the owner reads a screen's name and not its path.
 * null when no rail row covers it; the path is shown then.
 */
export function operatorScreenLabelKey(screen: string | null): NavItem['labelKey'] | null {
  if (!screen) return null;
  allItems ??= Object.values(WORKSPACES).flatMap((ws) => workspaceItems(ws));
  return activeNavItem(allItems, screen)?.labelKey ?? null;
}
