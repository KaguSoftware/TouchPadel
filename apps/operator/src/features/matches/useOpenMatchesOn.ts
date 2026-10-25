/**
 * Whether open matches may run on this server (0370).
 *
 * They run when seats are paid at the desk (app.match_pay_at_desk: no ticket,
 * no Qi), or when online payments are live (tickets). The online-payments lock
 * itself is unchanged and still gates deposits and online lessons
 * (features/deposits/useOnlinePaymentsLive.ts).
 *
 * Fails CLOSED like that hook: while the answer loads, when the call fails and
 * when the server has no such RPC (an older server) it is `false`.
 */
import { useQuery } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useOnlinePaymentsLive } from '../deposits/useOnlinePaymentsLive';

export const MATCH_PAY_AT_DESK_KEY = ['matchPayAtDesk'] as const;

/** The server's answer, read strictly: anything but boolean `true` is false. */
export function readMatchPayAtDesk(raw: unknown): boolean {
  return raw === true;
}

export async function fetchMatchPayAtDesk(): Promise<boolean> {
  return readMatchPayAtDesk(await appRpc('match_pay_at_desk'));
}

export function useMatchPayAtDesk(enabled = true): boolean {
  const q = useQuery({ queryKey: MATCH_PAY_AT_DESK_KEY, queryFn: fetchMatchPayAtDesk, staleTime: 60_000, enabled });
  return q.data === true;
}

export function useOpenMatchesOn(): boolean {
  const onlineLive = useOnlinePaymentsLive();
  const payAtDesk = useMatchPayAtDesk();
  return onlineLive || payAtDesk;
}
