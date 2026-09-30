/**
 * Day close's "Money outside the drawer" (docs/design/open-matches/
 * operator.md §5.18; app.day_close_online, money.md §7.2): the day's online
 * deposits at this branch, match tickets lost and cashed out here, the
 * chain's ticket sales, refunds and what is still owed to players, and the
 * day's open-match bookings (price, paid at the desk, written off, still owed,
 * called off, no-show seats).
 *
 * Information only: it never blocks the close and none of it enters the cash
 * count (seat money taken at the desk is already in the drawer's cash and
 * card, as ordinary payments). Hidden when every figure is zero, and on a
 * server without the read (RPC_MISSING). Every figure is the server's.
 */
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc, isRpcMissing } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { Money, Panel } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { onlineIsEmpty, onlineMoneyOf, readDayCloseOnline, type DayCloseOnline as OnlineData, type OnlineRow } from './dayCloseLogic';

export function DayCloseOnline({ daySessionId }: { daySessionId?: string | null }) {
  const { tr } = useLocale();
  const q = useQuery({
    queryKey: ['dayCloseOnline', daySessionId ?? 'open'] as const,
    queryFn: async (): Promise<OnlineData | null> => {
      try {
        return readDayCloseOnline(await appRpc('day_close_online', daySessionId ? { p_day_session_id: daySessionId } : {}));
      } catch (error) {
        // A server without open matches has no such read: nothing to show.
        if (isRpcMissing(error)) return null;
        throw error;
      }
    },
    refetchInterval: 60_000,
  });

  if (q.isError && !q.data) {
    return (
      <Panel title={<CardTitle icon="card">{tr('ws.matches.dayClose.title')}</CardTitle>}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      </Panel>
    );
  }
  const d = q.data;
  if (!d || onlineIsEmpty(d)) return null;

  return (
    <Panel title={<CardTitle icon="card">{tr('ws.matches.dayClose.title')}</CardTitle>} data-testid="day-close-online">
      <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.dayClose.lead')}</p>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {onlineMoneyOf(d).map((g) => (
          <section key={g.id} aria-label={tr(`ws.matches.dayClose.${g.id}.title`)} style={{ color: g.id === 'sandbox' ? 'var(--tp-muted-fg)' : undefined }}>
            <h3 style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr(`ws.matches.dayClose.${g.id}.title`)}</h3>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 'var(--tp-sp-1) var(--tp-sp-3)', margin: 0, fontSize: 'var(--tp-fs-sm)' }}>
              {g.rows.map((r) => (
                <OnlineFigure key={r.id} label={tr(`ws.matches.dayClose.${g.id}.${r.id}` as MessageKey)} row={r} />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Panel>
  );
}

/** Label, then the count (muted) and the money, each where the row has it. */
function OnlineFigure({ label, row }: { label: string; row: OnlineRow }) {
  const { locale } = useLocale();
  const count = row.count == null ? '—' : formatNumber(row.count, locale);
  return (
    <Fragment>
      <dt>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'end', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{row.shows === 'amount' ? '' : count}</dd>
      <dd style={{ margin: 0, textAlign: 'end' }}>{row.shows === 'count' ? '' : row.amount == null ? '—' : <Money amount={row.amount} />}</dd>
    </Fragment>
  );
}
