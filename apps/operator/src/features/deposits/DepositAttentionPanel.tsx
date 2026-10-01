/**
 * "Online refunds needing attention" (build-contracts-2026-09-27 §6): the
 * human path so no online deposit can be stuck forever. Reads
 * app.deposit_attention for the branch the rail shows.
 *
 * Mounted twice with one body: on the owner's Financial home (with its empty
 * state, once deposits are on) and on the manager's Today (only when a row
 * waits), because /financial is the owner's alone and the manager is the one
 * on the floor when a guest asks where their money is. Both roles pass the
 * RPC guards (manager, owner).
 *
 * Each row says who, which booking, how much, what went wrong in plain words
 * and since when, and offers only the action the server will take for it
 * (depositAttentionLogic.attentionActions). A refusal stays on its row.
 *
 * Open matches (operator.md §5.17): "Settled another way" only on a failed
 * refund (R23), so a slow one says it is waiting on Qi and offers nothing; a
 * ticket purchase's refund (cash-out or account deletion) reads "Ticket
 * refund · {tickets} · {name}", carries "Any branch can settle this" (chain
 * money) and opens the customer rather than a booking.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { countPhrase, formatDateTime, formatIQD, formatNumber, isolate, VENUE_TZ, type MessageKey } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { currentBranchId } from '../../lib/venueScope';
import { useToast } from '../../components/toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, Money, Panel, StatusBadge, type Tone } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import {
  depositAttentionKey,
  depositSettingsKey,
  fetchDepositAttention,
  fetchDepositSettings,
  requestDepositRefund,
  retryDepositRefund,
  settleDepositManually,
  type DepositAttentionRow,
} from './depositApi';
import {
  attentionActions,
  attentionAmount,
  attentionHintKey,
  attentionKindOf,
  attentionSince,
  isTicketRow,
  knownRefundReason,
  refundReasonKey,
  showAttentionPanel,
  sortAttention,
  type AttentionKind,
} from './depositAttentionLogic';

const K = 'ws.manager.onlineRefunds';

const KIND_TONE: Record<AttentionKind, Tone> = { refundFailed: 'danger', refundSlow: 'warn', paidNotLive: 'warn' };

export function DepositAttentionPanel({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { tr } = useLocale();
  const branch = currentBranchId();
  const attentionQ = useQuery({
    queryKey: depositAttentionKey(branch),
    queryFn: () => fetchDepositAttention(branch),
    refetchInterval: 60_000,
    retry: false,
  });
  // Only the home asks whether deposits are on, to decide whether an empty list is news.
  const settingsQ = useQuery({
    queryKey: depositSettingsKey(branch),
    queryFn: () => fetchDepositSettings(branch),
    enabled: !hideWhenEmpty,
    staleTime: 60_000,
    retry: false,
  });

  const rows = attentionQ.data ? sortAttention(attentionQ.data) : null;
  const mode = settingsQ.data?.deposit_mode ?? null;
  if (!showAttentionPanel({ rows: rows ? rows.length : null, mode, hideWhenEmpty })) return null;

  return (
    <Panel title={<CardTitle icon="card">{tr(`${K}.title`)}</CardTitle>} data-testid="deposit-attention">
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)', maxInlineSize: '70ch' }}>{tr(`${K}.lead`)}</p>
      <AsyncStateWrapper
        status={attentionQ.isError && !attentionQ.data ? 'error' : !rows ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
        error={attentionQ.error}
        onRetry={() => void attentionQ.refetch()}
        compact
        skeleton={<Skeleton lines={3} blockSize="1.4rem" />}
        emptyContent={<EmptyState compact icon="checkCircle" kind="nothingToDo" title={tr(`${K}.empty`)} titleAs="h3" />}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {(rows ?? []).map((r) => (
            <AttentionRow key={r.id} row={r} />
          ))}
        </ul>
      </AsyncStateWrapper>
    </Panel>
  );
}

function AttentionRow({ row }: { row: DepositAttentionRow }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings, staleTime: 5 * 60_000 });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  const [busy, setBusy] = useState<'retry' | 'refund' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [settling, setSettling] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);

  const kind = attentionKindOf(row);
  const actions = attentionActions(row);
  const amount = attentionAmount(row);
  const since = attentionSince(row);
  const reason = knownRefundReason(row.refund_reason);
  const guest = row.guest_name?.trim() || tr(`${K}.noName`);
  const court = row.court_name_en && row.court_name_ar ? pickName(locale, { name_en: row.court_name_en, name_ar: row.court_name_ar }) : null;
  const ticket = isTicketRow(row);
  const title = ticket
    ? tr('ws.matches.ops.ticketRow', {
        tickets: row.ticket_count != null ? countPhrase('ws.matches.count.tickets', row.ticket_count, locale) : '—',
        name: isolate(guest),
      })
    : guest;

  function refreshed() {
    void qc.invalidateQueries({ queryKey: ['depositAttention'] });
    void qc.invalidateQueries({ queryKey: ['bookingBill'] });
  }

  async function run(which: 'retry' | 'refund') {
    setBusy(which);
    setError(null);
    try {
      if (which === 'retry') await retryDepositRefund(row.id);
      else await requestDepositRefund(row.id);
      setConfirmRefund(false);
      toast.ok(tr(which === 'retry' ? `${K}.retried` : `${K}.refundAsked`));
      refreshed();
    } catch (e) {
      setError(e);
      setConfirmRefund(false);
      // PAYMENT_STATE: someone (or Qi) moved it first; show where it is now.
      refreshed();
    } finally {
      setBusy(null);
    }
  }

  const facts: ReactNode[] = [];
  if (reason) facts.push(tr(`${K}.why`, { reason: tr(refundReasonKey(reason)) }));
  if (since) facts.push(tr(kind === 'paidNotLive' ? `${K}.paidAt` : `${K}.askedAt`, { time: formatDateTime(new Date(since), locale, tz) }));
  if ((row.refund_attempts ?? 0) > 1) facts.push(tr(`${K}.attempts`, { count: formatNumber(row.refund_attempts ?? 0, locale) }));

  return (
    <li
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-3)',
        borderBlockEnd: '1px solid var(--tp-border)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 18rem', minInlineSize: 0 }}>
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>
              <bdi>{title}</bdi>
            </strong>
            {row.guest_phone && (
              <bdi dir="ltr" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                {row.guest_phone}
              </bdi>
            )}
            {row.sandbox && <StatusBadge tone="neutral" size="sm" dot={false} label={tr(`${K}.test`)} title={tr(`${K}.testHint`)} />}
            {ticket && <StatusBadge tone="info" size="sm" dot={false} label={tr('ws.matches.ops.anyBranch')} />}
          </span>
          {(court || row.start_at) && (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{[court, row.start_at ? formatDateTime(new Date(row.start_at), locale, tz) : null].filter(Boolean).join(' · ')}</bdi>
            </span>
          )}
        </div>
        <Money amount={amount} strong />
      </div>

      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge tone={KIND_TONE[kind]} size="sm" label={tr(`${K}.kind.${kind}.label` as MessageKey)} />
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', flex: '1 1 16rem' }}>{tr(attentionHintKey(kind))}</span>
      </div>
      {facts.length > 0 && <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', margin: 0 }}>{facts.join(' · ')}</p>}

      <ErrorText error={settling || confirmRefund ? null : error} style={{ marginBlock: 0 }} />

      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        {actions.retry && (
          <Button size="sm" icon="refresh" busy={busy === 'retry'} disabled={busy !== null} onClick={() => void run('retry')}>
            {tr(`${K}.retry`)}
          </Button>
        )}
        {actions.refund && (
          <Button size="sm" icon="undo" disabled={busy !== null} onClick={() => { setError(null); setConfirmRefund(true); }}>
            {tr(`${K}.refund`)}
          </Button>
        )}
        {actions.settle && (
          <Button size="sm" kind="ghost" icon="lock" disabled={busy !== null} onClick={() => { setError(null); setSettling(true); }}>
            {tr(`${K}.settle`)}
          </Button>
        )}
        {ticket && row.customer_id && <OpenCustomer customerId={row.customer_id} />}
      </div>

      <ConfirmDialog
        open={confirmRefund}
        kind="danger"
        title={tr(`${K}.refundTitle`, { amount: formatIQD(amount, locale), name: guest })}
        body={
          <>
            <p>{tr(`${K}.refundBody`)}</p>
            <ErrorText error={error} />
          </>
        }
        confirmLabel={tr(`${K}.refundConfirm`)}
        busy={busy === 'refund'}
        onConfirm={() => void run('refund')}
        onCancel={() => setConfirmRefund(false)}
      />

      {settling && (
        <SettleDialog
          row={row}
          guest={guest}
          amount={amount}
          onClose={() => setSettling(false)}
          onDone={() => {
            setSettling(false);
            toast.ok(tr(`${K}.settled`));
            refreshed();
          }}
        />
      )}
    </li>
  );
}

/** A ticket refund has no booking to open: the customer's record holds their tickets and purchases. */
function OpenCustomer({ customerId }: { customerId: string }) {
  const { tr } = useLocale();
  const navigate = useNavigate();
  return (
    <Button size="sm" kind="ghost" icon="user" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/desk/customers/$id', params: { id: customerId } })}>
      {tr('ws.matches.ops.openCustomer')}
    </Button>
  );
}

/**
 * "Settled another way": the guest was paid back outside Qi Card (cash at the
 * desk, a transfer), so the refund is closed by hand. A note saying how is
 * required (REASON_REQUIRED) and a manager PIN authorises it; the PIN is
 * proved first (depositApi.settleDepositManually). The shared PinReasonModal
 * is not used: its reason list (wrong item, spill, comp…) has nothing that
 * describes how a refund was settled, and this needs a sentence, not a code.
 */
function SettleDialog({ row, guest, amount, onClose, onDone }: { row: DepositAttentionRow; guest: string; amount: number; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = note.trim().length > 0 && pin.length >= 4;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await settleDepositManually(row.id, pin, note.trim());
      onDone();
    } catch (e) {
      setError(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(`${K}.settleTitle`)}
      subtitle={tr(`${K}.settleLead`, { amount: formatIQD(amount, locale), name: guest })}
      dismissible={!busy}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('ws.kit.pin.cancel')}
          </Button>
          <Button kind="primary" icon="lock" busy={busy} disabled={!ready} disabledReason={tr(`${K}.settleNeeds`)} onClick={() => void submit()}>
            {tr(`${K}.settleConfirm`)}
          </Button>
        </>
      }
    >
      <Field label={tr(`${K}.note`)} hint={tr(`${K}.noteHint`)} required>
        <textarea
          style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical' }}
          value={note}
          disabled={busy}
          maxLength={500}
          autoFocus
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Field label={tr('ws.kit.pin.pin')} hint={tr(`${K}.pinHint`)} required>
        <input
          style={{ ...inputStyle, fontSize: 'var(--tp-fs-xl)', letterSpacing: '0.35em', textAlign: 'center', inlineSize: '10rem' }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={pin}
          maxLength={6}
          disabled={busy}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}
