/**
 * Assign (docs/design/open-matches/operator.md §5.13.6): money taken on a
 * match booking's own bill without naming a player (the offline path, or the
 * bill's Cash/Card) is put on the players it was for, one
 * app.match_link_payment call per payment.
 *
 * Each payment starts pre-filled (assignLogic.prefillAssign: the seats that
 * owe first, in seat order, then the ones the credit pool covered) and the
 * desk corrects it. Every carrier with room left in its share is listed, so
 * money the pool already spread over the seats can still be made exact
 * (money.md §10 #21), and a no-show's share can take a link. A payment on a LIVE
 * court-only bill also offers "Keep on the booking" (`p_allocations = []`,
 * C22), which closes that bill at what was paid and leaves the money on the
 * booking: a price rise after booking (DF-4), or money nobody can attribute.
 *
 * Online only (DF-11); every key is minted per payment and sent again on a
 * retry. AMOUNT_OVER_SEAT and PAYMENT_OVER_ALLOCATED land on the payment's
 * own fields, as every other refusal does.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatTime, type Locale, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, Money } from '../../components/kit';
import {
  allocationsOf,
  assignablePayments,
  canKeepOnBooking,
  checkAssign,
  assignSeats,
  parseAmount,
  prefillAssign,
  seatRoom,
  seatStanding,
  type AssignDraft,
} from './assignLogic';
import { matchErrorText, seatLabelOf, type Tr } from './matchLogic';
import type { MatchDetail, MatchSeat, UnassignedPayment } from './matchPayloads';
import { invalidateMatchMoney, mintMatchKey } from './useMatches';

export interface AssignPaymentDialogProps {
  detail: MatchDetail;
  /** The payment to show first: the one on the bill a Take share met open (BOOKING_TAB_OPEN). */
  focusPaymentId?: string | null;
  /** A line above the payments (why the dialog opened on its own). */
  notice?: string | null;
  /** The branch's timezone, for the payments' times. */
  tz: string;
  onClose: () => void;
}

function methodKey(method: string | null): MessageKey {
  return method === 'cash' ? 'ws.matches.assign.method.cash' : method === 'card' ? 'ws.matches.assign.method.card' : 'ws.matches.assign.method.other';
}

function paymentHeading(p: UnassignedPayment, tr: Tr, locale: Locale, tz: string): string {
  return tr('ws.matches.assign.payment', {
    method: tr(methodKey(p.method)),
    time: p.created_at ? formatTime(new Date(p.created_at), locale, tz) : '—',
  });
}

/**
 * A seat's figures after its number: what it owes, what the pool covered,
 * what is written off, what is not due yet. Only the ones above 0; a seat
 * with none of them (no live booking) reads "Owes 0".
 */
function standingParts(seat: MatchSeat, tr: Tr, amount: (n: number) => string): string[] {
  const st = seatStanding(seat);
  const parts = [
    st.owes > 0 ? tr('ws.matches.assign.owes', { amount: amount(st.owes) }) : null,
    st.covered > 0 ? tr('ws.matches.assign.covered', { amount: amount(st.covered) }) : null,
    st.writtenOff > 0 ? tr('ws.matches.assign.writtenOff', { amount: amount(st.writtenOff) }) : null,
    st.open > 0 ? tr('ws.matches.assign.notDue', { amount: amount(st.open) }) : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts : [tr('ws.matches.assign.owes', { amount: amount(0) })];
}

export function AssignPaymentDialog({ detail, focusPaymentId, notice, tz, onClose }: AssignPaymentDialogProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();

  const unassigned = detail.money?.unassigned ?? [];
  // The payments as the dialog opened on them: a poll that lands while the
  // desk is typing must not reorder or re-fill what they are editing.
  const [payments] = useState(() => {
    const list = assignablePayments(unassigned);
    const focus = list.find((p) => p.payment_id === focusPaymentId);
    return focus ? [focus, ...list.filter((p) => p !== focus)] : list;
  });
  const [draft, setDraft] = useState<AssignDraft>(() => prefillAssign(payments, detail.seats));
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  // One key per payment, kept across a retry and replaced after a success.
  const keys = useRef(new Map<string, string>());
  const keyFor = (paymentId: string) => {
    const existing = keys.current.get(paymentId);
    if (existing) return existing;
    const minted = mintMatchKey('link');
    keys.current.set(paymentId, minted);
    return minted;
  };

  const seats = assignSeats(detail.seats);
  const open = payments.filter((p) => !done.has(p.payment_id));
  const check = checkAssign(
    Object.fromEntries(Object.entries(draft).filter(([id]) => !done.has(id))),
    open,
    detail.seats,
  );
  const amount = (n: number | null | undefined) => formatIQD(n ?? 0, locale);
  const errorWords = (e: unknown) => matchErrorText(e, { tr, locale, tz });

  function setAmount(paymentId: string, seatId: string, value: number) {
    setDraft((d) => ({ ...d, [paymentId]: { ...d[paymentId], [seatId]: value } }));
  }

  function finish(nextDone: Set<string>, message: MessageKey) {
    invalidateMatchMoney(qc);
    toast.ok(tr(message));
    if (payments.every((p) => nextDone.has(p.payment_id))) onClose();
  }

  async function link(p: UnassignedPayment, allocations: { seat_id: string; amount_iqd: number }[]): Promise<boolean> {
    try {
      await appRpc('match_link_payment', {
        p_payment_id: p.payment_id,
        p_allocations: allocations,
        p_idempotency_key: keyFor(p.payment_id),
      });
      keys.current.delete(p.payment_id);
      return true;
    } catch (e) {
      setErrors((prev) => ({ ...prev, [p.payment_id]: e }));
      return false;
    }
  }

  async function save() {
    setBusy('save');
    setErrors({});
    const nextDone = new Set(done);
    let failed = false;
    try {
      for (const p of open) {
        const allocations = allocationsOf(draft, p.payment_id, detail.seats);
        if (allocations.length === 0) continue;
        if (!(await link(p, allocations))) {
          failed = true;
          break;
        }
        nextDone.add(p.payment_id);
      }
    } finally {
      setBusy(null);
    }
    setDone(nextDone);
    if (failed) {
      // What went through is on the players now; the refusal stays on its payment.
      invalidateMatchMoney(qc);
      return;
    }
    finish(nextDone, 'ws.matches.assign.saved');
  }

  async function keep(p: UnassignedPayment) {
    setBusy(p.payment_id);
    setErrors((prev) => ({ ...prev, [p.payment_id]: null }));
    const ok = await link(p, []);
    setBusy(null);
    if (!ok) return;
    const nextDone = new Set(done).add(p.payment_id);
    setDone(nextDone);
    finish(nextDone, 'ws.matches.assign.kept');
  }

  // Why Save cannot be pressed, the first reason that holds (rulebook 4.3).
  const overSeatRow = seats.find((s) => check.overSeat.has(s.seat_id));
  const overPaymentRow = open.find((p) => check.overPayment.has(p.payment_id));
  const blocked = !reachable
    ? tr('ws.matches.offline.needsConnection')
    : check.empty
      ? tr('ws.matches.assign.enterAmount')
      : overSeatRow
        ? tr('ws.matches.assign.overSeat', { amount: amount(seatRoom(overSeatRow)) })
        : overPaymentRow
          ? tr('ws.matches.assign.overPayment', { amount: amount(overPaymentRow.unassigned_iqd) })
          : undefined;

  return (
    <Modal
      title={tr('ws.matches.assign.title')}
      dismissible={busy === null}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy !== null}>
            {tr('common.cancel')}
          </Button>
          {seats.length > 0 && (
            <Button kind="primary" busy={busy === 'save'} disabled={busy !== null || blocked !== undefined} disabledReason={blocked} onClick={() => void save()}>
              {tr('ws.matches.assign.save')}
            </Button>
          )}
        </>
      )}
    >
      {notice && <MessagePresenter tone="refused" message={notice} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />}
      <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.matches.assign.lead')}</p>
      {seats.length === 0 && <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.matches.assign.nobodyOwes')}</p>}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        {open.map((p) => {
          const over = check.overPayment.has(p.payment_id);
          return (
            <section
              key={p.payment_id}
              aria-label={paymentHeading(p, tr, locale, tz)}
              style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>
                  <bdi>{paymentHeading(p, tr, locale, tz)}</bdi>
                </h3>
                <Money amount={p.amount_iqd} strong />
              </div>
              <p style={{ fontSize: 'var(--tp-fs-sm)', color: over ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }}>
                {over ? tr('ws.matches.assign.overPayment', { amount: amount(p.unassigned_iqd) }) : tr('ws.matches.assign.left', { amount: amount(p.unassigned_iqd) })}
              </p>
              {seats.map((s) => {
                const name = seatLabelOf(s, tr);
                const overSeat = check.overSeat.has(s.seat_id);
                const value = draft[p.payment_id]?.[s.seat_id] ?? 0;
                return (
                  <div key={s.seat_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
                    <div style={{ minInlineSize: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        <bdi>{name}</bdi>
                      </div>
                      <div style={{ fontSize: 'var(--tp-fs-sm)', color: overSeat ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }}>
                        {overSeat
                          ? tr('ws.matches.assign.overSeat', { amount: amount(seatRoom(s)) })
                          : [tr('ws.matches.players.seatNo', { seat: String(s.seat_no) }), ...standingParts(s, tr, amount)].join(' · ')}
                      </div>
                    </div>
                    <input
                      style={{ ...inputStyle, inlineSize: '9rem', textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}
                      dir="ltr"
                      inputMode="numeric"
                      aria-label={tr('ws.matches.assign.amountFor', { name })}
                      aria-invalid={overSeat || over || undefined}
                      value={value || ''}
                      placeholder="0"
                      disabled={busy !== null}
                      onChange={(e) => setAmount(p.payment_id, s.seat_id, parseAmount(e.target.value))}
                    />
                  </div>
                );
              })}
              {canKeepOnBooking(p) && (
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
                  <Button
                    size="sm"
                    icon="receipt"
                    busy={busy === p.payment_id}
                    disabled={busy !== null || !reachable}
                    disabledReason={reachable ? undefined : tr('ws.matches.offline.needsConnection')}
                    onClick={() => void keep(p)}
                  >
                    {tr('ws.matches.assign.keep')}
                  </Button>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.assign.keepLead')}</span>
                </div>
              )}
              <ErrorText error={errors[p.payment_id] ?? null} message={errors[p.payment_id] ? errorWords(errors[p.payment_id]) : null} />
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
