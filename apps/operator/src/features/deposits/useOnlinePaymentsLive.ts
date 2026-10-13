/**
 * Whether online payments are open on this server (app.online_payments_live).
 *
 * The online payment provider is not connected yet, so online deposits, online
 * lesson payment and open matches are paused; the settings RPCs refuse to turn
 * them on (ONLINE_PAYMENTS_PAUSED). The desk hides every control for them
 * rather than show a switch that does nothing.
 *
 * Fails CLOSED: while the answer loads, when the call fails, and when the
 * server has no such RPC yet (RPC_MISSING, an older server) the answer is
 * `false`. Only an explicit `true` from the server opens the surfaces.
 */
import { useQuery } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';

export const ONLINE_PAYMENTS_LIVE_KEY = ['onlinePaymentsLive'] as const;

/** The server's answer, read strictly: anything but boolean `true` is false. */
export function readOnlinePaymentsLive(raw: unknown): boolean {
  return raw === true;
}

export function useOnlinePaymentsLive(): boolean {
  const q = useQuery({
    queryKey: ONLINE_PAYMENTS_LIVE_KEY,
    queryFn: async () => readOnlinePaymentsLive(await appRpc('online_payments_live')),
    staleTime: 5 * 60_000,
  });
  return q.data === true;
}
