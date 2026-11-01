import type { Instrumentation } from 'next';
import { reportError } from '@/lib/monitoring';

/**
 * Server errors on the site go to dev monitoring (F-43, 2026-11-01): a page or a route
 * handler that throws while Next renders it is reported as `web_error`, with where it
 * happened and Next's digest (the same id the error screen's report carries), so the
 * browser's report and the server's can be matched. The client side is the error screens
 * (app/[locale]/error.tsx, app/global-error.tsx).
 *
 * The address is reported without its query and with the table and match tokens masked:
 * `/t/{token}` and `/m/{token}` carry credentials, and `?ref=` a payment reference.
 * `reportError` never throws and is awaited, as Next asks.
 */
export function maskPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? '';
  return bare.replace(/\/(t|m)\/[^/]+/g, '/$1/[token]');
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const digest =
      typeof error === 'object' && error !== null && 'digest' in error
        ? String((error as { digest: unknown }).digest).slice(0, 64)
        : null;
    await reportError('web_error', error, {
      detail: {
        where: 'server',
        path: maskPath(request.path),
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
        digest,
      },
    });
  } catch {
    /* monitoring must never become the second failure */
  }
};
