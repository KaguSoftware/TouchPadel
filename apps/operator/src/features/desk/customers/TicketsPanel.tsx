/**
 * A customer's open-match tickets on the record (docs/design/open-matches/
 * operator.md §5.15, §5.15.1): the wallet counts, the purchases with their
 * refund state, and the per-purchase cash-out (R13). Reads
 * app.guest_tickets (Money's, chain-wide: tickets work at every branch).
 *
 * Gated `runMatches` (court_desk, manager, owner, the roles guest_tickets
 * admits); Cash out is `cashOutTickets` (manager, owner). Whether a purchase
 * may be cashed out, how many tickets and how much all come from the server
 * (`cashout`, `ticket_cashout_block`): a waiting purchase shows the button
 * disabled with the sentence that says until when, and the same sentence
 * renders a TICKET_IN_USE refusal from its detail (ticketsLogic).
 *
 * A server without open matches (RPC_MISSING) shows nothing; a failed first
 * read says so with Retry (§5.5). Cash-out is online only (DF-11).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { countPhrase, formatDate, formatDateTime, formatIQD, formatNumber, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { QK, fetchVenueSettings } from '../../../lib/queries';
import { useStationReach } from '../../../lib/stationReach';
import { useToast } from '../../../components/toast';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Skeleton } from '../../../components/ui';
import { DescriptionList, Panel, StatusBadge, ViewMore, useListCap } from '../../../components/kit';
import { MatchReadNotice } from '../../matches/MatchReadNotice';
import { invalidateTicketCashOut, useGuestTickets, useMatchCaps, useMatchRead } from '../../matches/useMatches';
import type { GuestTickets, TicketPurchase } from '../../matches/matchPayloads';
import { cashoutRefusal, cashoutRefusalRefetches, cashoutStateOf, purchaseRefundState, walletRows, type KeyedLine } from './ticketsLogic';

export interface TicketsPanelProps {
  customerId: string;
}

const K = 'ws.matches.customers';

export function TicketsPanel({ customerId }: TicketsPanelProps) {
  const { tr } = useLocale();
  const caps = useMatchCaps();
  const q = useGuestTickets(customerId, caps.runMatches);
  const status = useMatchRead(q);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings, staleTime: 5 * 60_000 });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  if (!caps.runMatches || status.kind === 'absent') return null;

  return (
    <Panel title={tr(`${K}.tickets.title`)} data-testid="customer-tickets">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {status.kind === 'loading' && <Skeleton lines={3} blockSize="1.4rem" />}
        <MatchReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
        {status.kind === 'ready' && <Wallet customerId={customerId} data={status.data} tz={tz} canCashOut={caps.cashOutTickets} onStale={() => void q.refetch()} />}
      </div>
    </Panel>
  );
}

function Wallet({ customerId, data, tz, canCashOut, onStale }: { customerId: string; data: GuestTickets; tz: string; canCashOut: boolean; onStale: () => void }) {
  const { tr, locale } = useLocale();
  const count = (n: number | null) => (n == null ? '—' : formatNumber(n, locale));
  const cap = useListCap(data.purchases);
  return (
    <>
      <DescriptionList columns={3} items={walletRows(data).map((r) => ({ label: tr(r.key), value: count(r.count), numeric: true }))} />
      <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.tickets.everyBranch`)}</p>
      {data.pending && <StatusBadge tone="info" size="sm" label={tr(`${K}.tickets.pending`)} style={{ justifySelf: 'start' }} />}
      <section aria-label={tr(`${K}.tickets.purchases`)} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr(`${K}.tickets.purchases`)}</h3>
        {data.purchases.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.tickets.noPurchases`)}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {cap.shown.map((p) => (
              <PurchaseRow key={p.payment_id} customerId={customerId} purchase={p} tz={tz} canCashOut={canCashOut} onStale={onStale} />
            ))}
          </ul>
        )}
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} style={{ marginBlockStart: 0 }} />
      </section>
    </>
  );
}

function PurchaseRow({ customerId, purchase: p, tz, canCashOut, onStale }: { customerId: string; purchase: TicketPurchase; tz: string; canCashOut: boolean; onStale: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refund = purchaseRefundState(p);
  const cash = canCashOut ? cashoutStateOf(p.cashout) : ({ kind: 'none' } as const);
  const lineText = (line: KeyedLine) => (line.timeAt ? tr(line.key, { time: formatDateTime(new Date(line.timeAt), locale, tz) }) : tr(line.key));
  const tickets = (n: number | null) => (n == null ? '' : countPhrase('ws.matches.count.tickets', n, locale));
  // After the verbal nouns «استرداد» and «ردّ»: the genitive dual (تذكرتين).
  const ticketsGen = (n: number | null) => (n == null ? '' : countPhrase('ws.matches.count.ticketsGen', n, locale));
  const amount = (n: number | null) => (n == null ? '—' : formatIQD(n, locale));

  async function cashOut() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('ticket_cashout', { p_customer_id: customerId, p_purchase_payment_id: p.payment_id });
      setConfirming(false);
      toast.ok(tr(`${K}.cashout.requested`));
      invalidateTicketCashOut(qc, customerId);
    } catch (e) {
      setConfirming(false);
      setError(e);
      if (cashoutRefusalRefetches(e)) onStale();
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    p.bought_at ? formatDate(new Date(p.bought_at), locale, tz) : null,
    p.ticket_count != null ? tickets(p.ticket_count) : null,
    p.amount_iqd != null ? tr(`${K}.tickets.paid`, { amount: amount(p.amount_iqd) }) : null,
  ].filter(Boolean);

  const buttonLabel = cash.kind === 'none' ? '' : cash.tickets != null && cash.amount != null ? tr(`${K}.cashout.button`, { tickets: ticketsGen(cash.tickets), amount: amount(cash.amount) }) : tr(`${K}.cashout.confirm`);
  const waitLine = cash.kind === 'waiting' ? lineText(cash.line) : null;

  return (
    <li
      data-testid="ticket-purchase"
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <bdi style={{ flex: '1 1 14rem', minInlineSize: 0 }}>{facts.join(' · ')}</bdi>
        {p.sandbox && <StatusBadge tone="neutral" size="sm" dot={false} label={tr(`${K}.tickets.test`)} title={tr(`${K}.tickets.testHint`)} />}
        {cash.kind !== 'none' && (
          <Button
            size="sm"
            icon="undo"
            busy={busy}
            disabled={cash.kind === 'waiting' || !reachable}
            disabledReason={waitLine ?? tr('ws.matches.offline.needsConnection')}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {buttonLabel}
          </Button>
        )}
      </div>
      {refund && (
        <span style={{ color: refund.kind === 'failed' ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }}>
          {refund.kind === 'requested'
            ? tr(`${K}.tickets.refundRequested`)
            : refund.kind === 'failed'
              ? tr(`${K}.tickets.refundFailed`)
              : tr(`${K}.tickets.refunded`, { date: refund.at ? formatDate(new Date(refund.at), locale, tz) : '—' })}
        </span>
      )}
      {waitLine && <span style={{ color: 'var(--tp-muted-fg)' }}>{waitLine}</span>}
      <ErrorText error={confirming ? null : error} message={error ? lineText(cashoutRefusal(error)) : null} style={{ marginBlock: 0 }} />

      {cash.kind === 'allowed' && (
        <ConfirmDialog
          open={confirming}
          title={tr(`${K}.cashout.title`, { tickets: ticketsGen(cash.tickets), amount: amount(cash.amount) })}
          body={<p>{tr(`${K}.cashout.body`)}</p>}
          confirmLabel={tr(`${K}.cashout.confirm`)}
          busy={busy}
          onConfirm={() => void cashOut()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}
