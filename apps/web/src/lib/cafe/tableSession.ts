/**
 * The table binding's wire shape, shared by the browser hook
 * (`src/hooks/cafe/useTableSession.ts`) and the route handler that does the
 * binding on the server (`app/[locale]/menu/table/route.ts`).
 *
 * F-42 (2026-11-01): the table token never reaches page script. Until now the
 * menu page read the HttpOnly `tp-table` cookie and handed the token to the
 * client as a prop, so it sat in the RSC payload for the cookie's whole life,
 * readable by any script on the page. Now the page tells the client only THAT
 * a table cookie is present; the browser signs in anonymously as before and
 * then asks this route to open the session. The route reads the cookie on the
 * server, calls `app.open_table_session` as the guest (their `sb-*` session
 * cookie travels with the request) and answers with the session, never the
 * token. A refused token or a finished session clears the cookie there too.
 *
 * Pure module: no Next, no React, no Supabase import, so both sides and node
 * tests can use it.
 */

export type TableSessionState = 'none' | 'binding' | 'bound' | 'invalid' | 'expired' | 'error';

export interface TableSession {
  sessionId: string;
  tableId: string;
  tableNumber: string;
  expiresAt: string;
  /** false ⇒ management switched this table's bell off (0031): hide the FAB. */
  bellEnabled: boolean;
  /**
   * The table's branch, as `open_table_session` returns it (0225). The menu, the
   * café settings and the degraded check follow it. Null on a stack that does
   * not return it: the page keeps the branch it rendered.
   */
  venueId: string | null;
}

/** What the route answers. `none`: there is no table cookie (it aged out, or was cleared). */
export type BindResult =
  | { name: 'none' }
  | { name: 'invalid' }
  | { name: 'error' }
  | { name: 'bound'; session: TableSession };

/** The route, under the guest's locale so proxy.ts passes it through without a locale hop. */
export function tableSessionPath(locale: string): string {
  return `/${locale}/menu/table`;
}

/**
 * Sent with every call. A cross-site page cannot add a custom header without a
 * CORS preflight this route never answers, so a forged POST from elsewhere is
 * refused before the cookie is read (the cookies are SameSite=Lax as well).
 */
export const TABLE_SESSION_HEADER = 'x-tp-table';
export const TABLE_SESSION_HEADER_VALUE = '1';

/** `open_table_session`'s row, as the app needs it. Null when the shape is not one. */
export function parseOpenTableSession(data: unknown): TableSession | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const { session_id, table_id, table_number, expires_at } = row;
  if (typeof session_id !== 'string' || typeof table_id !== 'string') return null;
  if (typeof expires_at !== 'string') return null;
  return {
    sessionId: session_id,
    tableId: table_id,
    tableNumber: typeof table_number === 'string' ? table_number : String(table_number ?? ''),
    expiresAt: expires_at,
    // 0031 added the key; a pre-0031 stack (staging) simply keeps the bell.
    bellEnabled: row.bell_enabled !== false,
    // 0225 returns the table's branch; a pre-0225 stack keeps the rendered one.
    venueId: typeof row.venue_id === 'string' ? row.venue_id : null,
  };
}

/** The route's JSON body read defensively: anything unexpected is an `error`. */
export function parseBindResult(body: unknown): BindResult {
  if (!body || typeof body !== 'object') return { name: 'error' };
  const name = (body as { name?: unknown }).name;
  if (name === 'none' || name === 'invalid' || name === 'error') return { name };
  if (name === 'bound') {
    const s = (body as { session?: unknown }).session as Record<string, unknown> | undefined;
    if (
      s &&
      typeof s.sessionId === 'string' &&
      typeof s.tableId === 'string' &&
      typeof s.tableNumber === 'string' &&
      typeof s.expiresAt === 'string'
    ) {
      return {
        name: 'bound',
        session: {
          sessionId: s.sessionId,
          tableId: s.tableId,
          tableNumber: s.tableNumber,
          expiresAt: s.expiresAt,
          bellEnabled: s.bellEnabled !== false,
          venueId: typeof s.venueId === 'string' ? s.venueId : null,
        },
      };
    }
  }
  return { name: 'error' };
}
