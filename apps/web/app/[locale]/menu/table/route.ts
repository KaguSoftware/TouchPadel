import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { isLocale } from '@/lib/locales';
import { appRpc, isRpcError } from '@/lib/appRpc';
import { createServerSupabase } from '@/lib/supabase/server';
import { TABLE_COOKIE, tableCookieOptions } from '@/lib/security/headers';
import {
  parseOpenTableSession,
  TABLE_SESSION_HEADER,
  TABLE_SESSION_HEADER_VALUE,
  type BindResult,
} from '@/lib/cafe/tableSession';
import { reportEvent } from '@/lib/monitoring';

/**
 * `/{locale}/menu/table`: the café's table binding, done on the server (F-42).
 *
 *   POST    read the HttpOnly `tp-table` cookie, open the table session as the
 *           guest (`app.open_table_session`, their anonymous `sb-*` session
 *           rides along in the request's cookies) and answer the session. The
 *           token stays on the server: it is never in the page payload, and
 *           never in this answer. A token the server refuses (rotated, forged,
 *           a branch closed to guests) clears the cookie, so the next visit to
 *           the menu is a walk-in's.
 *   DELETE  clear the cookie. The menu calls it when the session runs out, so a
 *           guest who comes back later is not bound to the old table again.
 *
 * A route handler, not a Server Action: Next re-renders the page after a
 * Server Action sets or deletes a cookie, which would drop the "scan again"
 * notice the guest needs to see. Every answer is `no-store` and `no-referrer`
 * (it is one guest's session), and a call without the `x-tp-table` header is
 * refused before the cookie is read.
 */
const NO_STORE = {
  'cache-control': 'no-store, no-cache, must-revalidate, private',
  'referrer-policy': 'no-referrer',
};

type Ctx = { params: Promise<{ locale: string }> };

function answer(body: BindResult, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function guard(req: NextRequest, ctx: Ctx): Promise<NextResponse | null> {
  const { locale } = await ctx.params;
  if (!isLocale(locale)) return new NextResponse(null, { status: 404, headers: NO_STORE });
  if (req.headers.get(TABLE_SESSION_HEADER) !== TABLE_SESSION_HEADER_VALUE) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  return null;
}

async function clearTableCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(TABLE_COOKIE, '', { ...tableCookieOptions(process.env.NODE_ENV !== 'production'), maxAge: 0 });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const refused = await guard(req, ctx);
  if (refused) return refused;

  const token = (await cookies()).get(TABLE_COOKIE)?.value ?? null;
  if (!token) return answer({ name: 'none' });

  try {
    const sb = await createServerSupabase();
    const { data, error } = await appRpc(sb, 'open_table_session', { p_token: token });
    if (error) {
      // 0225: a table at a branch that is not open to guests is TABLE_NOT_FOUND —
      // for the guest that is the same dead QR as a forged one: scan again.
      if (isRpcError(error, 'TOKEN_INVALID') || isRpcError(error, 'TABLE_NOT_FOUND')) {
        await clearTableCookie();
        return answer({ name: 'invalid' });
      }
      void reportEvent({
        level: 'warn',
        kind: 'web_error',
        message: 'Café table binding failed',
        detail: { where: 'menu/table', code: error.message?.slice(0, 80) ?? null },
      });
      return answer({ name: 'error' });
    }
    const session = parseOpenTableSession(data);
    return session ? answer({ name: 'bound', session }) : answer({ name: 'error' });
  } catch (e) {
    // No Supabase env on this deployment, or the server client failed: the menu
    // stays a walk-in's, with the chip's "try again".
    void reportEvent({
      level: 'error',
      kind: 'web_error',
      message: 'Café table binding threw',
      detail: { where: 'menu/table', error: e instanceof Error ? e.name : 'unknown' },
    });
    return answer({ name: 'error' });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const refused = await guard(req, ctx);
  if (refused) return refused;
  await clearTableCookie();
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
